// =====================================================================
// ESG DataOps Command Center — demo history seeder
// Produces 14 days of realistic operational history:
//   - good days, scattered incidents (P1..P3), cascading freshness
//     failures, quarantined files, resolved + open incidents,
//     auto-escalations, acknowledged alerts and daily reports.
// Today's feeds are generated but NOT processed, so the operator can
// run the DAG themselves from the Control Room.
// =====================================================================

import fs from 'fs'
import { resolvePath } from './config'
import { db } from '@/lib/db'
import { generateSyntheticData } from './datagen'
import { runPipeline } from './engine'
import { acknowledgeAlert } from './alerts'
import { runEscalationSweep } from './incidents'
import { toIsoDate } from './fsx'
import type { Scenario } from './types'

function localDateStr(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return localDateStr(d)
}

/** Wipe every operational table + landing zones (full reset). */
export async function wipeAll(): Promise<void> {
  await db.incidentEvidence.deleteMany()
  await db.workNote.deleteMany()
  await db.incidentLog.deleteMany()
  await db.dqCheckResult.deleteMany()
  await db.jobRunAudit.deleteMany()
  await db.fileIngestionLog.deleteMany()
  await db.stagingEnergyData.deleteMany()
  await db.stagingSiteMaster.deleteMany()
  await db.factEnergyEmissions.deleteMany()
  await db.dimSite.deleteMany()
  await db.alertLog.deleteMany()
  await db.dailyOpsReport.deleteMany()
  for (const dir of ['data/incoming', 'data/quarantine', 'data/processed', 'evidence', 'reports']) {
    const abs = resolvePath(dir)
    if (fs.existsSync(abs)) {
      for (const f of fs.readdirSync(abs)) {
        if (f !== '.gitkeep') {
          try {
            fs.rmSync(`${abs}/${f}`, { recursive: true, force: true })
          } catch {
            // ignore unreadable artefacts
          }
        }
      }
    }
  }
}

const RESOLUTION_NOTES: Record<string, string> = {
  DUPLICATE_RECORDS:
    'Source system confirmed a replay bug in the export job; duplicates were safely rejected by the pipeline. Fix deployed upstream; reconciliation verified.',
  FILE_MISSING:
    'Feed re-delivered by the source system owner; backfill batch loaded and reconciled. Supplier performance ticket raised.',
  NULL_VALUES:
    'Site onboarding in the master lagged the meter feed; site_id backfilled upstream and records re-delivered via backfill batch.',
  SCHEMA_DRIFT:
    'Schema change confirmed as a legitimate contract update; required_columns updated in data_quality_rules.yaml; feed re-delivered in the new format and loaded.',
  CHECKSUM_MISMATCH:
    'Transfer truncation confirmed by the middleware team; file re-transferred with a correct checksum manifest; batch re-run successfully.',
  FRESHNESS_FAILURE:
    'Root cause: upstream feed outage (see linked incident). Feeds recovered; freshness verified on the subsequent run.',
  RANGE_VIOLATION:
    'Meter sensor fault confirmed by site operations; corrected readings re-delivered and loaded via backfill.',
  SLA_BREACH: 'Late delivery investigated with the supplier; transit issue resolved.',
  ROW_COUNT_MISMATCH: 'Manifest generation bug confirmed upstream; corrected manifests delivered.',
  LOAD_FAILURE: 'Corrupt record removed at source; clean file re-delivered; batch re-run successfully.',
  FILE_CORRUPTED: 'Clean copy re-delivered and loaded.',
  EMPTY_FILE: 'Empty export confirmed as accidental; re-delivered with data and loaded.',
}

export interface SeedResult {
  daysSeeded: number
  batches: string[]
  incidentsCreated: number
  openIncidents: number
  message: string
}

