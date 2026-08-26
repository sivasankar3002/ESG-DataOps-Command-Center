// =====================================================================
// ESG DataOps Command Center — dashboard state assembler
// Single aggregation endpoint behind GET /api/state: health, SLA,
// trends, runs, files, DQ results, incidents, alerts, reconciliation,
// reports and landing-zone inventory.
// =====================================================================

import { db } from '@/lib/db'
import { datasetFileRegex, loadConfig } from './config'
import { scanZone, fmtDateTime, fmtUtcDate, addDays, parseIsoDate } from './fsx'
import { getReconciliationRows, batchIdToDate } from './reconciliation'
import type { HealthStatus } from './types'

export interface DashboardState {
  generatedAt: string
  today: string
  hasData: boolean
  health: {
    status: HealthStatus
    reasons: string[]
    lastSuccessfulLoad: string | null
    lastBatchId: string | null
    sla: { status: 'OK' | 'PENDING' | 'AT_RISK' | 'BREACHED' | 'NO_DATA'; text: string; nextExpected: string | null }
  }
  overview: {
    jobs24h: { total: number; success: number; failed: number; skipped: number }
    activeIncidents: number
    openBySeverity: { P1: number; P2: number; P3: number; P4: number }
    files24h: { received: number; quarantined: number; processed: number }
    lastSuccessfulLoad: string | null
    sitesTracked: number
    warehouseRows: number
  }
  dailyTrend: {
    date: string
    jobsSuccess: number
    jobsFailed: number
    dqPass: number
    dqFail: number
    filesReceived: number
    filesQuarantined: number
    incidents: number
  }[]
  batches: { batchId: string; businessDate: string; startedAt: string; status: string; tasks: number; incidents: number }[]
  runs: {
    runId: string
    batchId: string
    taskId: string
    jobName: string
    jobType: string
    startTime: string
    durationSeconds: number | null
    status: string
    rowsRead: number | null
    rowsLoaded: number | null
    rowsRejected: number | null
    errorMessage: string | null
  }[]
  files: {
    fileId: string
    batchId: string
    fileName: string
    dataset: string
    zone: string
    fileStatus: string
    checksumStatus: string
    checksumValue: string
    receivedAt: string | null
    expectedArrivalDate: string
    fileSizeBytes: number
    errorMessage: string | null
    createdAt: string
  }[]
  dq: {
    summary: { executed: number; passed: number; failed: number; warn: number }
    failsBySeverity: { severity: string; count: number }[]
    checksSummary: { checkName: string; category: string; pass: number; fail: number; warn: number }[]
    latest: {
      checkId: number
      batchId: string
      businessDate: string
      checkName: string
      checkCategory: string
      tableName: string | null
      columnName: string | null
      status: string
      severity: string
      expectedValue: string | null
      actualValue: string | null
      thresholdValue: string | null
      errorDetails: string | null
      executedAt: string
    }[]
  }
  incidents: {
    incidentId: string
    createdAt: string
    updatedAt: string
    batchId: string | null
    incidentType: string
    severity: string
    status: string
    shortDescription: string
    affectedFile: string | null
    affectedTable: string | null
    affectedCheck: string | null
    runbookLink: string | null
    assignedTo: string | null
    escalatedFlag: boolean
    ageMinutes: number
  }[]
  alerts: {
    alertId: number
    createdAt: string
    alertType: string
    severity: string
    message: string
    channels: string
    acknowledgedFlag: boolean
    batchId: string | null
  }[]
  reconciliation: {
    batchId: string
    businessDate: string
    sourceCount: number
    targetCount: number
    diffRows: number
    sourceEnergy: number
    targetEnergy: number
    energyDiff: number
    sourceEmissions: number
    targetEmissions: number
    status: string
  }[]
  reports: {
    reportDate: string
    filesReceived: number
    filesQuarantined: number
    jobsSucceeded: number
    jobsFailed: number
    dqChecksPassed: number
    dqChecksFailed: number
    openIncidents: number
    reconciliationStatus: string
    overallHealth: string
  }[]
  incoming: { fileName: string; sizeBytes: number; receivedAt: string }[]
  // ---- NEW: site analytics (dim_site + fact_energy_emissions aggregates) ----
  sites: {
    siteId: string
    siteName: string
    country: string
    region: string
    siteType: string
    totalEnergyKwh: number
    totalEmissionsCo2e: number
    recordCount: number
    latestReading: string | null
    /** Daily kWh for the trend window (sparkline in the directory table). */
    trend: number[]
  }[]
  siteTrend: { date: string; energyKwh: number | null; emissionsCo2e: number | null }[]
  // ---- NEW: batch timeline (Gantt-style) ----
  batchTimeline: {
    batchId: string
    businessDate: string
    startedAt: string
    totalDurationSeconds: number
    tasks: { taskId: string; startSeconds: number; durationSeconds: number; status: string }[]
  }[]
  config: {
    dagId: string
    escalationThresholdMinutes: number
    refreshSeconds: number
    trendDays: number
    rejectedThresholdPct: number
    alertChannels: string[]
    expectedFiles: { dataset: string; pattern: string; arrival: string; slaHours: number }[]
  }
}

