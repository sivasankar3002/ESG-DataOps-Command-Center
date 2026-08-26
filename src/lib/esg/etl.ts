// =====================================================================
// ESG DataOps Command Center — MODULE 4: ETL/ELT pipeline layer
//   load_staging_task  : parse validated files, row-level validation,
//                        reject bad records with reasons (full lineage)
//   load_warehouse_task: upsert dim_site, load fact_energy_emissions
//                        (incremental by batch_id + reading_date)
// A structurally corrupted file aborts the bulk load (LOAD_FAILURE),
// exactly like a real COPY/bulk-insert would.
// =====================================================================

import fs from 'fs'
import { db } from '@/lib/db'
import { loadConfig } from './config'
import { isValidIsoDate, moveFileWithSidecar, parseCsv, parseIsoDate } from './fsx'
import { statsFor, type PipelineContext } from './context'
import { validatedReceipts } from './ingestion'
import type { RejectedRowInfo } from './evidence'

function pick(row: string[], header: string[], col: string): string {
  const idx = header.indexOf(col)
  return idx >= 0 && idx < row.length ? (row[idx] ?? '').trim() : ''
}

interface EnergyStagingRow {
  stagingId: string
  batchId: string
  dataset: string
  recordId: string
  siteId: string | null
  readingDate: Date | null
  energyKwh: number | null
  emissionsCo2e: number | null
  sourceFileName: string
  sourceSystem: string
  loadTimestamp: Date
  validationStatus: string
  rejectionReason: string | null
}

interface SiteStagingRow {
  stagingId: string
  batchId: string
  siteId: string
  siteName: string
  country: string
  region: string
  siteType: string
  effectiveFromDate: Date
  sourceFileName: string
  loadTimestamp: Date
  validationStatus: string
  rejectionReason: string | null
}

/**
 * TASK 3: load_staging_task
 * Bulk load validated files into staging with per-record validation.
 * Rejected records are kept in staging with validation_status=REJECTED
 * and a machine-readable rejection reason (evidence for L1 support).
 */
