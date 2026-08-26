// =====================================================================
// ESG DataOps Command Center — MODULE 1: source & file ingestion layer
// Simulated SFTP/S3 landing zone watcher:
//   - polls data/incoming for expected daily feeds (file_manifest.yaml)
//   - validates naming convention, emptiness, checksum, header/schema,
//     row counts against the manifest sidecar
//   - quarantines failed files, promotes valid files to staging load
//   - logs every event in file_ingestion_log with full lineage
// =====================================================================

import fs from 'fs'
import { db } from '@/lib/db'
import { datasetAnyDateRegex, datasetFileRegex, expectedArrivalDate, loadConfig } from './config'
import { moveFile, moveFileWithSidecar, readFileText, scanZone, sha256 } from './fsx'
import { recordCheck } from './dq'
import { createIncident } from './incidents'
import { toEvidenceContext, type FileReceipt, type PipelineContext } from './context'

interface ManifestSidecar {
  file_name?: string
  dataset?: string
  business_date?: string
  source_system?: string
  expected_rows?: number
  checksum_algorithm?: string
  checksum_sha256?: string
}

function readManifest(path: string | null): ManifestSidecar | null {
  if (!path || !fs.existsSync(path)) return null
  try {
    return JSON.parse(fs.readFileSync(path, 'utf-8')) as ManifestSidecar
  } catch {
    return null
  }
}

/**
 * TASK 1: file_sensor_task
 * Detect incoming files for the business date, register them in
 * file_ingestion_log, detect missing feeds and SLA breaches.
 */
