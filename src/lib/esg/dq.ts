// =====================================================================
// ESG DataOps Command Center — MODULE 5: data quality engine
// YAML-configured validation engine. Every check writes a row into
// dq_check_results; failures mapped to an incident_type raise a
// ServiceNow-style incident automatically (see config/data_quality_rules.yaml).
// =====================================================================

import { db } from '@/lib/db'
import { loadConfig } from './config'
import { addDays, parseIsoDate, toIsoDate } from './fsx'
import { createIncident } from './incidents'
import { statsFor, toEvidenceContext, type PipelineContext } from './context'
import type { DqResultSnapshot } from './context'
import type { IncidentType } from './types'

// ---------------------------------------------------------------------
// Check recorder — persists to dq_check_results + keeps an in-memory
// snapshot for evidence packages.
// ---------------------------------------------------------------------
export interface CheckInput {
  checkName: string
  status: 'PASS' | 'FAIL' | 'WARN'
  tableName?: string | null
  columnName?: string | null
  expectedValue?: string | number | null
  actualValue?: string | number | null
  thresholdValue?: string | number | null
  errorDetails?: string | null
  incidentFile?: string | null
  incidentTable?: string | null
  incidentDescription?: string | null
  incidentErrorMessage?: string | null
  /** Mandatory context for conditional severity (SCHEMA_DRIFT / NULL_VALUES). */
  mandatory?: boolean
  dataset?: string
}

export async function recordCheck(ctx: PipelineContext, input: CheckInput): Promise<void> {
  const config = loadConfig()
  const rule = config.rules.checks[input.checkName]
  const severity = rule?.severity ?? 'MEDIUM'
  const runId = ctx.currentRunId

  const snapshot: DqResultSnapshot = {
    checkName: input.checkName,
    checkCategory: rule?.category ?? 'OPERATIONS',
    status: input.status,
    severity,
    tableName: input.tableName ?? null,
    columnName: input.columnName ?? null,
    expectedValue: input.expectedValue === null || input.expectedValue === undefined ? null : String(input.expectedValue),
    actualValue: input.actualValue === null || input.actualValue === undefined ? null : String(input.actualValue),
    thresholdValue: input.thresholdValue === null || input.thresholdValue === undefined ? null : String(input.thresholdValue),
    errorDetails: input.errorDetails ?? null,
  }

  await db.dqCheckResult.create({
    data: {
      batchId: ctx.batchId,
      runId,
      businessDate: ctx.businessDate,
      checkName: snapshot.checkName,
      checkCategory: snapshot.checkCategory,
      tableName: snapshot.tableName,
      columnName: snapshot.columnName,
      status: snapshot.status,
      expectedValue: snapshot.expectedValue,
      actualValue: snapshot.actualValue,
      thresholdValue: snapshot.thresholdValue,
      severity: snapshot.severity,
      errorDetails: snapshot.errorDetails,
      executedAt: ctx.asOf,
    },
  })
  ctx.dqResults.push(snapshot)
  ctx.logger.info(
    'dq',
    `Check ${input.checkName} [${input.status}/${severity}] on ${input.tableName ?? '-'}${input.columnName ? '.' + input.columnName : ''}`,
  )

  // Auto-incident on failure when the YAML rule maps an incident type.
  if (input.status === 'FAIL' && rule?.createIncident && rule.incidentType) {
    const incidentType = rule.incidentType as IncidentType
    const desc =
      input.incidentDescription ??
      `Data quality check ${input.checkName} failed on ${input.tableName ?? 'pipeline'} ` +
        `(expected: ${snapshot.expectedValue ?? '-'}, actual: ${snapshot.actualValue ?? '-'})`
    const result = await createIncident(
      {
        incidentType,
        batchId: ctx.batchId,
        runId,
        pipelineName: ctx.dagId,
        shortDescription:
          input.incidentDescription ??
          `${input.checkName} failed${input.dataset ? ` for ${input.dataset}` : ''} (batch ${ctx.batchId})`,
        detailedDescription:
          `${desc}\n\nCheck: ${input.checkName} (${snapshot.checkCategory})\n` +
          `Expected: ${snapshot.expectedValue ?? '-'} | Actual: ${snapshot.actualValue ?? '-'} | ` +
          `Threshold: ${snapshot.thresholdValue ?? '-'}\n` +
          `Batch: ${ctx.batchId} | Business date: ${ctx.businessDate} | Run: ${runId}\n` +
          `Details: ${snapshot.errorDetails ?? 'n/a'}`,
        errorMessage: input.incidentErrorMessage ?? snapshot.errorDetails,
        affectedFile: input.incidentFile ?? null,
        affectedTable: input.incidentTable ?? input.tableName ?? null,
        affectedCheck: input.checkName,
        mandatory: input.mandatory,
        evidenceCtx: toEvidenceContext(ctx),
        asOf: ctx.asOf,
      },
      ctx.logger,
    )
    ctx.incidentsCreated.push({
      incidentId: result.incidentId,
      severity: result.severity,
      incidentType,
    })
  }
}

