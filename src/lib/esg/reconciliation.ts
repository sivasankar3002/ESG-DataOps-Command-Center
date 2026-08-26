// =====================================================================
// ESG DataOps Command Center — MODULE 5b: source-to-target reconciliation
// Compares staging (source) against the warehouse (target) per batch:
//   - row count reconciliation (staging valid rows vs fact rows)
//   - aggregate reconciliation (total energy_kwh / emissions_co2e)
//   - freshness check (warehouse staleness policy)
//   - cross-dataset emissions consistency (carbon ledger vs energy feed)
// All results land in dq_check_results; mismatches raise incidents.
// =====================================================================

import { db } from '@/lib/db'
import { loadConfig } from './config'
import { recordCheck } from './dq'
import type { PipelineContext } from './context'

export interface ReconRow {
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
  status: 'PASS' | 'FAIL' | 'NO_DATA'
}

/**
 * TASK 6: reconcile_source_to_target_task
 */
export async function reconcileSourceToTargetTask(ctx: PipelineContext): Promise<{
  rowsRead: number
  rowsLoaded: number
  rowsRejected: number
}> {
  const config = loadConfig()

  // ---- source: staging rows eligible for warehouse load ----------------
  const sourceRows = await db.stagingEnergyData.findMany({
    where: { batchId: ctx.batchId, dataset: 'energy_consumption', validationStatus: 'VALID' },
    select: { energyKwh: true, emissionsCo2e: true },
  })
  const sourceCount = sourceRows.length
  const sourceEnergy = sourceRows.reduce((acc, r) => acc + (r.energyKwh ?? 0), 0)
  const sourceEmissions = sourceRows.reduce((acc, r) => acc + (r.emissionsCo2e ?? 0), 0)

  // ---- target: warehouse fact rows for this batch -------------------------
  const targetRows = await db.factEnergyEmissions.findMany({
    where: { batchId: ctx.batchId },
    select: { energyKwh: true, emissionsCo2e: true },
  })
  const targetCount = targetRows.length
  const targetEnergy = targetRows.reduce((acc, r) => acc + r.energyKwh, 0)
  const targetEmissions = targetRows.reduce((acc, r) => acc + r.emissionsCo2e, 0)

  // ---- source_to_target_rowcount_recon -------------------------------------
  const diffRows = sourceCount - targetCount
  await recordCheck(ctx, {
    checkName: 'source_to_target_rowcount_recon',
    status: diffRows === 0 ? 'PASS' : 'FAIL',
    tableName: 'staging_energy_data -> fact_energy_emissions',
    columnName: 'batch_id',
    expectedValue: sourceCount,
    actualValue: targetCount,
    thresholdValue: 0,
    errorDetails:
      diffRows === 0
        ? null
        : `Row count mismatch: staging(valid)=${sourceCount} vs fact=${targetCount} (diff ${diffRows}) for batch ${ctx.batchId}`,
    incidentTable: 'fact_energy_emissions',
    incidentDescription:
      diffRows === 0
        ? undefined
        : `Reconciliation mismatch: ${Math.abs(diffRows)} row(s) loaded to fact_energy_emissions differ from validated staging rows for batch ${ctx.batchId}`,
  })

  // ---- source_to_target_aggregate_recon --------------------------------------
  const tolerance = config.settings.aggregateTolerance
  const energyDiff = sourceEnergy - targetEnergy
  const emissionsDiff = sourceEmissions - targetEmissions
  const aggOk = Math.abs(energyDiff) <= tolerance && Math.abs(emissionsDiff) <= tolerance
  await recordCheck(ctx, {
    checkName: 'source_to_target_aggregate_recon',
    status: aggOk ? 'PASS' : 'FAIL',
    tableName: 'staging_energy_data -> fact_energy_emissions',
    columnName: 'energy_kwh, emissions_co2e',
    expectedValue: `${sourceEnergy.toFixed(2)} kWh / ${sourceEmissions.toFixed(2)} kgCO2e`,
    actualValue: `${targetEnergy.toFixed(2)} kWh / ${targetEmissions.toFixed(2)} kgCO2e`,
    thresholdValue: tolerance,
    errorDetails: aggOk
      ? null
      : `Aggregate mismatch: energy diff ${energyDiff.toFixed(3)} kWh, emissions diff ${emissionsDiff.toFixed(3)} kgCO2e`,
    incidentTable: 'fact_energy_emissions',
    incidentDescription: aggOk
      ? undefined
      : `Aggregate reconciliation mismatch for batch ${ctx.batchId}: totals in fact_energy_emissions deviate from staging beyond tolerance ${tolerance}`,
  })

  // ---- cross_dataset_emissions_consistency (carbon ledger vs energy feed) ----
  const energyFeed = await db.stagingEnergyData.findMany({
    where: { batchId: ctx.batchId, dataset: 'energy_consumption', validationStatus: 'VALID' },
    select: { emissionsCo2e: true },
  })
  const carbonFeed = await db.stagingEnergyData.findMany({
    where: { batchId: ctx.batchId, dataset: 'carbon_emissions', validationStatus: 'VALID' },
    select: { emissionsCo2e: true },
  })
  if (energyFeed.length > 0 && carbonFeed.length > 0) {
    const energyTotal = energyFeed.reduce((a, r) => a + (r.emissionsCo2e ?? 0), 0)
    const carbonTotal = carbonFeed.reduce((a, r) => a + (r.emissionsCo2e ?? 0), 0)
    const variancePct = energyTotal > 0 ? Math.abs((carbonTotal - energyTotal) / energyTotal) * 100 : 0
    await recordCheck(ctx, {
      checkName: 'cross_dataset_emissions_consistency',
      status: variancePct <= 5 ? 'PASS' : variancePct <= 10 ? 'WARN' : 'FAIL',
      tableName: 'staging_energy_data',
      columnName: 'emissions_co2e',
      expectedValue: `${energyTotal.toFixed(2)} (energy feed)`,
      actualValue: `${carbonTotal.toFixed(2)} (carbon ledger)`,
      thresholdValue: '5%',
      errorDetails:
        variancePct > 5
          ? `Carbon ledger deviates ${variancePct.toFixed(1)}% from energy-derived emissions — investigate source alignment`
          : null,
    })
  }

  // ---- freshness is evaluated pre-load inside run_data_quality_checks_task --

  ctx.logger.info(
    'reconcile',
    `Batch ${ctx.batchId}: source=${sourceCount} target=${targetCount} diff=${diffRows} ` +
      `energy ${sourceEnergy.toFixed(1)}/${targetEnergy.toFixed(1)} kWh`,
  )

  return { rowsRead: sourceCount, rowsLoaded: targetCount, rowsRejected: Math.abs(diffRows) }
}

