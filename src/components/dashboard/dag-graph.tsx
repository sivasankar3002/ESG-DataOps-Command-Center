'use client'

// =====================================================================
// ESG DataOps Command Center — DAG dependency graph
// Airflow-style node/edge diagram of the 8-task esg_daily_ingestion_dag.
// The task topology mirrors src/lib/esg/engine.ts buildTaskDefs():
// a 6-task critical chain (failure skips downstream) plus two
// trigger_rule=all_done leaf tasks that run regardless of upstream
// outcome. Node colours reflect the selected batch's job_run_audit
// statuses; clicking a node filters the Pipeline runs table below.
// Pure SVG — no extra dependency.
// =====================================================================

import { useMemo, useState } from 'react'
import { Network, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { DashboardState } from '@/lib/esg/dashboard'
import { cn } from '@/lib/utils'
import { Mono } from './shared'

// ---- static DAG topology (mirrors engine.ts buildTaskDefs) ----------
interface DagNodeDef {
  taskId: string
  short: string
  jobType: string
  jobName: string
  critical: boolean
  x: number
  y: number
}

const NODE_W = 128
const NODE_H = 76
const VIEW_W = 1058
const VIEW_H = 262

const DAG_NODES: DagNodeDef[] = [
  {
    taskId: 'file_sensor_task',
    short: 'file_sensor',
    jobType: 'SENSOR',
    jobName: 'Detect incoming files + arrival SLA',
    critical: true,
    x: 14,
    y: 93,
  },
  {
    taskId: 'ingest_and_validate_file_task',
    short: 'ingest_validate',
    jobType: 'VALIDATE',
    jobName: 'Validate checksum / schema / row counts',
    critical: true,
    x: 162,
    y: 93,
  },
  {
    taskId: 'load_staging_task',
    short: 'load_staging',
    jobType: 'LOAD',
    jobName: 'Bulk load staging + row-level validation',
    critical: true,
    x: 310,
    y: 93,
  },
  {
    taskId: 'run_data_quality_checks_task',
    short: 'dq_checks',
    jobType: 'VALIDATE',
    jobName: 'Execute YAML-configured DQ checks',
    critical: true,
    x: 458,
    y: 93,
  },
  {
    taskId: 'load_warehouse_task',
    short: 'load_warehouse',
    jobType: 'TRANSFORM',
    jobName: 'Transform + load dim_site / fact table',
    critical: true,
    x: 606,
    y: 93,
  },
  {
    taskId: 'reconcile_source_to_target_task',
    short: 'reconcile',
    jobType: 'RECONCILE',
    jobName: 'Source-to-target reconciliation + freshness',
    critical: true,
    x: 754,
    y: 93,
  },
  {
    taskId: 'generate_ops_report_task',
    short: 'ops_report',
    jobType: 'REPORT',
    jobName: 'Generate daily ops report (md + csv)',
    critical: false,
    x: 902,
    y: 8,
  },
  {
    taskId: 'notify_incident_task',
    short: 'notify_incident',
    jobType: 'NOTIFY',
    jobName: 'Alerts, escalation sweep, batch summary',
    critical: false,
    x: 902,
    y: 178,
  },
]

const DAG_EDGES: { from: string; to: string; allDone?: boolean }[] = [
  { from: 'file_sensor_task', to: 'ingest_and_validate_file_task' },
  { from: 'ingest_and_validate_file_task', to: 'load_staging_task' },
  { from: 'load_staging_task', to: 'run_data_quality_checks_task' },
  { from: 'run_data_quality_checks_task', to: 'load_warehouse_task' },
  { from: 'load_warehouse_task', to: 'reconcile_source_to_target_task' },
  { from: 'reconcile_source_to_target_task', to: 'generate_ops_report_task', allDone: true },
  { from: 'reconcile_source_to_target_task', to: 'notify_incident_task', allDone: true },
]

const NODES_BY_ID = new Map(DAG_NODES.map((n) => [n.taskId, n]))

// ---- status → visual classes ----------------------------------------
const STATUS_STROKE: Record<string, string> = {
  SUCCESS: 'stroke-emerald-500 dark:stroke-emerald-400',
  FAILED: 'stroke-red-500 dark:stroke-red-400',
  SKIPPED: 'stroke-zinc-400 dark:stroke-zinc-600',
  RUNNING: 'stroke-amber-500 dark:stroke-amber-400',
}

const STATUS_FILL: Record<string, string> = {
  SUCCESS: 'fill-emerald-50 dark:fill-emerald-950/60',
  FAILED: 'fill-red-50 dark:fill-red-950/60',
  SKIPPED: 'fill-zinc-50 dark:fill-zinc-900/60',
  RUNNING: 'fill-amber-50 dark:fill-amber-950/60',
}

const STATUS_TEXT: Record<string, string> = {
  SUCCESS: 'text-emerald-700 dark:text-emerald-300',
  FAILED: 'text-red-700 dark:text-red-300',
  SKIPPED: 'text-zinc-500 dark:text-zinc-400',
  RUNNING: 'text-amber-700 dark:text-amber-300',
}

const STATUS_LABEL: Record<string, string> = {
  SUCCESS: 'ok',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  RUNNING: 'running',
}

const STATUS_ACCENT: Record<string, string> = {
  SUCCESS: 'fill-emerald-500',
  FAILED: 'fill-red-500',
  SKIPPED: 'fill-zinc-400 dark:fill-zinc-600',
  RUNNING: 'fill-amber-500',
}

function statusClass(map: Record<string, string>, status: string | undefined): string {
  return (status && map[status]) || 'stroke-zinc-300 dark:stroke-zinc-700'
}

function fillClass(map: Record<string, string>, status: string | undefined): string {
  return (status && map[status]) || 'fill-zinc-50 dark:fill-zinc-900/40'
}

// ---- shared task-run shape (both DashboardState batchTimeline tasks and
// the Batch Explorer lineage tasks map onto this) ----------------------
export interface DagTaskRun {
  taskId: string
  status: string
  durationSeconds?: number | null
}

// =====================================================================
// DagGraphSvg — the reusable node/edge diagram.
// Used by the Pipeline Runs tab (with the batch picker, via DagGraphCard)
// and by the Batch Explorer lineage dialog (fixed batch, no picker).
// =====================================================================
export function DagGraphSvg({
  tasks,
  batchId,
  onSelectTask,
  className,
}: {
  tasks: DagTaskRun[]
  /** Shown in the footer strip ("statuses from job_run_audit for …"). */
  batchId: string
  /** Optional: clicking a node filters a runs table / copies context. */
  onSelectTask?: (taskId: string) => void
  className?: string
}) {
  const tasksById = useMemo(() => {
    const map = new Map<string, { status: string; durationSeconds?: number | null }>()
    for (const t of tasks) {
      map.set(t.taskId, { status: t.status, durationSeconds: t.durationSeconds })
    }
    return map
  }, [tasks])

  const failed = tasks.filter((t) => t.status === 'FAILED').length
  const skipped = tasks.filter((t) => t.status === 'SKIPPED').length
  const succeeded = tasks.filter((t) => t.status === 'SUCCESS').length

  return (
    <>
      {/* ---- the graph ---- */}
      <div className={cn('overflow-x-auto rounded-lg border bg-card', className)}>
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="min-w-[880px] w-full h-auto"
          role="img"
          aria-label={`Dependency graph of the esg_daily_ingestion pipeline for batch ${batchId}`}
        >
          {/* ---- edges ---- */}
          {DAG_EDGES.map((e) => {
            const from = NODES_BY_ID.get(e.from)
            const to = NODES_BY_ID.get(e.to)
            if (!from || !to) return null
            const x1 = from.x + NODE_W
            const y1 = from.y + NODE_H / 2
            const x2 = to.x
            const y2 = to.y + NODE_H / 2
            // Horizontal chain edges are straight; branch edges curve.
            const d =
              y1 === y2
                ? `M ${x1} ${y1} L ${x2 - 5} ${y2}`
                : `M ${x1} ${y1} C ${x1 + 30} ${y1}, ${x2 - 30} ${y2}, ${x2 - 5} ${y2}`
            return (
              <g key={`${e.from}->${e.to}`}>
                <path
                  d={d}
                  className={cn(
                    'fill-none transition-colors',
                    e.allDone
                      ? 'stroke-violet-400 dark:stroke-violet-600'
                      : 'stroke-zinc-400 dark:stroke-zinc-600',
                  )}
                  strokeWidth={1.6}
                  strokeDasharray={e.allDone ? '5 3' : undefined}
                />
                <polygon
                  points={`${x2},${y2} ${x2 - 7},${y2 - 4} ${x2 - 7},${y2 + 4}`}
                  className={cn(
                    e.allDone
                      ? 'fill-violet-400 dark:fill-violet-600'
                      : 'fill-zinc-400 dark:fill-zinc-600',
                  )}
                />
                {e.allDone ? (
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 + (y2 < y1 ? -6 : 12)}
                    textAnchor="middle"
                    className="fill-violet-500 dark:fill-violet-400"
                    style={{ fontSize: 8, fontFamily: 'var(--font-mono)' }}
                  >
                    all_done
                  </text>
                ) : null}
              </g>
            )
          })}

          {/* ---- nodes ---- */}
          {DAG_NODES.map((n) => {
            const run = tasksById.get(n.taskId)
            const status = run?.status
            const dur = run?.durationSeconds
            return (
              <g
                key={n.taskId}
                transform={`translate(${n.x}, ${n.y})`}
                className={cn(
                  'transition-transform duration-150',
                  onSelectTask ? 'cursor-pointer hover:scale-[1.04]' : 'cursor-default',
                )}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                onClick={onSelectTask ? () => onSelectTask(n.taskId) : undefined}
              >
                <title>
                  {`${n.taskId} — ${n.jobName}\ntype: ${n.jobType} · ${
                    n.critical ? 'critical chain (failure skips downstream)' : 'trigger_rule: all_done'
                  }\nstatus: ${status ?? 'not run'}${dur != null ? ` · ${dur.toFixed(2)}s` : ''}${
                    onSelectTask ? '\nclick to filter the runs table' : ''
                  }`}
                </title>
                {/* status accent bar */}
                <rect
                  width={NODE_W}
                  height={4}
                  rx={2}
                  className={cn(fillClass(STATUS_ACCENT, status))}
                />
                {/* body */}
                <rect
                  y={4}
                  width={NODE_W}
                  height={NODE_H - 4}
                  rx={7}
                  className={cn(
                    'transition-colors',
                    statusClass(STATUS_STROKE, status),
                    fillClass(STATUS_FILL, status),
                    status === 'SKIPPED' && 'stroke-dasharray: 4 3',
                  )}
                  strokeWidth={1.5}
                />
                {/* task short name */}
                <text
                  x={NODE_W / 2}
                  y={26}
                  textAnchor="middle"
                  className={cn(
                    'fill-zinc-800 dark:fill-zinc-100',
                    statusClass(STATUS_TEXT, status),
                  )}
                  style={{ fontSize: 11.5, fontWeight: 700, fontFamily: 'var(--font-mono)' }}
                >
                  {n.short}
                </text>
                {/* job type */}
                <text
                  x={NODE_W / 2}
                  y={41}
                  textAnchor="middle"
                  className="fill-zinc-500 dark:fill-zinc-400"
                  style={{ fontSize: 8, letterSpacing: '0.08em' }}
                >
                  {n.jobType}
                </text>
                {/* status + duration line */}
                <text
                  x={NODE_W / 2}
                  y={58}
                  textAnchor="middle"
                  className={cn('fill-zinc-600 dark:fill-zinc-300')}
                  style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)' }}
                >
                  {status ? STATUS_LABEL[status] ?? status.toLowerCase() : 'not run'}
                  {dur != null ? ` · ${dur.toFixed(2)}s` : ''}
                </text>
                {/* failed marker */}
                {status === 'FAILED' ? (
                  <g>
                    <circle
                      cx={NODE_W - 13}
                      cy={16}
                      r={7}
                      className="fill-red-500"
                    />
                    <text
                      x={NODE_W - 13}
                      y={19.5}
                      textAnchor="middle"
                      className="fill-white"
                      style={{ fontSize: 9, fontWeight: 700 }}
                    >
                      !
                    </text>
                  </g>
                ) : null}
              </g>
            )
          })}
        </svg>
      </div>

      {/* ---- legend ---- */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-muted-foreground dark:text-zinc-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" aria-hidden /> success ({succeeded})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-red-500" aria-hidden /> failed ({failed})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-zinc-400 bg-zinc-100 dark:bg-zinc-800" aria-hidden />{' '}
          skipped ({skipped})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5 bg-zinc-400 dark:bg-zinc-600" aria-hidden /> critical chain
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-0.5 w-5 border-t-2 border-dashed border-violet-400 dark:border-violet-600"
            aria-hidden
          />{' '}
          all_done (always runs)
        </span>
        <span className="ml-auto hidden sm:inline">
          <RefreshCw className="h-3 w-3 inline mr-1" />
          statuses from job_run_audit for <Mono className="text-[10px]">{batchId}</Mono>
        </span>
      </div>
    </>
  )
}