// ---------------------------------------------------------------------
// TASK: run_data_quality_checks_task
// Staging-level checks (nulls, duplicates, dates, ranges, FK integrity,
// rejected threshold, quarantined files).
// ---------------------------------------------------------------------
export async function runDataQualityChecksTask(ctx: PipelineContext): Promise<{
  rowsRead: number
  rowsLoaded: number
  rowsRejected: number
}> {
  const config = loadConfig()
  const datasets = Object.keys(config.manifest)

  for (const dataset of datasets) {
    const rules = config.rules.datasets[dataset]
    const stats = statsFor(ctx, dataset)
    if (rules) {
      // ---- null_check_mandatory (per mandatory column) -----------------
      const nullCols = Object.entries(stats.nullsByColumn).filter(([, n]) => n > 0)
      if (nullCols.length > 0) {
        await recordCheck(ctx, {
          checkName: 'null_check_mandatory',
          status: 'FAIL',
          tableName: datasetStagingTable(dataset),
          columnName: nullCols.map(([c]) => c).join(','),
          expectedValue: 0,
          actualValue: nullCols.reduce((acc, [, n]) => acc + n, 0),
          errorDetails: `Null/missing values in mandatory column(s): ${nullCols
            .map(([c, n]) => `${c}=${n}`)
            .join('; ')}`,
          mandatory: true,
          dataset,
          incidentFile: stats.totalRead > 0 ? ctx.receipts.find((r) => r.dataset === dataset)?.fileName ?? null : null,
        })
      } else {
        await recordCheck(ctx, {
          checkName: 'null_check_mandatory',
          status: 'PASS',
          tableName: datasetStagingTable(dataset),
          columnName: rules.mandatoryNotNull.join(','),
          expectedValue: 0,
          actualValue: 0,
          dataset,
        })
      }

      // ---- duplicate_record_check ---------------------------------------
      await recordCheck(ctx, {
        checkName: 'duplicate_record_check',
        status: stats.duplicates > 0 ? 'FAIL' : 'PASS',
        tableName: datasetStagingTable(dataset),
        columnName: rules.primaryKey.join(','),
        expectedValue: 0,
        actualValue: stats.duplicates,
        errorDetails:
          stats.duplicates > 0
            ? `${stats.duplicates} duplicate ${rules.primaryKey.join(',')} occurrence(s) rejected during staging load`
            : null,
        dataset,
      })

      // ---- date_validity_check -------------------------------------------
      await recordCheck(ctx, {
        checkName: 'date_validity_check',
        status: stats.invalidDates > 0 ? 'FAIL' : 'PASS',
        tableName: datasetStagingTable(dataset),
        columnName: dataset === 'site_master' ? 'effective_from_date' : 'reading_date',
        expectedValue: 0,
        actualValue: stats.invalidDates,
        errorDetails: stats.invalidDates > 0 ? `${stats.invalidDates} row(s) with invalid date format rejected` : null,
        dataset,
      })

      // ---- numeric_range_check (rejected violations + staging scan) ------
      const rangeTargets = Object.keys(rules.numericRange)
      let stagingViolations = 0
      if (rangeTargets.length > 0) {
        const staged = await db.stagingEnergyData.findMany({
          where: { batchId: ctx.batchId, dataset, validationStatus: 'VALID' },
          select: { energyKwh: true, emissionsCo2e: true },
        })
        for (const row of staged) {
          for (const col of rangeTargets) {
            const range = rules.numericRange[col]
            const value = col === 'energy_kwh' ? row.energyKwh : col === 'emissions_co2e' ? row.emissionsCo2e : null
            if (value !== null && value !== undefined) {
              if ((range.min !== undefined && value < range.min) || (range.max !== undefined && value > range.max)) {
                stagingViolations++
              }
            }
          }
        }
      }
      const totalRange = stats.rangeViolations + stagingViolations
      await recordCheck(ctx, {
        checkName: 'numeric_range_check',
        status: totalRange > 0 ? 'FAIL' : 'PASS',
        tableName: datasetStagingTable(dataset),
        columnName: rangeTargets.join(','),
        expectedValue: 0,
        actualValue: totalRange,
        thresholdValue: rangeTargets
          .map((c) => `${c}>=${rules.numericRange[c].min ?? '-inf'}`)
          .join(','),
        errorDetails: totalRange > 0 ? `${stats.rangeViolations} rejected at load + ${stagingViolations} found in staged valid rows` : null,
        dataset,
      })

      // ---- referential_integrity_check (site_id in master) ---------------
      if (dataset !== 'site_master') {
        const stagedValid = await db.stagingEnergyData.findMany({
          where: { batchId: ctx.batchId, dataset, validationStatus: 'VALID' },
          select: { siteId: true },
        })
        const sites = new Set(
          (await db.dimSite.findMany({ select: { siteId: true } })).map((s) => s.siteId),
        )
        const batchMaster = await db.stagingSiteMaster.findMany({
          where: { batchId: ctx.batchId },
          select: { siteId: true },
        })
        for (const m of batchMaster) sites.add(m.siteId)
        const orphans = stagedValid.filter((r) => !r.siteId || !sites.has(r.siteId)).length
        await recordCheck(ctx, {
          checkName: 'referential_integrity_check',
          status: orphans > 0 ? 'FAIL' : 'PASS',
          tableName: datasetStagingTable(dataset),
          columnName: 'site_id',
          expectedValue: 0,
          actualValue: orphans,
          errorDetails: orphans > 0 ? `${orphans} row(s) reference site_id not present in site master / dim_site` : null,
          dataset,
        })
      }
    }

    // ---- rejected_threshold_check -----------------------------------------
    if (stats.totalRead > 0) {
      const pct = (stats.totalRejected / stats.totalRead) * 100
      await recordCheck(ctx, {
        checkName: 'rejected_threshold_check',
        status: pct > config.settings.rejectedThresholdPct ? 'FAIL' : 'PASS',
        tableName: datasetStagingTable(dataset),
        expectedValue: `<= ${config.settings.rejectedThresholdPct}%`,
        actualValue: `${pct.toFixed(1)}%`,
        thresholdValue: config.settings.rejectedThresholdPct,
        errorDetails:
          pct > config.settings.rejectedThresholdPct
            ? `${stats.totalRejected}/${stats.totalRead} rows rejected during staging load`
            : null,
        dataset,
      })
    }
  }

  // ---- quarantined_file_check (batch-level summary) ----------------------
  const quarantined = ctx.receipts.filter((r) => r.fileStatus === 'QUARANTINED')
  await recordCheck(ctx, {
    checkName: 'quarantined_file_check',
    status: quarantined.length > 0 ? 'WARN' : 'PASS',
    tableName: 'file_ingestion_log',
    expectedValue: 0,
    actualValue: quarantined.length,
    errorDetails:
      quarantined.length > 0
        ? quarantined.map((q) => `${q.fileName}: ${q.errorMessage}`).join(' | ')
        : null,
  })

  // ---- freshness_check (warehouse state BEFORE this batch's load) --------
  await runFreshnessCheck(ctx)

  const totals = ctx.loadStats.reduce(
    (acc, s) => ({
      read: acc.read + s.totalRead,
      loaded: acc.loaded + s.totalValid,
      rejected: acc.rejected + s.totalRejected,
    }),
    { read: 0, loaded: 0, rejected: 0 },
  )
  return { rowsRead: totals.read, rowsLoaded: totals.loaded, rowsRejected: totals.rejected }
}