/** Seed 14 days of operational history ending today. */
export async function seedDemoData(): Promise<SeedResult> {
  await wipeAll()

  // [daysAgo, scenarios, runHour] — a believable incident history
  const schedule: { day: number; scenarios: Scenario[]; hour: number }[] = [
    { day: 13, scenarios: [], hour: 7.5 },
    { day: 12, scenarios: [], hour: 7.5 },
    { day: 11, scenarios: [], hour: 7.5 },
    { day: 10, scenarios: ['duplicates'], hour: 7.5 },
    { day: 9, scenarios: [], hour: 7.5 },
    { day: 8, scenarios: ['missing_file'], hour: 7.5 },
    { day: 7, scenarios: [], hour: 7.5 },
    { day: 6, scenarios: ['null_values'], hour: 7.5 },
    { day: 5, scenarios: [], hour: 7.5 },
    { day: 4, scenarios: ['missing_column'], hour: 7.5 },
    { day: 3, scenarios: ['bad_checksum'], hour: 7.5 },
    { day: 2, scenarios: ['row_count_mismatch'], hour: 7.5 },
    { day: 1, scenarios: ['sla_breach', 'duplicates'], hour: 12 }, // late file -> midday run
    { day: 0, scenarios: [], hour: -1 }, // today: files only, pipeline NOT run
  ]

  const batches: string[] = []
  let incidentsCreated = 0

  for (const entry of schedule) {
    const businessDate = daysAgo(entry.day)
    generateSyntheticData({ businessDate, scenarios: entry.scenarios, siteCount: 24 })
    if (entry.hour < 0) continue // leave today's feeds in the landing zone

    const asOf = new Date(`${businessDate}T00:00:00`)
    asOf.setHours(Math.floor(entry.hour), (entry.hour % 1) * 60, 0, 0)
    const run = await runPipeline({ businessDate, asOf, trigger: 'seed' })
    batches.push(run.batchId)
    incidentsCreated += run.incidents.length
  }

  // ---- post-process incident lifecycles (as-of realistic times) --------
  const now = new Date()
  const allIncidents = await db.incidentLog.findMany({ orderBy: { createdAt: 'asc' } })

  for (const incident of allIncidents) {
    const createdDay = localDateStr(incident.createdAt)
    const ageDays = Math.floor((now.getTime() - incident.createdAt.getTime()) / 86400000)

    if (ageDays >= 3) {
      // Everything older than 3 days is resolved/closed by the L1 team.
      const isP1 = incident.severity === 'P1'
      await db.incidentLog.update({
        where: { incidentId: incident.incidentId },
        data: {
          status: ageDays >= 5 ? 'CLOSED' : 'RESOLVED',
          resolutionNotes: RESOLUTION_NOTES[incident.incidentType] ?? 'Resolved by L1 support.',
          updatedAt: new Date(incident.createdAt.getTime() + 3 * 3600 * 1000),
        },
      })
      await db.workNote.create({
        data: {
          incidentId: incident.incidentId,
          note: `Investigated per runbook; ${RESOLUTION_NOTES[incident.incidentType] ?? 'issue resolved.'}`,
          author: 'L1 Support',
          createdAt: new Date(incident.createdAt.getTime() + 1.5 * 3600 * 1000),
        },
      })
      await db.workNote.create({
        data: {
          incidentId: incident.incidentId,
          note: isP1
            ? 'Post-incident review completed with the source system owner; monitoring heightened for one week.'
            : 'Verified on the dashboard; closing after the monitoring window.',
          author: 'L1 Support',
          createdAt: new Date(incident.createdAt.getTime() + 3 * 3600 * 1000),
        },
      })
    } else if (createdDay === daysAgo(2)) {
      // 2 days old: in progress, worked by L1
      await db.incidentLog.update({
        where: { incidentId: incident.incidentId },
        data: { status: 'IN_PROGRESS', updatedAt: new Date(incident.createdAt.getTime() + 2 * 3600 * 1000) },
      })
      await db.workNote.create({
        data: {
          incidentId: incident.incidentId,
          note: 'Investigating with the source system owner — manifest generation bug suspected. Evidence package attached.',
          author: 'L1 Support',
          createdAt: new Date(incident.createdAt.getTime() + 2 * 3600 * 1000),
        },
      })
    } else if (createdDay === daysAgo(1)) {
      // Yesterday: fresh, OPEN, first-level triage recorded
      await db.workNote.create({
        data: {
          incidentId: incident.incidentId,
          note: 'First-level checks completed per runbook; awaiting source system response before escalation.',
          author: 'L1 On-call',
          createdAt: new Date(incident.createdAt.getTime() + 45 * 60 * 1000),
        },
      })
    }
  }

  // ---- escalation manager sweep (auto-escalates stale incidents) --------
  const sweep = await runEscalationSweep(now)

  // ---- acknowledge historical alerts (on-call hygiene) -------------------
  const cutoff = new Date(now.getTime() - 24 * 3600 * 1000)
  const oldAlerts = await db.alertLog.findMany({
    where: { createdAt: { lt: cutoff }, acknowledgedFlag: false },
    select: { alertId: true },
  })
  for (const a of oldAlerts) await acknowledgeAlert(a.alertId)

  const openIncidents = await db.incidentLog.count({
    where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
  })

  return {
    daysSeeded: batches.length,
    batches,
    incidentsCreated,
    openIncidents,
    message:
      `Seeded ${batches.length} days of pipeline history (${incidentsCreated} incidents, ` +
      `${openIncidents} still open, ${sweep.escalated.length} auto-escalated). ` +
      `Today's feeds (${toIsoDate(new Date())}) are waiting in data/incoming — run the DAG from the Control Room.`,
  }
}
