'use client'

// =====================================================================
// ESG DataOps Command Center — Batch Comparison dialog
// Diff two batches side-by-side: DQ checks (status / expected→actual),
// reconciliation deltas, warehouse impact (kWh / CO2e / sites), and
// the incidents raised. This is the "diff two batches' check results"
// interview-friendly traceability feature.
// =====================================================================

import { useEffect, useState } from 'react'
import { GitCompare, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  CheckStatusChip,
  Chip,
  EmptyState,
  SeverityChip,
  fmtNum,
} from './shared'
import { cn } from '@/lib/utils'

interface BatchSummary {
  batchId: string
  startedAt: string
  status: string
}

interface DqCheckRow {
  checkId: number
  checkName: string
  checkCategory: string
  status: string
  severity: string
  tableName: string | null
  columnName: string | null
  expectedValue: string | null
  actualValue: string | null
}

interface BatchComparePayload {
  left: {
    batchId: string
    businessDate: string
    status: string
    startedAt: string | null
    totalDurationSeconds: number
    dqSummary: { executed: number; passed: number; failed: number; warn: number }
    incidents: { incidentId: string; severity: string; incidentType: string; status: string }[]
    reconciliation: {
      sourceCount: number
      targetCount: number
      diffRows: number
      sourceEnergy: number
      targetEnergy: number
      energyDiff: number
      status: string
    }
    warehouse: {
      factRows: number
      sitesCovered: number
      totalEnergyKwh: number
      totalEmissionsCo2e: number
    }
  }
  right: {
    batchId: string
    businessDate: string
    status: string
    startedAt: string | null
    totalDurationSeconds: number
    dqSummary: { executed: number; passed: number; failed: number; warn: number }
    incidents: { incidentId: string; severity: string; incidentType: string; status: string }[]
    reconciliation: {
      sourceCount: number
      targetCount: number
      diffRows: number
      sourceEnergy: number
      targetEnergy: number
      energyDiff: number
      status: string
    }
    warehouse: {
      factRows: number
      sitesCovered: number
      totalEnergyKwh: number
      totalEmissionsCo2e: number
    }
  }
  checks: {
    checkName: string
    checkCategory: string
    target: string
    leftStatus: string | null
    rightStatus: string | null
    leftExpected: string | null
    rightExpected: string | null
    leftActual: string | null
    rightActual: string | null
    severity: string
    diff: 'ADDED' | 'REMOVED' | 'CHANGED' | 'SAME'
  }[]
}

