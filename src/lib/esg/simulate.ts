// =====================================================================
// ESG DataOps Command Center — MODULE 12: failure simulation runner
// Equivalent of scripts/simulation/*.py — each simulation:
//   1. creates the file/database condition for a scenario
//   2. runs the pipeline
//   3. verifies the expected incident/alert was created
// Exposed via POST /api/simulate and the Control Room tab.
// =====================================================================

import { db } from '@/lib/db'
import { generateSyntheticData } from './datagen'
import { runPipeline, type RunPipelineResult } from './engine'
import { addDays, toIsoDate } from './fsx'
import type { IncidentType, Scenario } from './types'

export const SIMULATION_KEYS = [
  'success',
  'missing_file',
  'empty_file',
  'schema_drift',
  'duplicates',
  'null_values',
  'checksum_mismatch',
  'sla_breach',
  'load_failure',
  'row_count_mismatch',
  'freshness_failure',
] as const
export type SimulationKey = (typeof SIMULATION_KEYS)[number]

export interface SimulationResult {
  simulation: SimulationKey
  businessDate: string
  batchId: string
  dagStatus: RunPipelineResult['dagStatus']
  expectedIncidentType: IncidentType | null
  verified: boolean
  incidents: RunPipelineResult['incidents']
  files: RunPipelineResult['files']
  dq: RunPipelineResult['dq']
  message: string
}

const SCENARIO_FOR: Record<SimulationKey, Scenario | null> = {
  success: 'good',
  missing_file: 'missing_file',
  empty_file: 'empty_file',
  schema_drift: 'missing_column',
  duplicates: 'duplicates',
  null_values: 'null_values',
  checksum_mismatch: 'bad_checksum',
  sla_breach: 'sla_breach',
  load_failure: 'load_failure',
  row_count_mismatch: 'row_count_mismatch',
  freshness_failure: null, // special: gap detection run
}

const EXPECTED_INCIDENT: Record<SimulationKey, IncidentType | null> = {
  success: null,
  missing_file: 'FILE_MISSING',
  empty_file: 'EMPTY_FILE',
  schema_drift: 'SCHEMA_DRIFT',
  duplicates: 'DUPLICATE_RECORDS',
  null_values: 'NULL_VALUES',
  checksum_mismatch: 'CHECKSUM_MISMATCH',
  sla_breach: 'SLA_BREACH',
  load_failure: 'LOAD_FAILURE',
  row_count_mismatch: 'ROW_COUNT_MISMATCH',
  freshness_failure: 'FRESHNESS_FAILURE',
}

/** Run one failure simulation end-to-end and verify the outcome. */
export async function runSimulation(simulation: SimulationKey): Promise<SimulationResult> {
  const today = new Date()
  const todayStr = toIsoDate(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())))

  if (simulation === 'freshness_failure') {
    // Gap detection: process a business date 2+ days beyond the latest
    // warehouse reading — the pre-load freshness check detects that the
    // warehouse has no data through yesterday (simulated feed outage).
    const latest = await db.factEnergyEmissions.findFirst({
      orderBy: { readingDate: 'desc' },
      select: { readingDate: true },
    })
    const target = latest ? addDays(latest.readingDate, 3) : addDays(new Date(`${todayStr}T00:00:00.000Z`), 2)
    const businessDate = toIsoDate(target)
    generateSyntheticData({ businessDate, scenarios: [] })
    const run = await runPipeline({ businessDate, trigger: 'simulation' })
    return verify(simulation, businessDate, run)
  }

  if (simulation === 'missing_file') {
    // Feed outage on the next business day AFTER any data the platform has
    // already seen. The target date must provably have no ingested feeds —
    // if earlier runs (seed history, replays, prior simulations) already
    // ingested feeds for "today + 1", the file sensor would legitimately
    // find them via file_ingestion_log and the outage would be masked.
    const latestIngested = await db.fileIngestionLog.findFirst({
      orderBy: { expectedArrivalDate: 'desc' },
      select: { expectedArrivalDate: true },
    })
    const todayUtc = new Date(`${todayStr}T00:00:00.000Z`)
    const latestUtc = latestIngested
      ? new Date(
          `${latestIngested.expectedArrivalDate.toISOString().slice(0, 10)}T00:00:00.000Z`,
        )
      : todayUtc
    const base = latestUtc > todayUtc ? latestUtc : todayUtc
    const businessDate = toIsoDate(addDays(base, 1))
    generateSyntheticData({ businessDate, scenarios: ['missing_file'] })
    const run = await runPipeline({ businessDate, trigger: 'simulation' })
    return verify(simulation, businessDate, run)
  }

  const scenario = SCENARIO_FOR[simulation]
  const businessDate = todayStr
  generateSyntheticData({ businessDate, scenarios: scenario ? [scenario] : [] })
  const run = await runPipeline({ businessDate, trigger: 'simulation' })
  return verify(simulation, businessDate, run)
}

function verify(
  simulation: SimulationKey,
  businessDate: string,
  run: RunPipelineResult,
): SimulationResult {
  const expected = EXPECTED_INCIDENT[simulation]
  const found = expected ? run.incidents.find((i) => i.incidentType === expected) : null
  const verified = expected ? Boolean(found) : run.incidents.length === 0

  let message: string
  if (!expected) {
    message =
      run.incidents.length === 0
        ? `Success run verified: batch ${run.batchId} completed with 0 incidents, ${run.dq.passed}/${run.dq.executed} checks passed.`
        : `Batch ${run.batchId} completed but ${run.incidents.length} incident(s) were raised — check the Data Quality tab.`
  } else if (found) {
    message =
      `Verified: ${expected} incident ${found.incidentId} [${found.severity}] was created for batch ${run.batchId}. ` +
      `Evidence package available on the incident record.`
  } else {
    message =
      `Expected a ${expected} incident but none was created for batch ${run.batchId}. ` +
      `Inspect the pipeline run and dq_check_results for details.`
  }

  return {
    simulation,
    businessDate,
    batchId: run.batchId,
    dagStatus: run.dagStatus,
    expectedIncidentType: expected,
    verified,
    incidents: run.incidents,
    files: run.files,
    dq: run.dq,
    message,
  }
}
