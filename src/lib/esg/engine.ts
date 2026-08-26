// =====================================================================
// ESG DataOps Command Center — DAG orchestrator (Airflow equivalent)
// Runs the esg_daily_ingestion DAG sequentially with:
//   - batch_id / run_id generation and XCom-style context passing
//   - job_run_audit trail per task (RUNNING -> SUCCESS/FAILED/SKIPPED)
//   - retry policy + failure callbacks (LOAD_FAILURE incident, evidence)
//   - trigger_rule=all_done for report/notify tasks
// The same task functions back the local orchestrator and the UI.
// =====================================================================

import { db } from '@/lib/db'
import { loadConfig } from './config'
import { ensureZones } from './fsx'
import { RunLogger } from './logger'
import { createIncident, runEscalationSweep } from './incidents'
import { dispatchAlert } from './alerts'
import { fileSensorTask, ingestAndValidateFileTask } from './ingestion'
import { loadStagingTask, loadWarehouseTask } from './etl'
import { runDataQualityChecksTask } from './dq'
import { reconcileSourceToTargetTask } from './reconciliation'
import { generateDailyReport } from './reporting'
import { toEvidenceContext, type PipelineContext } from './context'
import type { HealthStatus, IncidentSeverity, IncidentType } from './types'

export interface TaskResult {
  rowsRead?: number
  rowsLoaded?: number
  rowsRejected?: number
}

export interface RunPipelineResult {
  batchId: string
  businessDate: string
  dagStatus: 'SUCCESS' | 'FAILED'
  durationSeconds: number
  tasks: { taskId: string; jobName: string; status: string; durationSeconds: number | null; errorMessage: string | null }[]
  incidents: { incidentId: string; severity: string; incidentType: string }[]
  files: { received: number; validated: number; quarantined: number }
  load: { rowsRead: number; rowsLoaded: number; rowsRejected: number }
  dq: { executed: number; passed: number; failed: number; warn: number }
  report: { reportDate: string; overallHealth: HealthStatus } | null
}

interface TaskDef {
  taskId: string
  jobName: string
  jobType: string
  /** Critical tasks are skipped downstream when an upstream critical task fails. */
  critical: boolean
  fn: (ctx: PipelineContext) => Promise<TaskResult>
}

function buildTaskDefs(): TaskDef[] {
  return [
    {
      taskId: 'file_sensor_task',
      jobName: 'Detect incoming files + arrival SLA',
      jobType: 'SENSOR',
      critical: true,
      fn: fileSensorTask,
    },
    {
      taskId: 'ingest_and_validate_file_task',
      jobName: 'Validate checksum / schema / row counts',
      jobType: 'VALIDATE',
      critical: true,
      fn: ingestAndValidateFileTask,
    },
    {
      taskId: 'load_staging_task',
      jobName: 'Bulk load staging + row-level validation',
      jobType: 'LOAD',
      critical: true,
      fn: loadStagingTask,
    },
    {
      taskId: 'run_data_quality_checks_task',
      jobName: 'Execute YAML-configured DQ checks',
      jobType: 'VALIDATE',
      critical: true,
      fn: runDataQualityChecksTask,
    },
    {
      taskId: 'load_warehouse_task',
      jobName: 'Transform + load dim_site / fact table',
      jobType: 'TRANSFORM',
      critical: true,
      fn: loadWarehouseTask,
    },
    {
      taskId: 'reconcile_source_to_target_task',
      jobName: 'Source-to-target reconciliation + freshness',
      jobType: 'RECONCILE',
      critical: true,
      fn: reconcileSourceToTargetTask,
    },
    {
      taskId: 'generate_ops_report_task',
      jobName: 'Generate daily ops report (md + csv)',
      jobType: 'REPORT',
      critical: false, // trigger_rule: all_done
      fn: async (ctx) => {
        const stats = await generateDailyReport(ctx.businessDate, ctx.asOf)
        return { rowsRead: stats.dqChecksExecuted, rowsLoaded: stats.dqChecksPassed, rowsRejected: stats.dqChecksFailed }
      },
    },
    {
      taskId: 'notify_incident_task',
      jobName: 'Alerts, escalation sweep, batch summary',
      jobType: 'NOTIFY',
      critical: false, // trigger_rule: all_done
      fn: async (ctx) => {
        const sweep = await runEscalationSweep(ctx.asOf, ctx.logger)
        await dispatchAlert({
          alertType: 'PIPELINE_COMPLETED',
          severity: ctx.incidentsCreated.length > 0 ? 'WARN' : 'INFO',
          message:
            `Batch ${ctx.batchId} (${ctx.businessDate}) completed: ` +
            `${ctx.receipts.length} file(s), ${ctx.incidentsCreated.length} incident(s)` +
            (sweep.escalated.length > 0 ? `, ${sweep.escalated.length} auto-escalation(s)` : ''),
          batchId: ctx.batchId,
          runId: ctx.currentRunId,
          asOf: ctx.asOf,
        })
        return { rowsRead: ctx.incidentsCreated.length, rowsLoaded: sweep.escalated.length, rowsRejected: 0 }
      },
    },
  ]
}