export function BatchCompareDialog({
  leftBatchId,
  rightBatchId,
  setLeftBatchId,
  setRightBatchId,
  onClose,
  availableBatches,
}: {
  leftBatchId: string | null
  rightBatchId: string | null
  setLeftBatchId: (id: string | null) => void
  setRightBatchId: (id: string | null) => void
  onClose: () => void
  availableBatches: BatchSummary[]
}) {
  const open = leftBatchId !== null && rightBatchId !== null
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="sm:max-w-6xl w-[95vw] max-h-[88vh] overflow-y-auto">
        {open ? (
          <BatchCompareContent
            key={`${leftBatchId}__${rightBatchId}`}
            leftBatchId={leftBatchId as string}
            rightBatchId={rightBatchId as string}
            availableBatches={availableBatches}
            onPickLeft={(v) => {
              if (v === rightBatchId) {
                toast.warning('Pick a different batch on each side')
                return
              }
              setLeftBatchId(v)
            }}
            onPickRight={(v) => {
              if (v === leftBatchId) {
                toast.warning('Pick a different batch on each side')
                return
              }
              setRightBatchId(v)
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function BatchCompareContent({
  leftBatchId,
  rightBatchId,
  availableBatches,
  onPickLeft,
  onPickRight,
}: {
  leftBatchId: string
  rightBatchId: string
  availableBatches: BatchSummary[]
  onPickLeft: (id: string) => void
  onPickRight: (id: string) => void
}) {
  const [data, setData] = useState<BatchComparePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Default to "ALL" so users immediately see the full DQ check diff table
  // with the diff chips highlighting changes. They can narrow to "CHANGED"
  // only via the dropdown above the table.
  const [filter, setFilter] = useState<'ALL' | 'CHANGED' | 'ADDED' | 'REMOVED'>('ALL')

  // Parent passes key={`${leftBatchId}__${rightBatchId}`} so this component
  // remounts whenever either side changes — state resets naturally, no
  // effect-driven setData(null) needed (avoids the cascading-render lint).
  useEffect(() => {
    let cancelled = false
    fetch(`/api/batches/compare?left=${encodeURIComponent(leftBatchId)}&right=${encodeURIComponent(rightBatchId)}`, {
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Failed to compare ${leftBatchId} vs ${rightBatchId}`)
        }
        return (await res.json()) as BatchComparePayload
      })
      .then((json) => {
        if (!cancelled) setData(json)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load comparison')
      })
    return () => {
      cancelled = true
    }
  }, [leftBatchId, rightBatchId])

  const visibleChecks = (data?.checks ?? []).filter((c) => filter === 'ALL' || c.diff === filter)

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-sm flex flex-wrap items-center gap-2">
          <GitCompare className="h-4 w-4 text-emerald-600" />
          Batch comparison
        </DialogTitle>
        <DialogDescription className="text-xs">
          Side-by-side diff of DQ checks, reconciliation, warehouse impact and incidents.
          Useful for spotting what changed between two production runs of the same pipeline.
        </DialogDescription>
      </DialogHeader>

      {/* ---- batch pickers ---- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
        <div className="rounded-lg border bg-emerald-50/40 dark:bg-emerald-950/20 p-3 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Baseline (left)</p>
          <Select value={leftBatchId} onValueChange={onPickLeft}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableBatches.map((b) => (
                <SelectItem key={b.batchId} value={b.batchId}>
                  {b.batchId} · {b.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="rounded-lg border bg-violet-50/40 dark:bg-violet-950/20 p-3 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Comparison (right)</p>
          <Select value={rightBatchId} onValueChange={onPickRight}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableBatches.map((b) => (
                <SelectItem key={b.batchId} value={b.batchId}>
                  {b.batchId} · {b.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? (
        <EmptyState title="Comparison failed" hint={error} />
      ) : !data ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
          <p className="text-sm text-muted-foreground">Diffing batches…</p>
        </div>
      ) : (
        <>
          {/* ---- batch summary diff ---- */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
            <SummaryCell label="Business date" left={data.left.businessDate} right={data.right.businessDate} />
            <SummaryCell
              label="DAG status"
              left={data.left.status}
              right={data.right.status}
              toneLeft={data.left.status === 'SUCCESS' ? 'green' : 'red'}
              toneRight={data.right.status === 'SUCCESS' ? 'green' : 'red'}
            />
            <SummaryCell
              label="DQ failed"
              left={String(data.left.dqSummary.failed)}
              right={String(data.right.dqSummary.failed)}
              toneLeft={data.left.dqSummary.failed > 0 ? 'red' : 'green'}
              toneRight={data.right.dqSummary.failed > 0 ? 'red' : 'green'}
            />
            <SummaryCell
              label="Incidents"
              left={String(data.left.incidents.length)}
              right={String(data.right.incidents.length)}
              toneLeft={data.left.incidents.length > 0 ? 'amber' : 'green'}
              toneRight={data.right.incidents.length > 0 ? 'amber' : 'green'}
            />
            <SummaryCell
              label="Recon row diff"
              left={String(data.left.reconciliation.diffRows)}
              right={String(data.right.reconciliation.diffRows)}
              toneLeft={data.left.reconciliation.diffRows !== 0 ? 'red' : 'green'}
              toneRight={data.right.reconciliation.diffRows !== 0 ? 'red' : 'green'}
            />
            <SummaryCell
              label="Fact rows"
              left={fmtNum(data.left.warehouse.factRows)}
              right={fmtNum(data.right.warehouse.factRows)}
            />
            <SummaryCell
              label="Energy (kWh)"
              left={fmtNum(data.left.warehouse.totalEnergyKwh, 1)}
              right={fmtNum(data.right.warehouse.totalEnergyKwh, 1)}
            />
            <SummaryCell
              label="CO₂e (kg)"
              left={fmtNum(data.left.warehouse.totalEmissionsCo2e, 1)}
              right={fmtNum(data.right.warehouse.totalEmissionsCo2e, 1)}
            />
          </div>

          {/* ---- diff legend ---- */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
              {(['ADDED', 'REMOVED', 'CHANGED', 'SAME'] as const).map((d) => (
                <span key={d} className="inline-flex items-center gap-1.5">
                  <DiffChip diff={d} compact />
                  {d.toLowerCase()}
                </span>
              ))}
            </div>
            <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <SelectTrigger className="h-7 w-[150px] text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All checks</SelectItem>
                <SelectItem value="CHANGED">Diffs only</SelectItem>
                <SelectItem value="ADDED">Added</SelectItem>
                <SelectItem value="REMOVED">Removed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* ---- DQ checks diff ---- */}
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-3 mb-1">
            DQ check diff ({visibleChecks.length} of {data.checks.length})
          </p>
          <div className="rounded-lg border overflow-auto max-h-72">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Check</TableHead>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Target</TableHead>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Sev</TableHead>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Left status</TableHead>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Right status</TableHead>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Diff</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleChecks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-xs text-muted-foreground text-center py-6">
                      No checks match the current filter — switch the filter to view more.
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleChecks.map((c) => (
                    <TableRow
                      key={`${c.checkName}-${c.target}`}
                      className={c.diff === 'CHANGED' ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''}
                    >
                      <TableCell className="text-[11px] font-mono max-w-[200px] truncate" title={c.checkName}>
                        {c.checkName}
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground max-w-[140px] truncate" title={c.target}>
                        {c.target || '-'}
                      </TableCell>
                      <TableCell>
                        <Chip
                          tone={
                            c.severity === 'CRITICAL'
                              ? 'red'
                              : c.severity === 'HIGH'
                                ? 'orange'
                                : c.severity === 'MEDIUM'
                                  ? 'amber'
                                  : 'zinc'
                          }
                        >
                          {c.severity}
                        </Chip>
                      </TableCell>
                      <TableCell className="text-[11px]">
                        {c.leftStatus ? <CheckStatusChip status={c.leftStatus} /> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        {c.rightStatus ? <CheckStatusChip status={c.rightStatus} /> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <DiffChip diff={c.diff} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* ---- incidents diff ---- */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            <IncidentList
              title={`Left incidents — ${data.left.batchId}`}
              incidents={data.left.incidents}
              tone="emerald"
            />
            <IncidentList
              title={`Right incidents — ${data.right.batchId}`}
              incidents={data.right.incidents}
              tone="violet"
            />
          </div>

          <p className="text-[10px] text-muted-foreground mt-4">
            Diff computed from dq_check_results + incident_log joined by check_name + target table/column.
            Added = present on right only; Removed = left only; Changed = status differs.
          </p>
        </>
      )}
    </>
  )
}

function SummaryCell({
  label,
  left,
  right,
  toneLeft,
  toneRight,
}: {
  label: string
  left: string
  right: string
  toneLeft?: 'green' | 'red' | 'amber'
  toneRight?: 'green' | 'red' | 'amber'
}) {
  const toneClass = (t?: 'green' | 'red' | 'amber') =>
    t === 'green'
      ? 'text-emerald-700 dark:text-emerald-400'
      : t === 'red'
        ? 'text-red-700 dark:text-red-400 font-medium'
        : t === 'amber'
          ? 'text-amber-700 dark:text-amber-400'
          : 'text-foreground'
  return (
    <div className="rounded-lg border bg-card p-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</p>
      <div className="grid grid-cols-2 gap-1 mt-0.5">
        <p className={cn('text-xs font-semibold tabular-nums', toneClass(toneLeft))}>{left}</p>
        <p className={cn('text-xs font-semibold tabular-nums', toneClass(toneRight))}>{right}</p>
      </div>
    </div>
  )
}

function DiffChip({ diff, compact }: { diff: 'ADDED' | 'REMOVED' | 'CHANGED' | 'SAME'; compact?: boolean }) {
  const map: Record<typeof diff, { tone: 'green' | 'red' | 'amber' | 'zinc'; label: string }> = {
    ADDED: { tone: 'green', label: '+' },
    REMOVED: { tone: 'red', label: '−' },
    CHANGED: { tone: 'amber', label: 'Δ' },
    SAME: { tone: 'zinc', label: '=' },
  }
  const v = map[diff]
  return (
    <Chip tone={v.tone} className={cn('text-[9px]', compact && 'h-4 w-4 justify-center p-0')}>
      {v.label}
    </Chip>
  )
}

function IncidentList({
  title,
  incidents,
  tone,
}: {
  title: string
  incidents: { incidentId: string; severity: string; incidentType: string; status: string }[]
  tone: 'emerald' | 'violet'
}) {
  const accent =
    tone === 'emerald'
      ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/30 dark:bg-emerald-950/20'
      : 'border-violet-200 dark:border-violet-900 bg-violet-50/30 dark:bg-violet-950/20'
  return (
    <div className={cn('rounded-lg border p-2.5 space-y-1.5', accent)}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {incidents.length === 0 ? (
        <p className="text-xs text-muted-foreground">No incidents raised by this batch.</p>
      ) : (
        <ul className="space-y-1">
          {incidents.map((i) => (
            <li key={i.incidentId} className="flex items-center gap-2 text-xs">
              <span className="font-mono">{i.incidentId}</span>
              <SeverityChip severity={i.severity} />
              <Chip tone="zinc">{i.incidentType.replace(/_/g, ' ')}</Chip>
              <span className="text-muted-foreground ml-auto text-[10px]">{i.status.replace(/_/g, ' ')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