export async function loadStagingTask(ctx: PipelineContext): Promise<{
  rowsRead: number
  rowsLoaded: number
  rowsRejected: number
}> {
  const config = loadConfig()
  const receipts = validatedReceipts(ctx)
  let rowsRead = 0
  let rowsLoaded = 0
  let rowsRejected = 0
  let rowCounter = 0 // batch-scoped staging id counter

  for (const receipt of receipts) {
    ctx.logger.info('etl', `Loading ${receipt.fileName} into staging`)
    await db.fileIngestionLog.update({
      where: { fileId: receipt.fileId },
      data: { fileStatus: 'PROCESSING' },
    })
    receipt.fileStatus = 'PROCESSING'

    const content = fs.readFileSync(receipt.absPath, 'utf-8')
    let parsed: ReturnType<typeof parseCsv>
    try {
      parsed = parseCsv(content)
    } catch (err) {
      // Structurally corrupted record — bulk load aborts (LOAD_FAILURE).
      const message = err instanceof Error ? err.message : String(err)
      receipt.fileStatus = 'FAILED'
      receipt.errorMessage = message
      await db.fileIngestionLog.update({
        where: { fileId: receipt.fileId },
        data: { fileStatus: 'FAILED', errorMessage: `Bulk load aborted: ${message}` },
      })
      ctx.logger.error('etl', `Bulk load ABORTED for ${receipt.fileName}: ${message}`)
      throw err
    }

    const stats = statsFor(ctx, receipt.dataset)
    const rules = config.rules.datasets[receipt.dataset]
    const dsManifest = config.manifest[receipt.dataset]
    const seenKeys = new Set<string>()

    const energyRows: EnergyStagingRow[] = []
    const siteRows: SiteStagingRow[] = []

    for (let i = 0; i < parsed.rows.length; i++) {
      const row = parsed.rows[i]
      const col = (name: string) => pick(row, parsed.header, name)
      const isSiteMaster = receipt.dataset === 'site_master'
      const recordId = col('record_id')
      const siteId = col('site_id')
      const pk = isSiteMaster ? siteId : recordId

      rowsRead++
      stats.totalRead++

      let reason: string | null = null
      let readingDate: Date | null = null
      let energyNum: number | null = null
      let emissionsNum: number | null = null

      // ---- 1. mandatory not-null columns --------------------------------
      if (!reason) {
        const values: Record<string, string> = {
          record_id: recordId,
          site_id: siteId,
          reading_date: col('reading_date'),
          energy_kwh: col('energy_kwh'),
          emissions_co2e: col('emissions_co2e'),
          site_name: col('site_name'),
          country: col('country'),
        }
        for (const mandatory of rules?.mandatoryNotNull ?? []) {
          if (values[mandatory] !== undefined && values[mandatory] === '') {
            reason = `null:${mandatory}`
            stats.nullsByColumn[mandatory] = (stats.nullsByColumn[mandatory] ?? 0) + 1
            break
          }
        }
      }

      // ---- 2. duplicate primary key ---------------------------------------
      if (!reason && pk && seenKeys.has(pk)) {
        reason = 'duplicate_record_id'
        stats.duplicates++
      }

      // ---- 3. date validity ---------------------------------------------------
      if (!reason) {
        const dateStr = isSiteMaster ? col('effective_from_date') : col('reading_date')
        if (!isValidIsoDate(dateStr)) {
          reason = 'invalid_date_format'
          stats.invalidDates++
        } else {
          readingDate = parseIsoDate(dateStr)
        }
      }

      // ---- 4. numeric range / cast safety -------------------------------------
      if (!reason && !isSiteMaster) {
        const energyRange = rules?.numericRange['energy_kwh']
        const emissionsRange = rules?.numericRange['emissions_co2e']
        const energyStr = col('energy_kwh')
        const emissionsStr = col('emissions_co2e')

        if (energyRange && energyStr !== '') {
          energyNum = Number(energyStr)
          if (Number.isNaN(energyNum)) {
            reason = 'invalid_value:energy_kwh'
            stats.rangeViolations++
          } else if (
            energyNum < (energyRange.min ?? -Infinity) ||
            energyNum > (energyRange.max ?? Infinity)
          ) {
            reason = `range_violation:energy_kwh=${energyNum}`
            stats.rangeViolations++
          }
        }
        if (!reason && emissionsRange && emissionsStr !== '') {
          emissionsNum = Number(emissionsStr)
          if (Number.isNaN(emissionsNum)) {
            reason = 'invalid_value:emissions_co2e'
            stats.rangeViolations++
          } else if (
            emissionsNum < (emissionsRange.min ?? -Infinity) ||
            emissionsNum > (emissionsRange.max ?? Infinity)
          ) {
            reason = `range_violation:emissions_co2e=${emissionsNum}`
            stats.rangeViolations++
          }
        }
      }

      if (pk) seenKeys.add(pk)

      // ---- build the staging row -----------------------------------------------
      rowCounter++
      const stagingId = `S-${ctx.batchId}-${rowCounter}`
      if (isSiteMaster) {
        siteRows.push({
          stagingId,
          batchId: ctx.batchId,
          siteId: siteId || 'UNKNOWN',
          siteName: col('site_name'),
          country: col('country'),
          region: col('region'),
          siteType: col('site_type'),
          effectiveFromDate: readingDate ?? parseIsoDate('2023-01-01'),
          sourceFileName: receipt.fileName,
          loadTimestamp: ctx.asOf,
          validationStatus: reason ? 'REJECTED' : 'VALID',
          rejectionReason: reason,
        })
      } else {
        // For evidence: keep parseable numerics even on rejected rows
        const evidenceEnergy = energyNum ?? (col('energy_kwh') !== '' && !Number.isNaN(Number(col('energy_kwh'))) ? Number(col('energy_kwh')) : null)
        const evidenceEmissions =
          emissionsNum ??
          (col('emissions_co2e') !== '' && !Number.isNaN(Number(col('emissions_co2e')))
            ? Number(col('emissions_co2e'))
            : null)
        if (reason) {
          ctx.rejectedRows.push({
            recordId: recordId || `(row ${i + 2})`,
            siteId: siteId || null,
            readingDate: col('reading_date') || null,
            energyKwh: evidenceEnergy,
            emissionsCo2e: evidenceEmissions,
            reason,
            sourceFileName: receipt.fileName,
          })
        }
        energyRows.push({
          stagingId,
          batchId: ctx.batchId,
          dataset: receipt.dataset,
          recordId: recordId || `UNKNOWN-${i + 2}`,
          siteId: siteId || null,
          readingDate: readingDate ?? (isValidIsoDate(col('reading_date')) ? parseIsoDate(col('reading_date')) : null),
          energyKwh: energyNum,
          emissionsCo2e: emissionsNum,
          sourceFileName: receipt.fileName,
          sourceSystem: dsManifest?.sourceSystem ?? 'UNKNOWN',
          loadTimestamp: ctx.asOf,
          validationStatus: reason ? 'REJECTED' : 'VALID',
          rejectionReason: reason,
        })
      }

      if (reason) {
        stats.totalRejected++
        rowsRejected++
      } else {
        stats.totalValid++
        rowsLoaded++
      }
    }

    // Bulk insert (single createMany per file — mirrors COPY semantics)
    if (energyRows.length > 0) await db.stagingEnergyData.createMany({ data: energyRows })
    if (siteRows.length > 0) await db.stagingSiteMaster.createMany({ data: siteRows })

    // Promote the file to the processed archive (with its manifest)
    moveFileWithSidecar(receipt.absPath, receipt.manifestPath, config.settings.processedDir)
    receipt.fileStatus = 'PROCESSED'
    receipt.zone = 'PROCESSED'
    await db.fileIngestionLog.update({
      where: { fileId: receipt.fileId },
      data: { fileStatus: 'PROCESSED', zone: 'PROCESSED' },
    })
    ctx.logger.info(
      'etl',
      `Staged ${receipt.fileName}: ${stats.totalValid} valid / ${stats.totalRejected} rejected rows`,
    )
  }

  return { rowsRead, rowsLoaded, rowsRejected }
}