function localDateStr(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Assemble the full dashboard state. */
export async function getDashboardState(): Promise<DashboardState> {
  const config = loadConfig()
  const now = new Date()
  const today = localDateStr(now)
  const since24h = new Date(now.getTime() - 24 * 3600 * 1000)
  const trendDays = config.settings.trendDays
  const trendStart = new Date(now.getTime() - (trendDays - 1) * 86400000)

  const [
    runsRaw,
    filesRaw,
    dqRaw,
    incidentsRaw,
    alertsRaw,
    reportsRaw,
    lastLoad,
    sitesCount,
    factCount,
    reconRows,
    sitesRaw,
    factsRaw,
  ] = await Promise.all([
    db.jobRunAudit.findMany({ orderBy: { startTime: 'desc' }, take: 220 }),
    db.fileIngestionLog.findMany({ orderBy: { createdAt: 'desc' }, take: 220 }),
    db.dqCheckResult.findMany({ orderBy: { executedAt: 'desc' }, take: 400 }),
    db.incidentLog.findMany({ orderBy: { createdAt: 'desc' }, take: 120 }),
    db.alertLog.findMany({ orderBy: { createdAt: 'desc' }, take: 60 }),
    db.dailyOpsReport.findMany({ orderBy: { reportDate: 'desc' }, take: trendDays }),
    db.factEnergyEmissions.findFirst({ orderBy: { loadedAt: 'desc' }, select: { loadedAt: true, batchId: true } }),
    db.dimSite.count(),
    db.factEnergyEmissions.count(),
    getReconciliationRows(15),
    db.dimSite.findMany({ where: { activeFlag: true }, take: 100 }),
    db.factEnergyEmissions.findMany({ orderBy: { readingDate: 'desc' }, take: 2000 }),
  ])

  const hasData = runsRaw.length > 0

  // ---- health (as of now) ------------------------------------------------
  const openIncidents = incidentsRaw.filter((i) => i.status === 'OPEN' || i.status === 'IN_PROGRESS')
  const openP1 = openIncidents.filter((i) => i.severity === 'P1').length
  const openP2 = openIncidents.filter((i) => i.severity === 'P2').length
  const openP3 = openIncidents.filter((i) => i.severity === 'P3').length
  const lastBatchId = runsRaw[0]?.batchId ?? null
  const lastBatchRuns = lastBatchId ? runsRaw.filter((r) => r.batchId === lastBatchId) : []
  const lastBatchFailed = lastBatchRuns.some((r) => r.status === 'FAILED')
  const lastBatchWarnChecks = dqRaw.filter((d) => d.batchId === lastBatchId && d.status !== 'PASS').length
  const lastRecon = reconRows[0]?.status ?? 'NO_DATA'

  const reasons: string[] = []
  let healthStatus: HealthStatus = 'GREEN'
  if (!hasData) {
    healthStatus = 'NO_DATA'
    reasons.push('No pipeline runs recorded yet — seed demo history or run the DAG.')
  } else {
    if (lastBatchFailed) reasons.push('Latest batch has failed task(s)')
    if (openP1 > 0) reasons.push(`${openP1} open P1 incident(s)`)
    if (openP2 > 0) reasons.push(`${openP2} open P2 incident(s)`)
    if (lastRecon === 'FAIL') reasons.push('Latest reconciliation mismatch')
    if (lastBatchFailed || openP1 > 0 || openP2 > 0 || lastRecon === 'FAIL') {
      healthStatus = 'RED'
    } else {
      if (openP3 > 0) reasons.push(`${openP3} open P3 incident(s)`)
      if (lastBatchWarnChecks > 0) reasons.push(`${lastBatchWarnChecks} non-pass check(s) in latest batch`)
      if (openP3 > 0 || lastBatchWarnChecks > 0) healthStatus = 'AMBER'
    }
  }

  // ---- SLA status for today's feeds ---------------------------------------
  // Arrival = file present in the landing zone OR already logged by a sensor run
  const incomingZone = scanZone(config.settings.incomingDir)
  const landingZoneDatasets = new Set<string>()
  for (const f of incomingZone) {
    if (f.fileName.endsWith('.manifest.json')) continue
    for (const d of Object.values(config.manifest)) {
      if (datasetFileRegex(d, today).test(f.fileName)) landingZoneDatasets.add(d.name)
    }
  }
  const todayStart = new Date(`${today}T00:00:00`)
  const todayFiles = filesRaw.filter((f) => f.expectedArrivalDate >= todayStart)
  const expectedToday = Object.values(config.manifest)
  const receivedDatasets = new Set([...todayFiles.map((f) => f.dataset), ...landingZoneDatasets])
  const missingToday = expectedToday.filter((d) => !receivedDatasets.has(d.name))
  let slaStatus: DashboardState['health']['sla']['status'] = 'OK'
  let slaText = ''
  const latestDeadline = expectedToday.reduce((max, d) => {
    const [h, m] = d.expectedArrival.split(':').map((x) => parseInt(x, 10))
    const arrival = new Date(todayStart)
    arrival.setHours(h, m, 0, 0)
    const deadline = new Date(arrival.getTime() + d.slaHours * 3600 * 1000)
    return deadline > max ? deadline : max
  }, todayStart)
  if (!hasData) {
    slaStatus = 'NO_DATA'
    slaText = 'No data yet'
  } else if (missingToday.length === 0) {
    slaStatus = 'OK'
    const ingested = todayFiles.length
    slaText =
      ingested > 0
        ? `All ${expectedToday.length} feeds received and ingested today`
        : `All ${expectedToday.length} feeds in the landing zone — awaiting DAG run`
  } else if (now < latestDeadline) {
    slaStatus = 'PENDING'
    slaText = `${missingToday.length} feed(s) pending — SLA window open until ${fmtDateTime(latestDeadline)}`
  } else {
    slaStatus = 'BREACHED'
    slaText = `${missingToday.length} feed(s) missing beyond SLA: ${missingToday.map((d) => d.name).join(', ')}`
  }

  // ---- 24h overview ----------------------------------------------------------
  const jobs24h = runsRaw.filter((r) => r.startTime >= since24h)
  const files24h = filesRaw.filter((f) => f.createdAt >= since24h)
  const received24h = new Set([...files24h.map((f) => f.dataset), ...landingZoneDatasets]).size

  // ---- daily trend ----------------------------------------------------------------
  const trend: DashboardState['dailyTrend'] = []
  for (let i = trendDays - 1; i >= 0; i--) {
    const d = addDays(parseIsoDate(today), -i)
    const dateStr = fmtUtcDate(d)
    const dayStart = new Date(`${dateStr}T00:00:00`)
    const dayEnd = new Date(dayStart.getTime() + 86400000)
    const dayRuns = runsRaw.filter((r) => r.startTime >= dayStart && r.startTime < dayEnd)
    const dayDq = dqRaw.filter((c) => c.businessDate === dateStr)
    const dayFiles = filesRaw.filter(
      (f) => f.expectedArrivalDate >= dayStart && f.expectedArrivalDate < dayEnd,
    )
    const dayIncidents = incidentsRaw.filter((c) => c.createdAt >= dayStart && c.createdAt < dayEnd)
    trend.push({
      date: dateStr,
      jobsSuccess: dayRuns.filter((r) => r.status === 'SUCCESS').length,
      jobsFailed: dayRuns.filter((r) => r.status === 'FAILED').length,
      dqPass: dayDq.filter((c) => c.status === 'PASS').length,
      dqFail: dayDq.filter((c) => c.status === 'FAIL').length,
      filesReceived: new Set(dayFiles.map((f) => f.dataset)).size,
      filesQuarantined: dayFiles.filter((f) => f.fileStatus === 'QUARANTINED').length,
      incidents: dayIncidents.length,
    })
  }

  // ---- batches --------------------------------------------------------------------
  const batchMap = new Map<string, { startedAt: Date; tasks: number; failed: number }>()
  for (const r of runsRaw) {
    const b = batchMap.get(r.batchId) ?? { startedAt: r.startTime, tasks: 0, failed: 0 }
    b.tasks++
    if (r.status === 'FAILED') b.failed++
    if (r.startTime < b.startedAt) b.startedAt = r.startTime
    batchMap.set(r.batchId, b)
  }
  const batches = [...batchMap.entries()]
    .sort((a, b) => b[1].startedAt.getTime() - a[1].startedAt.getTime())
    .slice(0, 15)
    .map(([batchId, info]) => ({
      batchId,
      businessDate: batchIdToDate(batchId),
      startedAt: info.startedAt.toISOString(),
      status: info.failed > 0 ? 'FAILED' : 'SUCCESS',
      tasks: info.tasks,
      incidents: incidentsRaw.filter((i) => i.batchId === batchId).length,
    }))

  // ---- dq summary -------------------------------------------------------------------
  const dqTrendWindow = dqRaw.filter((c) => c.executedAt >= trendStart)
  const checksSummaryMap = new Map<string, { checkName: string; category: string; pass: number; fail: number; warn: number }>()
  for (const c of dqTrendWindow) {
    const e =
      checksSummaryMap.get(c.checkName) ??
      { checkName: c.checkName, category: c.checkCategory, pass: 0, fail: 0, warn: 0 }
    if (c.status === 'PASS') e.pass++
    else if (c.status === 'FAIL') e.fail++
    else e.warn++
    checksSummaryMap.set(c.checkName, e)
  }
  const failsBySeverityMap = new Map<string, number>()
  for (const c of dqTrendWindow) {
    if (c.status === 'FAIL') failsBySeverityMap.set(c.severity, (failsBySeverityMap.get(c.severity) ?? 0) + 1)
  }

  // ---- incoming zone ------------------------------------------------------------------
  const incomingList = incomingZone.filter((f) => !f.fileName.endsWith('.manifest.json'))

  // ---- site analytics (NEW) --------------------------------------------------------
  // Aggregate fact_energy_emissions by site, join with dim_site metadata.
  // trendDates is shared with the sparkline payload so the client can align
  // per-site daily kWh with calendar days.
  const trendDates: string[] = []
  for (let i = trendDays - 1; i >= 0; i--) {
    trendDates.push(fmtUtcDate(addDays(parseIsoDate(today), -i)))
  }
  const siteMap = new Map<
    string,
    { totalEnergy: number; totalEmissions: number; count: number; latest: Date | null; daily: Map<string, number> }
  >()
  for (const f of factsRaw) {
    const e =
      siteMap.get(f.siteId) ??
      { totalEnergy: 0, totalEmissions: 0, count: 0, latest: null as Date | null, daily: new Map<string, number>() }
    e.totalEnergy += f.energyKwh
    e.totalEmissions += f.emissionsCo2e
    e.count++
    if (!e.latest || f.readingDate > e.latest) e.latest = f.readingDate
    const rd = fmtUtcDate(f.readingDate)
    e.daily.set(rd, (e.daily.get(rd) ?? 0) + f.energyKwh)
    siteMap.set(f.siteId, e)
  }
  const siteMeta = new Map(sitesRaw.map((s) => [s.siteId, s]))
  const sites = [...siteMap.entries()]
    .map(([siteId, agg]) => {
      const meta = siteMeta.get(siteId)
      return {
        siteId,
        siteName: meta?.siteName ?? siteId,
        country: meta?.country ?? '-',
        region: meta?.region ?? '-',
        siteType: meta?.siteType ?? '-',
        totalEnergyKwh: Math.round(agg.totalEnergy * 100) / 100,
        totalEmissionsCo2e: Math.round(agg.totalEmissions * 100) / 100,
        recordCount: agg.count,
        latestReading: agg.latest ? agg.latest.toISOString() : null,
        trend: trendDates.map((d) => Math.round((agg.daily.get(d) ?? 0) * 100) / 100),
      }
    })
    .sort((a, b) => b.totalEnergyKwh - a.totalEnergyKwh)
    .slice(0, 50)

  // ---- site daily trend (last 14 days) --------------------------------------------
  // Days with no batch produce null (not 0) so the chart renders an honest
  // gap instead of a misleading dip to zero.
  const siteTrend: DashboardState['siteTrend'] = []
  for (let i = trendDays - 1; i >= 0; i--) {
    const d = addDays(parseIsoDate(today), -i)
    const dateStr = fmtUtcDate(d)
    const dayStart = new Date(`${dateStr}T00:00:00`)
    const dayEnd = new Date(dayStart.getTime() + 86400000)
    const dayFacts = factsRaw.filter((f) => f.readingDate >= dayStart && f.readingDate < dayEnd)
    siteTrend.push({
      date: dateStr,
      energyKwh: dayFacts.length > 0 ? Math.round(dayFacts.reduce((a, f) => a + f.energyKwh, 0) * 100) / 100 : null,
      emissionsCo2e: dayFacts.length > 0 ? Math.round(dayFacts.reduce((a, f) => a + f.emissionsCo2e, 0) * 100) / 100 : null,
    })
  }

  // ---- batch timeline (NEW) --------------------------------------------------------
  // For each batch, compute each task's offset from the batch start (in seconds)
  // so the Gantt can render bars at the right position.
  const batchTasksMap = new Map<string, { startTime: Date; duration: number; status: string; taskId: string }[]>()
  for (const r of runsRaw) {
    const list = batchTasksMap.get(r.batchId) ?? []
    if (r.durationSeconds !== null) {
      list.push({ startTime: r.startTime, duration: r.durationSeconds, status: r.status, taskId: r.taskId })
    }
    batchTasksMap.set(r.batchId, list)
  }
  const batchTimeline = [...batchTasksMap.entries()]
    .sort((a, b) => {
      const aStart = a[1].reduce((m, t) => (t.startTime < m ? t.startTime : m), a[1][0]?.startTime ?? new Date())
      const bStart = b[1].reduce((m, t) => (t.startTime < m ? t.startTime : m), b[1][0]?.startTime ?? new Date())
      return bStart.getTime() - aStart.getTime()
    })
    .slice(0, 8)
    .map(([batchId, tasks]) => {
      const batchStart = tasks.reduce((m, t) => (t.startTime < m ? t.startTime : m), tasks[0]?.startTime ?? new Date())
      const totalDuration = tasks.reduce((a, t) => a + t.duration, 0)
      return {
        batchId,
        businessDate: batchIdToDate(batchId),
        startedAt: batchStart.toISOString(),
        totalDurationSeconds: Math.round(totalDuration * 100) / 100,
        tasks: tasks
          .map((t) => ({
            taskId: t.taskId,
            startSeconds: Math.max(0, (t.startTime.getTime() - batchStart.getTime()) / 1000),
            durationSeconds: t.duration,
            status: t.status,
          }))
          .sort((a, b) => a.startSeconds - b.startSeconds),
      }
    })

  return {
    generatedAt: now.toISOString(),
    today,
    hasData,
    health: {
      status: healthStatus,
      reasons: reasons.length > 0 ? reasons : ['All pipeline signals nominal'],
      lastSuccessfulLoad: lastLoad ? fmtDateTime(lastLoad.loadedAt) : null,
      lastBatchId,
      sla: {
        status: slaStatus,
        text: slaText,
        nextExpected: missingToday.length > 0 ? fmtDateTime(latestDeadline) : null,
      },
    },
    overview: {
      jobs24h: {
        total: jobs24h.length,
        success: jobs24h.filter((r) => r.status === 'SUCCESS').length,
        failed: jobs24h.filter((r) => r.status === 'FAILED').length,
        skipped: jobs24h.filter((r) => r.status === 'SKIPPED').length,
      },
      activeIncidents: openIncidents.length,
      openBySeverity: {
        P1: openP1,
        P2: openP2,
        P3: openP3,
        P4: openIncidents.filter((i) => i.severity === 'P4').length,
      },
      files24h: {
        received: received24h,
        quarantined: files24h.filter((f) => f.fileStatus === 'QUARANTINED').length,
        processed: files24h.filter((f) => f.fileStatus === 'PROCESSED').length,
      },
      lastSuccessfulLoad: lastLoad ? fmtDateTime(lastLoad.loadedAt) : null,
      sitesTracked: sitesCount,
      warehouseRows: factCount,
    },
    dailyTrend: trend,
    batches,
    runs: runsRaw.slice(0, 150).map((r) => ({
      runId: r.runId,
      batchId: r.batchId,
      taskId: r.taskId,
      jobName: r.jobName,
      jobType: r.jobType,
      startTime: r.startTime.toISOString(),
      durationSeconds: r.durationSeconds,
      status: r.status,
      rowsRead: r.rowsRead,
      rowsLoaded: r.rowsLoaded,
      rowsRejected: r.rowsRejected,
      errorMessage: r.errorMessage,
    })),
    files: filesRaw.slice(0, 150).map((f) => ({
      fileId: f.fileId,
      batchId: f.batchId,
      fileName: f.fileName,
      dataset: f.dataset,
      zone: f.zone,
      fileStatus: f.fileStatus,
      checksumStatus: f.checksumStatus,
      checksumValue: f.checksumValue,
      receivedAt: f.receivedAt ? f.receivedAt.toISOString() : null,
      expectedArrivalDate: f.expectedArrivalDate.toISOString(),
      fileSizeBytes: f.fileSizeBytes,
      errorMessage: f.errorMessage,
      createdAt: f.createdAt.toISOString(),
    })),
    dq: {
      summary: {
        executed: dqTrendWindow.length,
        passed: dqTrendWindow.filter((c) => c.status === 'PASS').length,
        failed: dqTrendWindow.filter((c) => c.status === 'FAIL').length,
        warn: dqTrendWindow.filter((c) => c.status === 'WARN').length,
      },
      failsBySeverity: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']
        .map((s) => ({ severity: s, count: failsBySeverityMap.get(s) ?? 0 }))
        .filter((s) => s.count > 0),
      checksSummary: [...checksSummaryMap.values()].sort(
        (a, b) => b.fail - a.fail || b.pass + b.fail + b.warn - (a.pass + a.fail + a.warn),
      ),
      latest: dqRaw.slice(0, 250).map((c) => ({
        checkId: c.checkId,
        batchId: c.batchId,
        businessDate: c.businessDate,
        checkName: c.checkName,
        checkCategory: c.checkCategory,
        tableName: c.tableName,
        columnName: c.columnName,
        status: c.status,
        severity: c.severity,
        expectedValue: c.expectedValue,
        actualValue: c.actualValue,
        thresholdValue: c.thresholdValue,
        errorDetails: c.errorDetails,
        executedAt: c.executedAt.toISOString(),
      })),
    },
    incidents: incidentsRaw.map((i) => ({
      incidentId: i.incidentId,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
      batchId: i.batchId,
      incidentType: i.incidentType,
      severity: i.severity,
      status: i.status,
      shortDescription: i.shortDescription,
      affectedFile: i.affectedFile,
      affectedTable: i.affectedTable,
      affectedCheck: i.affectedCheck,
      runbookLink: i.runbookLink,
      assignedTo: i.assignedTo,
      escalatedFlag: i.escalatedFlag,
      ageMinutes: Math.max(0, Math.floor((now.getTime() - i.createdAt.getTime()) / 60000)),
    })),
    alerts: alertsRaw.map((a) => ({
      alertId: a.alertId,
      createdAt: a.createdAt.toISOString(),
      alertType: a.alertType,
      severity: a.severity,
      message: a.message,
      channels: a.channels,
      acknowledgedFlag: a.acknowledgedFlag,
      batchId: a.batchId,
    })),
    reconciliation: reconRows,
    reports: reportsRaw.map((r) => ({
      reportDate: r.reportDate,
      filesReceived: r.filesReceived,
      filesQuarantined: r.filesQuarantined,
      jobsSucceeded: r.jobsSucceeded,
      jobsFailed: r.jobsFailed,
      dqChecksPassed: r.dqChecksPassed,
      dqChecksFailed: r.dqChecksFailed,
      openIncidents: r.openIncidents,
      reconciliationStatus: r.reconciliationStatus,
      overallHealth: r.overallHealth,
    })),
    incoming: incomingList.map((f) => ({
      fileName: f.fileName,
      sizeBytes: f.sizeBytes,
      receivedAt: f.receivedAt.toISOString(),
    })),
    sites,
    siteTrend,
    batchTimeline,
    config: {
      dagId: config.settings.dagId,
      escalationThresholdMinutes: config.settings.escalationThresholdMinutes,
      refreshSeconds: config.settings.refreshSeconds,
      trendDays: config.settings.trendDays,
      rejectedThresholdPct: config.settings.rejectedThresholdPct,
      alertChannels: config.settings.alertChannels,
      expectedFiles: Object.values(config.manifest).map((d) => ({
        dataset: d.name,
        pattern: d.pattern,
        arrival: d.expectedArrival,
        slaHours: d.slaHours,
      })),
    },
  }
}
