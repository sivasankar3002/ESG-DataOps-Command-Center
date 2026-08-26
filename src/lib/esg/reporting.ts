// =====================================================================
// ESG DataOps Command Center — MODULE 10: operational reporting
// Daily ops report generator:
//   reports/daily_ops_report_YYYY-MM-DD.md
//   reports/daily_ops_report_YYYY-MM-DD.csv
// Status logic:
//   GREEN — no failed jobs, no P1/P2 incidents, reconciliation pass
//   AMBER — warnings / non-critical validation failures / one P3
//   RED   — failed load, P1/P2 incident, missing mandatory file, recon fail
// =====================================================================

import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { loadConfig, resolvePath } from './config'
import { fmtDateTime } from './fsx'

export interface DailyStats {
  reportDate: string
  filesExpected: number
  filesReceived: number
  filesQuarantined: number
  jobsExecuted: number
  jobsSucceeded: number
  jobsFailed: number
  dqChecksExecuted: number
  dqChecksPassed: number
  dqChecksFailed: number
  openIncidents: number
  p1Incidents: number
  p2Incidents: number
  reconciliationStatus: 'PASS' | 'FAIL' | 'NO_DATA'
  overallHealth: 'GREEN' | 'AMBER' | 'RED'
}

export async function gatherDailyStats(businessDate: string): Promise<DailyStats> {
  const config = loadConfig()
  const dayStart = new Date(`${businessDate}T00:00:00`)
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000)

  const mandatoryDatasets = Object.values(config.manifest).filter((d) => d.mandatory)

  const fileLogs = await db.fileIngestionLog.findMany({
    where: { expectedArrivalDate: { gte: dayStart, lt: dayEnd } },
  })
  const receivedDatasets = new Set(fileLogs.map((f) => f.dataset))
  const filesQuarantined = fileLogs.filter((f) => f.fileStatus === 'QUARANTINED').length
  const missingMandatory = mandatoryDatasets.filter((d) => !receivedDatasets.has(d.name)).length

  const jobs = await db.jobRunAudit.findMany({
    where: { startTime: { gte: dayStart, lt: dayEnd } },
  })
  const jobsExecuted = jobs.length
  const jobsSucceeded = jobs.filter((j) => j.status === 'SUCCESS').length
  const jobsFailed = jobs.filter((j) => j.status === 'FAILED').length

  const dq = await db.dqCheckResult.findMany({ where: { businessDate } })
  const dqChecksExecuted = dq.length
  const dqChecksPassed = dq.filter((c) => c.status === 'PASS').length
  const dqChecksFailed = dq.filter((c) => c.status === 'FAIL').length

  const incidents = await db.incidentLog.findMany({
    where: { createdAt: { gte: dayStart, lt: dayEnd } },
  })
  const open = incidents.filter((i) => i.status === 'OPEN' || i.status === 'IN_PROGRESS')
  const p1Incidents = open.filter((i) => i.severity === 'P1').length
  const p2Incidents = open.filter((i) => i.severity === 'P2').length
  const p3Incidents = open.filter((i) => i.severity === 'P3').length

  const reconChecks = await db.dqCheckResult.findMany({
    where: { businessDate, checkCategory: 'RECONCILIATION' },
    orderBy: { executedAt: 'desc' },
  })
  const rowcountRecon = reconChecks.find((c) => c.checkName === 'source_to_target_rowcount_recon')
  const reconciliationStatus: DailyStats['reconciliationStatus'] = !rowcountRecon
    ? 'NO_DATA'
    : rowcountRecon.status === 'PASS'
      ? 'PASS'
      : 'FAIL'

  // ---- health logic (spec-defined) --------------------------------------
  let overallHealth: DailyStats['overallHealth'] = 'GREEN'
  if (
    jobsFailed > 0 ||
    p1Incidents > 0 ||
    p2Incidents > 0 ||
    reconciliationStatus === 'FAIL' ||
    missingMandatory > 0
  ) {
    overallHealth = 'RED'
  } else if (dqChecksFailed > 0 || p3Incidents > 0 || filesQuarantined > 0) {
    overallHealth = 'AMBER'
  }

  return {
    reportDate: businessDate,
    filesExpected: mandatoryDatasets.length,
    filesReceived: receivedDatasets.size,
    filesQuarantined,
    jobsExecuted,
    jobsSucceeded,
    jobsFailed,
    dqChecksExecuted,
    dqChecksPassed,
    dqChecksFailed,
    openIncidents: open.length,
    p1Incidents,
    p2Incidents,
    reconciliationStatus,
    overallHealth,
  }
}