function datasetStagingTable(dataset: string): string {
  if (dataset === 'site_master') return 'staging_site_master'
  return 'staging_energy_data'
}

// ---------------------------------------------------------------------
// Freshness check — evaluated pre-warehouse-load against the current
// warehouse state. Policy: the warehouse must already contain readings
// at least as recent as businessDate - 1 day (freshness_hours: 26 in
// the YAML). An empty warehouse is treated as initial bootstrap.
// ---------------------------------------------------------------------
export async function runFreshnessCheck(ctx: PipelineContext): Promise<void> {
  const latest = await db.factEnergyEmissions.findFirst({
    orderBy: { readingDate: 'desc' },
    select: { readingDate: true },
  })
  const businessDate = parseIsoDate(ctx.businessDate)
  const minFresh = addDays(businessDate, -1)
  const maxReading = latest ? latest.readingDate : null

  if (!maxReading) {
    await recordCheck(ctx, {
      checkName: 'freshness_check',
      status: 'PASS',
      tableName: 'fact_energy_emissions',
      columnName: 'reading_date',
      expectedValue: `>= ${toIsoDate(minFresh)}`,
      actualValue: 'initial load (warehouse empty)',
      thresholdValue: 26,
    })
    return
  }

  await recordCheck(ctx, {
    checkName: 'freshness_check',
    status: maxReading < minFresh ? 'FAIL' : 'PASS',
    tableName: 'fact_energy_emissions',
    columnName: 'reading_date',
    expectedValue: `>= ${toIsoDate(minFresh)}`,
    actualValue: toIsoDate(maxReading),
    thresholdValue: 26,
    errorDetails:
      maxReading < minFresh
        ? `Warehouse is stale: latest reading_date ${toIsoDate(maxReading)} is older than ${toIsoDate(minFresh)}`
        : null,
    incidentTable: 'fact_energy_emissions',
  })
}