/** Reconciliation rows for the dashboard (latest N batches). */
export async function getReconciliationRows(limit = 15): Promise<ReconRow[]> {
  const batches = await db.jobRunAudit.findMany({
    distinct: ['batchId'],
    orderBy: { startTime: 'desc' },
    select: { batchId: true, startTime: true },
    take: limit * 3,
  })

  const rows: ReconRow[] = []
  for (const b of batches.slice(0, limit)) {
    const businessDate = batchIdToDate(b.batchId)
    const source = await db.stagingEnergyData.findMany({
      where: { batchId: b.batchId, dataset: 'energy_consumption', validationStatus: 'VALID' },
      select: { energyKwh: true, emissionsCo2e: true },
    })
    const target = await db.factEnergyEmissions.findMany({
      where: { batchId: b.batchId },
      select: { energyKwh: true, emissionsCo2e: true },
    })
    const sourceCount = source.length
    const targetCount = target.length
    const sourceEnergy = source.reduce((a, r) => a + (r.energyKwh ?? 0), 0)
    const targetEnergy = target.reduce((a, r) => a + r.energyKwh, 0)
    const sourceEmissions = source.reduce((a, r) => a + (r.emissionsCo2e ?? 0), 0)
    const targetEmissions = target.reduce((a, r) => a + r.emissionsCo2e, 0)
    rows.push({
      batchId: b.batchId,
      businessDate,
      sourceCount,
      targetCount,
      diffRows: sourceCount - targetCount,
      sourceEnergy: round2(sourceEnergy),
      targetEnergy: round2(targetEnergy),
      energyDiff: round2(sourceEnergy - targetEnergy),
      sourceEmissions: round2(sourceEmissions),
      targetEmissions: round2(targetEmissions),
      status: sourceCount === targetCount && Math.abs(sourceEnergy - targetEnergy) <= 0.01 ? 'PASS' : 'FAIL',
    })
  }
  return rows
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** Extract business date from a batch id (B-YYYYMMDD-NNN). */
export function batchIdToDate(batchId: string): string {
  const m = batchId.match(/^B-(\d{4})(\d{2})(\d{2})-/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : 'unknown'
}