export function buildMarkdownReport(stats: DailyStats, batchId: string | null): string {
  const healthIcon = stats.overallHealth === 'GREEN' ? 'GREEN' : stats.overallHealth === 'AMBER' ? 'AMBER' : 'RED'
  const lines: string[] = []
  lines.push(`# ESG DataOps Daily Operations Report — ${stats.reportDate}`)
  lines.push('')
  lines.push(
    `**Overall health: ${healthIcon}** | Generated: ${fmtDateTime(new Date())} | ` +
      `Latest batch: ${batchId ?? 'n/a'} | Pipeline: esg_daily_ingestion`,
  )
  lines.push('')
  lines.push('## Executive summary')
  lines.push(
    `${stats.filesReceived}/${stats.filesExpected} expected feeds received; ` +
      `${stats.jobsSucceeded}/${stats.jobsExecuted} jobs succeeded; ` +
      `${stats.dqChecksPassed}/${stats.dqChecksExecuted} validation checks passed; ` +
      `${stats.openIncidents} open incident(s) (${stats.p1Incidents} P1, ${stats.p2Incidents} P2). ` +
      `Reconciliation: ${stats.reconciliationStatus}.`,
  )
  lines.push('')
  lines.push('## File ingestion')
  lines.push('| Metric | Value |')
  lines.push('|---|---|')
  lines.push(`| Files expected | ${stats.filesExpected} |`)
  lines.push(`| Files received | ${stats.filesReceived} |`)
  lines.push(`| Files quarantined | ${stats.filesQuarantined} |`)
  lines.push('')
  lines.push('## Pipeline runs')
  lines.push('| Metric | Value |')
  lines.push('|---|---|')
  lines.push(`| Jobs executed | ${stats.jobsExecuted} |`)
  lines.push(`| Jobs succeeded | ${stats.jobsSucceeded} |`)
  lines.push(`| Jobs failed | ${stats.jobsFailed} |`)
  lines.push('')
  lines.push('## Data quality')
  lines.push('| Metric | Value |')
  lines.push('|---|---|')
  lines.push(`| Checks executed | ${stats.dqChecksExecuted} |`)
  lines.push(`| Checks passed | ${stats.dqChecksPassed} |`)
  lines.push(`| Checks failed | ${stats.dqChecksFailed} |`)
  lines.push('')
  lines.push('## Incidents')
  lines.push('| Metric | Value |')
  lines.push('|---|---|')
  lines.push(`| Open incidents | ${stats.openIncidents} |`)
  lines.push(`| P1 incidents | ${stats.p1Incidents} |`)
  lines.push(`| P2 incidents | ${stats.p2Incidents} |`)
  lines.push('')
  lines.push('## Reconciliation')
  lines.push(`Source-to-target status: **${stats.reconciliationStatus}**`)
  lines.push('')
  lines.push('## Notes for the on-call engineer')
  lines.push('- Full runbook index: docs/runbooks/ (RB001-RB010)')
  lines.push('- SOP for the daily monitoring checklist: docs/sop_daily_monitoring.md')
  lines.push('- Detailed checks: Dashboard > Data Quality; incidents: Dashboard > Incidents')
  lines.push('')
  return lines.join('\n')
}

