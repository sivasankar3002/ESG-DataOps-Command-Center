// =====================================================================
// ESG DataOps Command Center — pipeline run context
// Shared state passed between DAG tasks (the orchestrator's "XCom"):
// batch/run ids, file receipts, rejection stats, DQ results, incidents.
// =====================================================================

import type { RunLogger } from './logger'
import type { LoadedConfig } from './config'
import type { EvidenceContext, RejectedRowInfo, FileSummaryInfo } from './evidence'
import type { ChecksumStatus, FileStatus, Zone } from './types'

export interface FileReceipt {
  fileId: string
  fileName: string
  dataset: string
  absPath: string
  manifestPath: string | null
  receivedAt: Date
  expectedArrivalDate: Date
  sizeBytes: number
  computedChecksum: string
  fileStatus: FileStatus
  checksumStatus: ChecksumStatus
  errorMessage: string | null
  zone: Zone
}

export interface DatasetLoadStats {
  dataset: string
  totalRead: number
  totalValid: number
  totalRejected: number
  nullsByColumn: Record<string, number>
  invalidDates: number
  rangeViolations: number
  duplicates: number
}

export interface DqResultSnapshot {
  checkName: string
  checkCategory: string
  status: string
  severity: string
  tableName: string | null
  columnName: string | null
  expectedValue: string | null
  actualValue: string | null
  thresholdValue: string | null
  errorDetails: string | null
}

export interface TaskSummary {
  taskId: string
  status: string
  durationSeconds: number | null
  errorMessage: string | null
}

export interface PipelineContext {
  batchId: string
  businessDate: string
  dagId: string
  asOf: Date
  trigger: string
  logger: RunLogger
  config: LoadedConfig
  currentRunId: string

  receipts: FileReceipt[]
  missingDatasets: string[]
  loadStats: DatasetLoadStats[]
  rejectedRows: RejectedRowInfo[]
  dqResults: DqResultSnapshot[]
  incidentsCreated: { incidentId: string; severity: string; incidentType: string }[]
  taskSummary: TaskSummary[]
}

/** Snapshot the context as an evidence-collection input. */
export function toEvidenceContext(ctx: PipelineContext): EvidenceContext {
  const fileSummaries: FileSummaryInfo[] = ctx.receipts.map((r) => ({
    fileName: r.fileName,
    dataset: r.dataset,
    fileStatus: r.fileStatus,
    errorMessage: r.errorMessage,
  }))
  return {
    batchId: ctx.batchId,
    runId: ctx.currentRunId,
    businessDate: ctx.businessDate,
    pipelineName: ctx.dagId,
    logText: ctx.logger.render(),
    dqResults: ctx.dqResults.map((r) => ({
      checkName: r.checkName,
      status: r.status,
      severity: r.severity,
      expectedValue: r.expectedValue,
      actualValue: r.actualValue,
      errorDetails: r.errorDetails,
      tableName: r.tableName,
      columnName: r.columnName,
    })),
    rejectedRows: ctx.rejectedRows,
    fileSummaries,
    taskSummary: ctx.taskSummary.map((t) => ({
      taskId: t.taskId,
      status: t.status,
      durationSeconds: t.durationSeconds,
      errorMessage: t.errorMessage,
    })),
  }
}

export function statsFor(ctx: PipelineContext, dataset: string): DatasetLoadStats {
  let stats = ctx.loadStats.find((s) => s.dataset === dataset)
  if (!stats) {
    stats = {
      dataset,
      totalRead: 0,
      totalValid: 0,
      totalRejected: 0,
      nullsByColumn: {},
      invalidDates: 0,
      rangeViolations: 0,
      duplicates: 0,
    }
    ctx.loadStats.push(stats)
  }
  return stats
}
