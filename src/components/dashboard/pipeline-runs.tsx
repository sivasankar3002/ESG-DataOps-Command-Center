'use client'

// =====================================================================
// Tab: Pipeline Runs — job_run_audit with filters + run detail sheet
// + batch replay (L1 "root cause fixed, reload the feed" workflow)
// =====================================================================

import { useEffect, useMemo, useState } from 'react'
import { CircleAlert, GitBranch, GitCompare, Loader2, RotateCcw, Search } from 'lucide-react'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Separator } from '@/components/ui/separator'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { DashboardState } from '@/lib/esg/dashboard'
import { GanttLegend, PipelineGanttChart } from './charts'
import { DagGraphCard } from './dag-graph'
import { BatchCompareDialog } from './batch-compare'
import { BatchExplorerDialog } from './batch-explorer'
import {
  EmptyState,
  JobStatusChip,
  Mono,
  SectionHeader,
  TableShell,
  fmtNum,
  fmtTime,
} from './shared'

export function PipelineRunsTab({
  state,
  onOpenIncident,
  refresh,
  pendingBatchId,
  onConsumePendingBatchId,
  pendingCompare,
  onConsumePendingCompare,
  can,
}: {
  state: DashboardState
  onOpenIncident: (incidentId: string) => void
  /** Refresh the shared dashboard state (used after a replay). */
  refresh: () => void
  /** Batch lineage to auto-open (set by the command palette). */
  pendingBatchId?: string | null
  /** Clear the pending deep-link once consumed. */
  onConsumePendingBatchId?: () => void
  /** Open the compare dialog on the two latest batches (command palette). */
  pendingCompare?: boolean
  /** Clear the pending compare request once consumed. */
  onConsumePendingCompare?: () => void
  /** RBAC capability check — replaying a batch is L1+ only. */
  can: (capability: import('@/lib/esg/roles').Capability) => boolean
}) {
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [taskFilter, setTaskFilter] = useState<string>('ALL')
  const [selected, setSelected] = useState<DashboardState['runs'][number] | null>(null)
  const [exploreBatchId, setExploreBatchId] = useState<string | null>(null)
  const [compareLeft, setCompareLeft] = useState<string | null>(null)
  const [compareRight, setCompareRight] = useState<string | null>(null)
  // ---- batch replay state (L1 recovery workflow) ----
  const [replayBatch, setReplayBatch] = useState<{ batchId: string; businessDate: string } | null>(null)
  const [replaying, setReplaying] = useState(false)

  // Deep-link support: the command palette (⌘K) can open a batch lineage
  // directly. Consumed once so it does not re-fire on re-renders.
  useEffect(() => {
    if (pendingBatchId) {
      setExploreBatchId(pendingBatchId)
      onConsumePendingBatchId?.()
    }
  }, [pendingBatchId, onConsumePendingBatchId])

  // Palette deep-link: open the compare dialog on the two most recent
  // batches. Consumed once.
  useEffect(() => {
    if (pendingCompare) {
      const ids = state.batchTimeline.slice(0, 2).map((b) => b.batchId)
      if (ids.length === 2) {
        setCompareLeft(ids[0])
        setCompareRight(ids[1])
      } else {
        toast.info('Need at least 2 batches to compare')
      }
      onConsumePendingCompare?.()
    }
  }, [pendingCompare, state.batchTimeline, onConsumePendingCompare])

  const taskIds = useMemo(
    () => [...new Set(state.runs.map((r) => r.taskId))].sort(),
    [state.runs],
  )
  const batches = useMemo(
    () => [...new Set(state.runs.map((r) => r.batchId))].slice(0, 12),
    [state.runs],
  )
  const [batchFilter, setBatchFilter] = useState<string>('ALL')

  const filtered = state.runs.filter(
    (r) =>
      (statusFilter === 'ALL' || r.status === statusFilter) &&
      (taskFilter === 'ALL' || r.taskId === taskFilter) &&
      (batchFilter === 'ALL' || r.batchId === batchFilter),
  )

  // ---- batch replay: regenerate clean feeds for a historical business
  // date and re-run the DAG as a NEW append-only batch (the runbook
  // "reload the feed" step after the root cause is fixed). -------------
  const runReplay = async () => {
    if (!replayBatch) return
    setReplaying(true)
    try {
      const res = await fetch('/api/pipeline/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessDate: replayBatch.businessDate, regenerate: true }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Replay failed')
        return
      }
      const newBatchId = (json as { batchId?: string }).batchId ?? 'new batch'
      toast.success(`Replay complete — ${newBatchId} created for ${replayBatch.businessDate}`)
      setReplayBatch(null)
      refresh()
      // open the lineage of the fresh batch so the operator can verify it
      setExploreBatchId(newBatchId)
    } catch {
      toast.error('Replay failed')
    } finally {
      setReplaying(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* ---- DAG dependency graph (Airflow-style node/edge view) ---- */}
      <DagGraphCard
        batchTimeline={state.batchTimeline}
        dagId={state.config.dagId}
        onSelectTask={(taskId) => {
          setTaskFilter(taskId)
          toast.info(`Runs table filtered to ${taskId}`, {
            description: 'Clear with the Task dropdown under "Pipeline runs".',
          })
        }}
      />

      {/* ---- batch timeline (Gantt-style) ---- */}
      <Card>
        <CardHeader className="pb-0 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-emerald-600" />
            Batch execution timeline (last {state.batchTimeline.length} batches)
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px] ml-auto"
              disabled={state.batchTimeline.length < 2}
              onClick={() => {
                const ids = state.batchTimeline.slice(0, 2).map((b) => b.batchId)
                setCompareLeft(ids[0])
                setCompareRight(ids[1])
              }}
              title="Compare the two most recent batches side-by-side"
            >
              <GitCompare className="h-3 w-3" /> Compare latest 2 batches
            </Button>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Gantt-style view of the 8-task DAG. Each bar shows the task offset from the batch start; color encodes status (green=success, red=failed, grey=skipped).
          </p>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-3">
          {state.batchTimeline.length === 0 ? (
            <EmptyState title="No batch timeline yet" hint="Run the DAG from the Control Room to populate the Gantt view." />
          ) : (
            <div className="space-y-3">
              {state.batchTimeline.map((batch, idx) => (
                <div key={batch.batchId} className="rounded-lg border bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                    <Mono className="font-semibold">{batch.batchId}</Mono>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">started {fmtTime(batch.startedAt)}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">{batch.tasks.length} tasks</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">{batch.totalDurationSeconds.toFixed(2)}s total</span>
                    {batch.tasks.some((t) => t.status === 'FAILED') ? (
                      <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-medium">
                        <CircleAlert className="h-3.5 w-3.5" /> has failure
                      </span>
                    ) : null}
                    <div className="ml-auto flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[10px] hover:bg-emerald-50 dark:hover:bg-emerald-950 hover:border-emerald-300 dark:hover:border-emerald-800"
                        disabled={replaying || !can('run.dag')}
                        onClick={() =>
                          setReplayBatch({ batchId: batch.batchId, businessDate: batch.businessDate })
                        }
                        title={
                          can('run.dag')
                            ? `Reload ${batch.businessDate}: regenerate clean feeds and re-run the DAG as a new append-only batch (L1 recovery runbook step)`
                            : 'Requires L1 Operator role or higher'
                        }
                      >
                        <RotateCcw className="h-3 w-3" /> Replay
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => {
                          setCompareLeft(batch.batchId)
                          setCompareRight(state.batchTimeline[idx === 0 ? 1 : idx - 1]?.batchId ?? null)
                        }}
                        disabled={state.batchTimeline.length < 2}
                        title={`Compare ${batch.batchId} with the previous batch`}
                      >
                        <GitCompare className="h-3 w-3" /> Compare with prev
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setExploreBatchId(batch.batchId)}
                      >
                        <Search className="h-3 w-3" /> Lineage
                      </Button>
                    </div>
                  </div>
                  <PipelineGanttChart data={batch.tasks} />
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <GanttLegend />
                    <p className="text-[10px] text-muted-foreground">
                      Hover any bar for start, duration and status.
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <SectionHeader
        title="Pipeline runs (job_run_audit)"
        description={`DAG ${state.config.dagId} — every task execution with audit trail, retries and row counts. ${state.runs.length} most recent runs shown.`}
        right={
          <div className="flex flex-wrap gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="SUCCESS">SUCCESS</SelectItem>
                <SelectItem value="FAILED">FAILED</SelectItem>
                <SelectItem value="SKIPPED">SKIPPED</SelectItem>
                <SelectItem value="RUNNING">RUNNING</SelectItem>
              </SelectContent>
            </Select>
            <Select value={taskFilter} onValueChange={setTaskFilter}>
              <SelectTrigger className="h-8 w-[220px] text-xs">
                <SelectValue placeholder="Task" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All tasks</SelectItem>
                {taskIds.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={batchFilter} onValueChange={setBatchFilter}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue placeholder="Batch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All batches</SelectItem>
                {batches.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {filtered.length === 0 ? (
        <EmptyState title="No runs match the filters" hint="Adjust the filters or run the DAG from the Control Room." />
      ) : (
        <TableShell>
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Run ID</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Task</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Type</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Batch</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Started</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Duration</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Read</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Loaded</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Rejected</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow
                  key={r.runId}
                  className="cursor-pointer"
                  onClick={() => setSelected(r)}
                >
                  <TableCell className="font-mono text-[10px] max-w-[180px] truncate" title={r.runId}>
                    {r.runId}
                  </TableCell>
                  <TableCell className="text-xs">{r.taskId}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.jobType}</TableCell>
                  <TableCell className="font-mono text-[10px]">{r.batchId}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{fmtTime(r.startTime)}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">
                    {r.durationSeconds !== null ? `${r.durationSeconds.toFixed(1)}s` : '-'}
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{fmtNum(r.rowsRead)}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{fmtNum(r.rowsLoaded)}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">
                    {r.rowsRejected !== null && r.rowsRejected > 0 ? (
                      <span className="text-red-600 dark:text-red-400 font-medium">{fmtNum(r.rowsRejected)}</span>
                    ) : (
                      fmtNum(r.rowsRejected)
                    )}
                  </TableCell>
                  <TableCell>
                    <JobStatusChip status={r.status} />
                    {r.errorMessage ? (
                      <CircleAlert className="inline ml-1 h-3.5 w-3.5 text-red-500 align-text-bottom" />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>
      )}

      {/* ---- run detail sheet ---- */}
      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          {selected ? (
            <>
              <SheetHeader className="px-4">
                <SheetTitle className="text-sm font-mono break-all">{selected.runId}</SheetTitle>
                <SheetDescription className="text-xs">
                  {selected.jobName} · {selected.jobType} · batch {selected.batchId}
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-6 space-y-4 text-xs">
                <div className="flex flex-wrap gap-2">
                  <JobStatusChip status={selected.status} />
                  <span className="text-muted-foreground">Started {fmtTime(selected.startTime)}</span>
                  <span className="text-muted-foreground">
                    Duration {selected.durationSeconds !== null ? `${selected.durationSeconds.toFixed(2)}s` : '-'}
                  </span>
                </div>
                <Separator />
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded border p-2">
                    <p className="text-[10px] uppercase text-muted-foreground">Rows read</p>
                    <p className="font-semibold tabular-nums">{fmtNum(selected.rowsRead)}</p>
                  </div>
                  <div className="rounded border p-2">
                    <p className="text-[10px] uppercase text-muted-foreground">Rows loaded</p>
                    <p className="font-semibold tabular-nums">{fmtNum(selected.rowsLoaded)}</p>
                  </div>
                  <div className="rounded border p-2">
                    <p className="text-[10px] uppercase text-muted-foreground">Rows rejected</p>
                    <p className="font-semibold tabular-nums text-red-600 dark:text-red-400">
                      {fmtNum(selected.rowsRejected)}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-muted-foreground mb-1">Error message</p>
                  {selected.errorMessage ? (
                    <pre className="whitespace-pre-wrap break-words rounded border bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 p-2 font-mono text-[11px]">
                      {selected.errorMessage}
                    </pre>
                  ) : (
                    <p className="text-muted-foreground">No error — task completed successfully.</p>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Full structured logs for this batch are in the evidence packages of any incident raised
                  by this run (logs/app_YYYY-MM-DD.log on disk).
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs"
                  onClick={() => setExploreBatchId(selected.batchId)}
                >
                  <Search className="h-3.5 w-3.5" /> Open full batch lineage ({selected.batchId})
                </Button>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* ---- batch lineage explorer ---- */}
      <BatchExplorerDialog
        batchId={exploreBatchId}
        onClose={() => setExploreBatchId(null)}
        onOpenIncident={onOpenIncident}
      />

      {/* ---- batch replay confirmation (L1 recovery workflow) ---- */}
      <AlertDialog open={replayBatch !== null} onOpenChange={(open) => !open && setReplayBatch(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">
              Replay {replayBatch?.batchId} (business date {replayBatch?.businessDate})?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed">
              This regenerates <span className="font-medium">clean synthetic feeds</span> for{' '}
              {replayBatch?.businessDate} into the landing zone and re-runs the full 8-task DAG as a{' '}
              <span className="font-medium">new append-only batch</span> (B-…-NN+1). The original batch,
              its DQ results, incidents and evidence are never modified — this models the runbook
              &quot;root cause fixed, reload the feed&quot; recovery step. On completion the new
              batch&apos;s lineage opens automatically so you can verify the reload.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-xs" disabled={replaying}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
              disabled={replaying}
              onClick={(e) => {
                e.preventDefault() // keep the dialog open until the replay resolves
                void runReplay()
              }}
            >
              {replaying ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Replaying…
                </>
              ) : (
                <>
                  <RotateCcw className="h-3.5 w-3.5" /> Regenerate &amp; re-run DAG
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- batch comparison dialog ---- */}
      <BatchCompareDialog
        leftBatchId={compareLeft}
        rightBatchId={compareRight}
        setLeftBatchId={setCompareLeft}
        setRightBatchId={setCompareRight}
        onClose={() => {
          setCompareLeft(null)
          setCompareRight(null)
        }}
        availableBatches={state.batchTimeline.map((b) => ({
          batchId: b.batchId,
          startedAt: b.startedAt,
          status: b.tasks.some((t) => t.status === 'FAILED') ? 'FAILED' : 'SUCCESS',
        }))}
      />
    </div>
  )
}