async function nextBatchId(businessDate: string): Promise<string> {
  const compact = businessDate.replace(/-/g, '')
  const prior = await db.jobRunAudit.count({
    where: { batchId: { startsWith: `B-${compact}-` } },
  })
  return `B-${compact}-${(prior + 1).toString().padStart(2, '0')}`
}

/**
 * Run the full esg_daily_ingestion DAG for a business date.
 * @param opts.businessDate YYYY-MM-DD (defaults to today)
 * @param opts.asOf         simulated clock (defaults to now) — used by the demo seeder
 * @param opts.trigger      what started the run (manual | airflow | simulation | seed)
 */
export async function runPipeline(opts: {
  businessDate?: string
  asOf?: Date
  trigger?: string
}): Promise<RunPipelineResult> {
  const config = loadConfig()
  ensureZones(config)
  const businessDate = opts.businessDate ?? new Date().toISOString().slice(0, 10)
  const asOf = opts.asOf ?? new Date()
  const batchId = await nextBatchId(businessDate)
  const logger = new RunLogger(batchId)

  const ctx: PipelineContext = {
    batchId,
    businessDate,
    dagId: config.settings.dagId,
    asOf,
    trigger: opts.trigger ?? 'manual',
    logger,
    config,
    currentRunId: `${config.settings.dagId}.${batchId}`,
    receipts: [],
    missingDatasets: [],
    loadStats: [],
    rejectedRows: [],
    dqResults: [],
    incidentsCreated: [],
    taskSummary: [],
  }

  logger.info('orchestrator', `Starting DAG ${config.settings.dagId} for ${businessDate} (trigger=${ctx.trigger})`)

  const tasks = buildTaskDefs()
  const startedWall = Date.now()
  // Simulated clock so seeded history has realistic, monotonically
  // increasing task timestamps.
  let clock = new Date(asOf.getTime())
  let dagFailed = false
  let skipCritical = false

  for (let seq = 0; seq < tasks.length; seq++) {
    const task = tasks[seq]
    const runId = `${config.settings.dagId}.${task.taskId}.${batchId}`
    ctx.currentRunId = runId
    logger.setRunId(runId)

    if (skipCritical && task.critical) {
      await db.jobRunAudit.create({
        data: {
          runId,
          batchId,
          dagId: config.settings.dagId,
          taskId: task.taskId,
          jobName: task.jobName,
          jobType: task.jobType,
          sequence: seq + 1,
          startTime: clock,
          endTime: clock,
          durationSeconds: 0,
          status: 'SKIPPED',
          errorMessage: 'Upstream critical task failed — task skipped (trigger_rule=all_success)',
          createdAt: clock,
        },
      })
      ctx.taskSummary.push({ taskId: task.taskId, status: 'SKIPPED', durationSeconds: 0, errorMessage: 'upstream failure' })
      continue
    }

    await db.jobRunAudit.create({
      data: {
        runId,
        batchId,
        dagId: config.settings.dagId,
        taskId: task.taskId,
        jobName: task.jobName,
        jobType: task.jobType,
        sequence: seq + 1,
        startTime: clock,
        status: 'RUNNING',
        createdAt: clock,
      },
    })

    const taskWallStart = Date.now()
    let status: 'SUCCESS' | 'FAILED' = 'SUCCESS'
    let errorMessage: string | null = null
    let result: TaskResult = {}
    const maxAttempts = config.settings.retries + 1

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (attempt > 1) {
          logger.warn(task.taskId, `Retry attempt ${attempt}/${maxAttempts}`)
        }
        result = await task.fn(ctx)
        errorMessage = null
        break
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err)
        status = 'FAILED'
        if (attempt < maxAttempts) {
          logger.warn(task.taskId, `Attempt ${attempt} failed: ${errorMessage}`)
        }
      }
    }

    const taskWallMs = Date.now() - taskWallStart
    const duration = Math.max(taskWallMs / 1000, 1 + ((seq * 7) % 9) * 0.9) // realistic-looking durations
    const endTime = new Date(clock.getTime() + duration * 1000)
    clock = endTime

    await db.jobRunAudit.update({
      where: { runId },
      data: {
        endTime,
        durationSeconds: Math.round(duration * 100) / 100,
        status,
        rowsRead: result.rowsRead ?? null,
        rowsLoaded: result.rowsLoaded ?? null,
        rowsRejected: result.rowsRejected ?? null,
        errorMessage:
          status === 'FAILED'
            ? `${errorMessage}${maxAttempts > 1 ? ` (after ${maxAttempts} attempt(s))` : ''}`
            : null,
      },
    })
    ctx.taskSummary.push({
      taskId: task.taskId,
      status,
      durationSeconds: Math.round(duration * 100) / 100,
      errorMessage: status === 'FAILED' ? errorMessage : null,
    })

    if (status === 'FAILED') {
      dagFailed = true
      skipCritical = true
      logger.error(task.taskId, `Task FAILED after ${maxAttempts} attempt(s): ${errorMessage}`)

      // ---- Airflow-style failure callback: incident + evidence + alert ----
      const failedFile = ctx.receipts.find((r) => r.fileStatus === 'FAILED')?.fileName ?? null
      const created = await createIncident(
        {
          incidentType: 'LOAD_FAILURE' as IncidentType,
          severity: 'P1' as IncidentSeverity,
          batchId,
          runId,
          pipelineName: config.settings.dagId,
          shortDescription: `Load failure in ${task.taskId}${failedFile ? ` (${failedFile})` : ''} — batch ${batchId}`,
          detailedDescription:
            `Task ${task.taskId} (${task.jobName}) failed after ${maxAttempts} attempt(s).\n\n` +
            `Error: ${errorMessage}\n\nBatch: ${batchId} | Business date: ${businessDate}\n` +
            `Downstream critical tasks were SKIPPED. Warehouse state for ${businessDate} must be ` +
            `verified before business hours.`,
          errorMessage,
          affectedFile: failedFile,
          affectedTable: task.taskId.includes('staging') ? 'staging_energy_data' : 'fact_energy_emissions',
          affectedCheck: null,
          evidenceCtx: toEvidenceContext(ctx),
          asOf,
        },
        logger,
      )
      ctx.incidentsCreated.push({
        incidentId: created.incidentId,
        severity: created.severity,
        incidentType: 'LOAD_FAILURE',
      })
    } else {
      logger.info(task.taskId, `Task ${status}`)
    }
  }

  const durationSeconds = Math.round(((Date.now() - startedWall) / 1000) * 100) / 100
  const dqSnapshot = {
    executed: ctx.dqResults.length,
    passed: ctx.dqResults.filter((r) => r.status === 'PASS').length,
    failed: ctx.dqResults.filter((r) => r.status === 'FAIL').length,
    warn: ctx.dqResults.filter((r) => r.status === 'WARN').length,
  }
  const loadTotals = ctx.loadStats.reduce(
    (acc, s) => ({
      read: acc.read + s.totalRead,
      loaded: acc.loaded + s.totalValid,
      rejected: acc.rejected + s.totalRejected,
    }),
    { read: 0, loaded: 0, rejected: 0 },
  )

  let report: RunPipelineResult['report'] = null
  const reportRow = await db.dailyOpsReport.findUnique({ where: { reportDate: businessDate } })
  if (reportRow) report = { reportDate: businessDate, overallHealth: reportRow.overallHealth as HealthStatus }

  logger.info(
    'orchestrator',
    `DAG ${dagFailed ? 'FAILED' : 'completed'} for ${businessDate}: ` +
      `${ctx.receipts.length} file(s), ${ctx.incidentsCreated.length} incident(s), ` +
      `${dqSnapshot.executed} checks (${dqSnapshot.failed} failed)`,
  )

  return {
    batchId,
    businessDate,
    dagStatus: dagFailed ? 'FAILED' : 'SUCCESS',
    durationSeconds,
    tasks: ctx.taskSummary.map((t, i) => ({
      taskId: t.taskId,
      jobName: tasks[i]?.jobName ?? t.taskId,
      status: t.status,
      durationSeconds: t.durationSeconds,
      errorMessage: t.errorMessage,
    })),
    incidents: ctx.incidentsCreated,
    files: {
      received: ctx.receipts.length,
      validated: ctx.receipts.filter((r) => r.fileStatus === 'VALIDATED' || r.fileStatus === 'PROCESSED').length,
      quarantined: ctx.receipts.filter((r) => r.fileStatus === 'QUARANTINED').length,
    },
    load: { rowsRead: loadTotals.read, rowsLoaded: loadTotals.loaded, rowsRejected: loadTotals.rejected },
    dq: dqSnapshot,
    report,
  }
}