// =====================================================================
// DagGraphCard — the Pipeline Runs tab wrapper: batch picker + summary
// strip + the shared DagGraphSvg.
// =====================================================================
export function DagGraphCard({
  batchTimeline,
  dagId,
  onSelectTask,
}: {
  batchTimeline: DashboardState['batchTimeline']
  dagId: string
  /** Clicking a node filters the Pipeline runs table by that task. */
  onSelectTask: (taskId: string) => void
}) {
  const [selectedBatchId, setSelectedBatchId] = useState<string>('LATEST')

  const batch = useMemo(() => {
    if (batchTimeline.length === 0) return undefined
    if (selectedBatchId === 'LATEST') return batchTimeline[0]
    return batchTimeline.find((b) => b.batchId === selectedBatchId)
  }, [batchTimeline, selectedBatchId])

  const failed = batch?.tasks.filter((t) => t.status === 'FAILED').length ?? 0
  const skipped = batch?.tasks.filter((t) => t.status === 'SKIPPED').length ?? 0
  const succeeded = batch?.tasks.filter((t) => t.status === 'SUCCESS').length ?? 0

  return (
    <Card>
      <CardHeader className="pb-0 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex flex-wrap items-center gap-2">
          <Network className="h-4 w-4 text-emerald-600" />
          DAG dependency graph — <Mono>{dagId}</Mono>
          <div className="ml-auto flex items-center gap-2">
            {batch ? (
              <Select value={selectedBatchId} onValueChange={setSelectedBatchId}>
                <SelectTrigger className="h-7 w-[190px] text-xs font-mono">
                  <SelectValue placeholder="Batch" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LATEST">Latest batch</SelectItem>
                  {batchTimeline.slice(0, 12).map((b) => (
                    <SelectItem key={b.batchId} value={b.batchId} className="font-mono text-xs">
                      {b.batchId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          The 8-task pipeline as a dependency graph: a 6-task critical chain (failure skips
          everything downstream) plus two <Mono className="text-[10px]">trigger_rule=all_done</Mono>{' '}
          leaf tasks that always run. Click a node to filter the runs table. Hover for detail.
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-3">
        {!batch ? (
          <p className="text-xs text-muted-foreground py-8 text-center">
            No batch runs recorded yet — run the DAG from the Control Room to light up the graph.
          </p>
        ) : (
          <>
            {/* ---- batch summary strip ---- */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] mb-2">
              <Mono className="font-semibold">{batch.batchId}</Mono>
              <span className="text-muted-foreground">business date {batch.businessDate}</span>
              <span className="text-muted-foreground tabular-nums">
                {batch.totalDurationSeconds.toFixed(2)}s total
              </span>
              <span className="text-emerald-700 dark:text-emerald-400 font-medium tabular-nums">
                {succeeded} ok
              </span>
              {failed > 0 ? (
                <span className="text-red-600 dark:text-red-400 font-medium tabular-nums">
                  {failed} failed
                </span>
              ) : null}
              {skipped > 0 ? (
                <span className="text-zinc-500 dark:text-zinc-400 font-medium tabular-nums">
                  {skipped} skipped
                </span>
              ) : null}
            </div>

            {/* ---- the shared graph + legend ---- */}
            <DagGraphSvg tasks={batch.tasks} batchId={batch.batchId} onSelectTask={onSelectTask} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