/**
 * TASK 5: load_warehouse_task
 * Transform + load: upsert dim_site from the site master snapshot, then
 * load validated energy records into fact_energy_emissions (only rows
 * whose site_id exists in the dimension — referential integrity).
 */
export async function loadWarehouseTask(ctx: PipelineContext): Promise<{
  rowsRead: number
  rowsLoaded: number
  rowsRejected: number
}> {
  // ---- dim_site (SCD-style upsert on site_id) -------------------------
  const masterRows = await db.stagingSiteMaster.findMany({
    where: { batchId: ctx.batchId, validationStatus: 'VALID' },
  })
  for (const site of masterRows) {
    await db.dimSite.upsert({
      where: { siteId: site.siteId },
      create: {
        siteId: site.siteId,
        siteName: site.siteName,
        country: site.country,
        region: site.region,
        siteType: site.siteType,
        effectiveFromDate: site.effectiveFromDate,
        activeFlag: true,
        loadedAt: ctx.asOf,
      },
      update: {
        siteName: site.siteName,
        country: site.country,
        region: site.region,
        siteType: site.siteType,
        effectiveFromDate: site.effectiveFromDate,
        activeFlag: true,
        loadedAt: ctx.asOf,
      },
    })
  }
  ctx.logger.info('etl', `dim_site upserted ${masterRows.length} site(s)`)

  // ---- fact_energy_emissions ------------------------------------------
  const validEnergy = await db.stagingEnergyData.findMany({
    where: { batchId: ctx.batchId, dataset: 'energy_consumption', validationStatus: 'VALID' },
  })
  const dimSites = new Set((await db.dimSite.findMany({ select: { siteId: true } })).map((s) => s.siteId))

  const factRows: {
    batchId: string
    recordId: string
    siteId: string
    readingDate: Date
    energyKwh: number
    emissionsCo2e: number
    sourceFileName: string
    sourceSystem: string
    loadedAt: Date
  }[] = []
  let orphanSkipped = 0
  for (const row of validEnergy) {
    if (!row.siteId || !dimSites.has(row.siteId)) {
      orphanSkipped++
      continue
    }
    factRows.push({
      batchId: ctx.batchId,
      recordId: row.recordId,
      siteId: row.siteId,
      readingDate: row.readingDate ?? new Date(),
      energyKwh: row.energyKwh ?? 0,
      emissionsCo2e: row.emissionsCo2e ?? 0,
      sourceFileName: row.sourceFileName,
      sourceSystem: row.sourceSystem,
      loadedAt: ctx.asOf,
    })
  }
  if (factRows.length > 0) {
    await db.factEnergyEmissions.createMany({ data: factRows })
  }
  ctx.logger.info(
    'etl',
    `fact_energy_emissions loaded ${factRows.length} row(s)${orphanSkipped > 0 ? `, ${orphanSkipped} orphan row(s) skipped` : ''}`,
  )

  return { rowsRead: validEnergy.length, rowsLoaded: factRows.length, rowsRejected: orphanSkipped }
}