export function buildCsvReport(stats: DailyStats): string {
  const header = [
    'report_date',
    'files_expected',
    'files_received',
    'files_quarantined',
    'jobs_executed',
    'jobs_succeeded',
    'jobs_failed',
    'dq_checks_executed',
    'dq_checks_passed',
    'dq_checks_failed',
    'open_incidents',
    'p1_incidents',
    'p2_incidents',
    'reconciliation_status',
    'overall_health',
  ]
  const row = [
    stats.reportDate,
    stats.filesExpected,
    stats.filesReceived,
    stats.filesQuarantined,
    stats.jobsExecuted,
    stats.jobsSucceeded,
    stats.jobsFailed,
    stats.dqChecksExecuted,
    stats.dqChecksPassed,
    stats.dqChecksFailed,
    stats.openIncidents,
    stats.p1Incidents,
    stats.p2Incidents,
    stats.reconciliationStatus,
    stats.overallHealth,
  ]
  return header.join(',') + '\n' + row.join(',') + '\n'
}

/** Generate (or refresh) the daily report for a business date. */
export async function generateDailyReport(businessDate: string, asOf = new Date()): Promise<DailyStats> {
  const config = loadConfig()
  const stats = await gatherDailyStats(businessDate)

  const lastBatch = await db.jobRunAudit.findFirst({
    where: { startTime: { gte: new Date(`${businessDate}T00:00:00`), lt: new Date(`${businessDate}T23:59:59`) } },
    orderBy: { startTime: 'desc' },
    select: { batchId: true },
  })

  const markdown = buildMarkdownReport(stats, lastBatch?.batchId ?? null)
  const csv = buildCsvReport(stats)

  await db.dailyOpsReport.upsert({
    where: { reportDate: businessDate },
    create: {
      reportDate: businessDate,
      filesExpected: stats.filesExpected,
      filesReceived: stats.filesReceived,
      filesQuarantined: stats.filesQuarantined,
      jobsExecuted: stats.jobsExecuted,
      jobsSucceeded: stats.jobsSucceeded,
      jobsFailed: stats.jobsFailed,
      dqChecksExecuted: stats.dqChecksExecuted,
      dqChecksPassed: stats.dqChecksPassed,
      dqChecksFailed: stats.dqChecksFailed,
      openIncidents: stats.openIncidents,
      p1Incidents: stats.p1Incidents,
      p2Incidents: stats.p2Incidents,
      reconciliationStatus: stats.reconciliationStatus,
      overallHealth: stats.overallHealth,
      markdownContent: markdown,
      csvContent: csv,
      createdAt: asOf,
    },
    update: {
      filesExpected: stats.filesExpected,
      filesReceived: stats.filesReceived,
      filesQuarantined: stats.filesQuarantined,
      jobsExecuted: stats.jobsExecuted,
      jobsSucceeded: stats.jobsSucceeded,
      jobsFailed: stats.jobsFailed,
      dqChecksExecuted: stats.dqChecksExecuted,
      dqChecksPassed: stats.dqChecksPassed,
      dqChecksFailed: stats.dqChecksFailed,
      openIncidents: stats.openIncidents,
      p1Incidents: stats.p1Incidents,
      p2Incidents: stats.p2Incidents,
      reconciliationStatus: stats.reconciliationStatus,
      overallHealth: stats.overallHealth,
      markdownContent: markdown,
      csvContent: csv,
    },
  })

  // Persist artefacts under reports/ (md + csv)
  try {
    const dir = resolvePath(config.settings.reportsDir)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `daily_ops_report_${businessDate}.md`), markdown, 'utf-8')
    fs.writeFileSync(path.join(dir, `daily_ops_report_${businessDate}.csv`), csv, 'utf-8')
  } catch (err) {
    console.error('[reporting] failed to persist report files:', err)
  }

  return stats
}