export async function fileSensorTask(ctx: PipelineContext): Promise<{
  rowsRead: number
  rowsLoaded: number
  rowsRejected: number
}> {
  const config = loadConfig()
  const incoming = scanZone(config.settings.incomingDir)
  const csvFiles = incoming.filter((f) => f.fileName.endsWith('.csv'))
  let receipts = 0
  let missing = 0

  for (const [datasetName, ds] of Object.entries(config.manifest)) {
    const regex = datasetFileRegex(ds, ctx.businessDate)
    const match = csvFiles.find((f) => regex.test(f.fileName))

    if (match) {
      // Register the arrival (RECEIVED) with computed checksum for lineage.
      const fileId = `FIL-${ctx.batchId}-${receipts + 1}`
      const computedChecksum = sha256(readFileText(match.absPath))
      await db.fileIngestionLog.create({
        data: {
          fileId,
          batchId: ctx.batchId,
          fileName: match.fileName,
          dataset: datasetName,
          sourceLocation: `data/incoming/${match.fileName}`,
          expectedArrivalDate: expectedArrivalDate(ds, ctx.businessDate),
          receivedAt: match.receivedAt,
          fileSizeBytes: match.sizeBytes,
          checksumValue: computedChecksum,
          checksumAlgorithm: 'SHA256',
          checksumStatus: 'PENDING',
          fileStatus: 'RECEIVED',
          createdAt: ctx.asOf,
        },
      })
      ctx.receipts.push({
        fileId,
        fileName: match.fileName,
        dataset: datasetName,
        absPath: match.absPath,
        manifestPath: `${match.absPath}.manifest.json`,
        receivedAt: match.receivedAt,
        expectedArrivalDate: expectedArrivalDate(ds, ctx.businessDate),
        sizeBytes: match.sizeBytes,
        computedChecksum,
        fileStatus: 'RECEIVED',
        checksumStatus: 'PENDING',
        errorMessage: null,
        zone: 'INCOMING',
      })
      receipts++
      ctx.logger.info('sensor', `Detected incoming file ${match.fileName} (${match.sizeBytes} bytes)`)

      // ---- sla_check (late arrival) ------------------------------------
      const slaDeadline = new Date(
        expectedArrivalDate(ds, ctx.businessDate).getTime() + ds.slaHours * 3600 * 1000,
      )
      const late = match.receivedAt > slaDeadline
      await recordCheck(ctx, {
        checkName: 'sla_check',
        status: late ? 'FAIL' : 'PASS',
        tableName: 'file_ingestion_log',
        columnName: 'received_at',
        expectedValue: `<= ${ds.expectedArrival}+${ds.slaHours}h`,
        actualValue: late ? 'late arrival' : 'on time',
        thresholdValue: ds.slaHours,
        errorDetails: late
          ? `File arrived at ${match.receivedAt.toISOString()} — after SLA deadline ${slaDeadline.toISOString()}`
          : null,
        incidentFile: match.fileName,
        incidentTable: 'file_ingestion_log',
        incidentDescription: `SLA breach: ${match.fileName} arrived ${Math.round(
          (match.receivedAt.getTime() - slaDeadline.getTime()) / 60000,
        )} min after the ${ds.slaHours}h SLA window`,
        dataset: datasetName,
      })
    } else {
      // No file in the landing zone — has this feed already been handled
      // by an earlier batch today (processed/quarantined)?
      const expectedName = ds.pattern.replace('{date}', ctx.businessDate)
      const dayStart = new Date(`${ctx.businessDate}T00:00:00`)
      const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000)
      const prior = await db.fileIngestionLog.findFirst({
        where: {
          dataset: datasetName,
          expectedArrivalDate: { gte: dayStart, lt: dayEnd },
          fileStatus: { in: ['PROCESSED', 'QUARANTINED', 'VALIDATED', 'FAILED'] },
        },
        orderBy: { createdAt: 'desc' },
      })
      if (prior) {
        await recordCheck(ctx, {
          checkName: 'file_arrival_check',
          status: 'PASS',
          tableName: 'file_ingestion_log',
          columnName: datasetName,
          expectedValue: expectedName,
          actualValue: `already handled (${prior.fileStatus} in batch ${prior.batchId})`,
          dataset: datasetName,
        })
        continue
      }
      missing++
      await recordCheck(ctx, {
        checkName: 'file_arrival_check',
        status: 'FAIL',
        tableName: 'file_ingestion_log',
        columnName: datasetName,
        expectedValue: expectedName,
        actualValue: 'not received',
        errorDetails: `Expected feed ${expectedName} (source: ${ds.sourceSystem}) not found in landing zone`,
        incidentFile: expectedName,
        incidentTable: 'file_ingestion_log',
        incidentDescription: `Missing file: ${expectedName} expected by ${ds.expectedArrival} (SLA ${ds.slaHours}h) was not found in the landing zone`,
        dataset: datasetName,
      })
      ctx.missingDatasets.push(datasetName)
    }
  }

  // Unexpected artifacts in the landing zone -> quarantine (naming rule).
  const anyDatePatterns = Object.values(config.manifest).map((ds) => datasetAnyDateRegex(ds))
  for (const f of csvFiles) {
    const known = anyDatePatterns.some((r) => r.test(f.fileName))
    if (!known) {
      const target = moveFile(f.absPath, config.settings.quarantineDir)
      const fileId = `FIL-${ctx.batchId}-X${receipts + 1}`
      await db.fileIngestionLog.create({
        data: {
          fileId,
          batchId: ctx.batchId,
          fileName: f.fileName,
          dataset: 'unknown',
          sourceLocation: `data/incoming/${f.fileName}`,
          expectedArrivalDate: new Date(`${ctx.businessDate}T00:00:00`),
          receivedAt: f.receivedAt,
          fileSizeBytes: f.sizeBytes,
          checksumValue: sha256(readFileText(target)),
          checksumAlgorithm: 'SHA256',
          checksumStatus: 'SKIPPED',
          fileStatus: 'QUARANTINED',
          errorMessage: 'File naming convention violation — does not match any expected feed pattern',
          zone: 'QUARANTINE',
          createdAt: ctx.asOf,
        },
      })
      ctx.logger.warn('sensor', `Quarantined unexpected artifact ${f.fileName} (naming convention violation)`)
    }
  }

  return { rowsRead: receipts, rowsLoaded: receipts - missing, rowsRejected: missing }
}

/**
 * TASK 2: ingest_and_validate_file_task
 * File-level validation gate: empty file, checksum vs manifest,
 * header/schema vs required columns, row count vs manifest.
 * Failed files are moved to data/quarantine with a reason.
 */
export async function ingestAndValidateFileTask(ctx: PipelineContext): Promise<{
  rowsRead: number
  rowsLoaded: number
  rowsRejected: number
}> {
  const config = loadConfig()
  let validated = 0
  let quarantined = 0

  for (const receipt of ctx.receipts) {
    const rules = config.rules.datasets[receipt.dataset]
    const manifest = readManifest(receipt.manifestPath)
    ctx.logger.info('ingest', `Validating ${receipt.fileName} (dataset=${receipt.dataset})`)
    await db.fileIngestionLog.update({
      where: { fileId: receipt.fileId },
      data: { fileStatus: 'VALIDATING' },
    })

    const content = readFileText(receipt.absPath)
    const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '')
    const header = lines.length > 0 ? lines[0].split(',').map((h) => h.trim()) : []
    const dataRows = Math.max(0, lines.length - 1)

    let quarantineReason: string | null = null

    // ---- empty_file_check ------------------------------------------------
    const isEmpty = content.trim() === '' || lines.length <= 1 || (header.length === 1 && header[0] === '')
    await recordCheck(ctx, {
      checkName: 'empty_file_check',
      status: isEmpty ? 'FAIL' : 'PASS',
      tableName: 'file_ingestion_log',
      columnName: receipt.dataset,
      expectedValue: '>= 1 data row',
      actualValue: dataRows,
      errorDetails: isEmpty ? 'File contains no data rows (header-only or zero bytes)' : null,
      incidentFile: receipt.fileName,
      incidentDescription: `Empty file: ${receipt.fileName} was delivered with no data rows — load skipped and file quarantined`,
      dataset: receipt.dataset,
    })
    if (isEmpty) quarantineReason = 'EMPTY_FILE — no data rows'

    // ---- checksum_validation ----------------------------------------------
    if (!isEmpty) {
      if (manifest?.checksum_sha256) {
        const ok = manifest.checksum_sha256 === receipt.computedChecksum
        await recordCheck(ctx, {
          checkName: 'checksum_validation',
          status: ok ? 'PASS' : 'FAIL',
          tableName: 'file_ingestion_log',
          columnName: receipt.dataset,
          expectedValue: manifest.checksum_sha256.slice(0, 16) + '…',
          actualValue: ok ? 'match' : receipt.computedChecksum.slice(0, 16) + '…',
          errorDetails: ok
            ? null
            : `SHA256 mismatch — file content does not match the manifest control record (possible corruption/truncation in transit)`,
          incidentFile: receipt.fileName,
          incidentDescription: `Checksum mismatch: ${receipt.fileName} failed SHA256 integrity validation against its manifest — file quarantined`,
          dataset: receipt.dataset,
        })
        receipt.checksumStatus = ok ? 'VALID' : 'INVALID'
        if (!ok && !quarantineReason) quarantineReason = 'CHECKSUM_MISMATCH — integrity validation failed'
      } else {
        receipt.checksumStatus = 'SKIPPED'
        await recordCheck(ctx, {
          checkName: 'checksum_validation',
          status: 'WARN',
          tableName: 'file_ingestion_log',
          columnName: receipt.dataset,
          expectedValue: 'manifest checksum',
          actualValue: 'no manifest sidecar',
          errorDetails: 'No checksum manifest delivered — integrity could not be verified',
          dataset: receipt.dataset,
        })
      }
    }

    // ---- schema_header_validation -------------------------------------------
    if (!isEmpty && rules) {
      const missingCols = rules.requiredColumns.filter((c) => !header.includes(c))
      if (header.length < 3) {
        // Not even a plausible CSV header -> corrupted file
        await recordCheck(ctx, {
          checkName: 'schema_header_validation',
          status: 'FAIL',
          tableName: 'file_ingestion_log',
          columnName: receipt.dataset,
          expectedValue: rules.requiredColumns.join(','),
          actualValue: header.join(',') || '(unreadable)',
          errorDetails: 'Header row is not parseable as CSV — file treated as corrupted',
          incidentFile: receipt.fileName,
          incidentDescription: `Corrupted file: ${receipt.fileName} has an unreadable header row — quarantined`,
          dataset: receipt.dataset,
        })
        if (!quarantineReason) quarantineReason = 'FILE_CORRUPTED — unreadable header'
      } else if (missingCols.length > 0) {
        const mandatoryMissing = missingCols.filter((c) => rules.mandatoryNotNull.includes(c))
        await recordCheck(ctx, {
          checkName: 'schema_header_validation',
          status: 'FAIL',
          tableName: 'file_ingestion_log',
          columnName: receipt.dataset,
          expectedValue: rules.requiredColumns.join(','),
          actualValue: header.join(','),
          errorDetails: `Missing column(s): ${missingCols.join(', ')}`,
          incidentFile: receipt.fileName,
          incidentDescription: `Schema drift: ${receipt.fileName} is missing column(s) [${missingCols.join(', ')}] — quarantined`,
          mandatory: mandatoryMissing.length > 0,
          dataset: receipt.dataset,
        })
        if (!quarantineReason) quarantineReason = `SCHEMA_DRIFT — missing columns: ${missingCols.join(', ')}`
      } else {
        await recordCheck(ctx, {
          checkName: 'schema_header_validation',
          status: 'PASS',
          tableName: 'file_ingestion_log',
          columnName: receipt.dataset,
          expectedValue: rules.requiredColumns.join(','),
          actualValue: 'all required columns present',
          dataset: receipt.dataset,
        })
      }
    }

    // ---- row_count_check (manifest control total) ------------------------------
    if (!isEmpty && manifest && typeof manifest.expected_rows === 'number') {
      const variance = dataRows - manifest.expected_rows
      const threshold = rules?.rowCountVarianceThreshold ?? 0
      const ok = Math.abs(variance) <= threshold
      await recordCheck(ctx, {
        checkName: 'row_count_check',
        status: ok ? 'PASS' : 'FAIL',
        tableName: 'file_ingestion_log',
        columnName: receipt.dataset,
        expectedValue: manifest.expected_rows,
        actualValue: dataRows,
        thresholdValue: threshold,
        errorDetails: ok ? null : `Row count variance ${variance} vs manifest expected_rows`,
        incidentFile: receipt.fileName,
        incidentDescription: `Row count mismatch: ${receipt.fileName} delivered ${dataRows} rows but the manifest expected ${manifest.expected_rows}`,
        dataset: receipt.dataset,
      })
    }

    // ---- quarantine or promote ---------------------------------------------------
    if (quarantineReason) {
      moveFileWithSidecar(receipt.absPath, receipt.manifestPath, config.settings.quarantineDir)
      receipt.fileStatus = 'QUARANTINED'
      receipt.errorMessage = quarantineReason
      receipt.zone = 'QUARANTINE'
      await db.fileIngestionLog.update({
        where: { fileId: receipt.fileId },
        data: {
          fileStatus: 'QUARANTINED',
          errorMessage: quarantineReason,
          zone: 'QUARANTINE',
          checksumStatus: receipt.checksumStatus,
        },
      })
      quarantined++
      ctx.logger.warn('ingest', `QUARANTINED ${receipt.fileName}: ${quarantineReason}`)
    } else {
      receipt.fileStatus = 'VALIDATED'
      receipt.zone = 'INCOMING'
      await db.fileIngestionLog.update({
        where: { fileId: receipt.fileId },
        data: { fileStatus: 'VALIDATED', checksumStatus: receipt.checksumStatus },
      })
      validated++
      ctx.logger.info('ingest', `Validated ${receipt.fileName} (${dataRows} data rows)`)
    }
  }

  return { rowsRead: ctx.receipts.length, rowsLoaded: validated, rowsRejected: quarantined }
}

/** Filter receipts that survived the validation gate. */
export function validatedReceipts(ctx: PipelineContext): FileReceipt[] {
  return ctx.receipts.filter((r) => r.fileStatus === 'VALIDATED')
}
