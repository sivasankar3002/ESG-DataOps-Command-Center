'use client'

// =====================================================================
// ESG DataOps Command Center — Batch Explorer (lineage drilldown)
// Opens from the Pipeline Runs tab (Gantt cards / run sheet) and shows
// the complete lineage of one batch: DAG tasks → files → staging → DQ
// checks → incidents/evidence → reconciliation → warehouse impact.
// Powers the "full batch_id/run_id traceability" interview story.
// =====================================================================

import { useEffect, useState } from 'react'
import {
  Boxes,
  CheckCircle2,
  CircleAlert,
  Database,
  Download,
  FileWarning,
  GitBranch,
  Loader2,
  ScrollText,
  ShieldAlert,
  Siren,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { DagGraphSvg } from './dag-graph'
import {
  CheckStatusChip,
  Chip,
  EmptyState,
  FileStatusChip,
  IncidentStatusChip,
  JobStatusChip,
  SeverityChip,
  fmtBytes,
  fmtNum,
  fmtTime,
} from './shared'

interface BatchLineage {
  batch: {
    batchId: string
    businessDate: string
    dagId: string
    startedAt: string | null
    endedAt: string | null
    totalDurationSeconds: number
    status: string
    taskCount: number
    failedTasks: number
    skippedTasks: number
  }
  tasks: {
    runId: string
    taskId: string
    jobName: string
    jobType: string
    sequence: number
    startTime: string
    endTime: string | null
    durationSeconds: number | null
    status: string
    rowsRead: number | null
    rowsLoaded: number | null
    rowsRejected: number | null
    errorMessage: string | null
  }[]
  files: {
    fileId: string
    fileName: string
    dataset: string
    zone: string
    fileStatus: string
    checksumStatus: string
    checksumValue: string
    fileSizeBytes: number
    receivedAt: string | null
    errorMessage: string | null
  }[]
  staging: {
    energyValid: number
    energyRejected: number
    carbonValid: number
    carbonRejected: number
    siteMasterValid: number
    siteMasterRejected: number
    rejectionReasons: string[]
  }
  dq: {
    summary: { executed: number; passed: number; failed: number; warn: number }
    checks: {
      checkId: number
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
    }[]
  }
  incidents: {
    incidentId: string
    incidentType: string
    severity: string
    status: string
    shortDescription: string
    affectedFile: string | null
    affectedCheck: string | null
    runbookLink: string | null
    escalatedFlag: boolean
    createdAt: string
    workNoteCount: number
    evidenceCount: number
  }[]
  reconciliation: {
    sourceCount: number
    targetCount: number
    diffRows: number
    sourceEnergy: number
    targetEnergy: number
    energyDiff: number
    sourceEmissions: number
    targetEmissions: number
    status: string
  }
  warehouse: {
    factRows: number
    sitesCovered: number
    totalEnergyKwh: number
    totalEmissionsCo2e: number
  }
  alerts: {
    alertId: number
    alertType: string
    severity: string
    message: string
    channels: string
    acknowledgedFlag: boolean
    createdAt: string
  }[]
}

export function BatchExplorerDialog({
  batchId,
  onClose,
  onOpenIncident,
}: {
  batchId: string | null
  onClose: () => void
  onOpenIncident: (incidentId: string) => void
}) {
  return (
    <Dialog open={batchId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-5xl max-h-[88vh] overflow-y-auto">
        {/* key remounts the lineage per batch — state resets naturally, no effects */}
        {batchId ? (
          <BatchLineageContent key={batchId} batchId={batchId} onClose={onClose} onOpenIncident={onOpenIncident} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function BatchLineageContent({
  batchId,
  onClose,
  onOpenIncident,
}: {
  batchId: string
  onClose: () => void
  onOpenIncident: (incidentId: string) => void
}) {
  const [lineage, setLineage] = useState<BatchLineage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAllChecks, setShowAllChecks] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/batches/${encodeURIComponent(batchId)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Failed to load batch ${batchId}`)
        }
        return (await res.json()) as BatchLineage
      })
      .then((json) => {
        if (!cancelled) setLineage(json)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : `Failed to load batch ${batchId}`)
      })
    return () => {
      cancelled = true
    }
  }, [batchId])

  const nonPassChecks = lineage?.dq.checks.filter((c) => c.status !== 'PASS') ?? []
  const visibleChecks = showAllChecks ? (lineage?.dq.checks ?? []) : nonPassChecks

  return (
    <>
      {error ? (
        <>
          <DialogHeader>
            <DialogTitle className="text-sm font-mono">Batch lineage</DialogTitle>
            <DialogDescription className="text-xs">{error}</DialogDescription>
          </DialogHeader>
          <EmptyState title="No lineage found" hint="This batch id has no runs, files or incidents recorded." />
        </>
      ) : !lineage ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <DialogTitle className="sr-only">Loading batch lineage</DialogTitle>
          <DialogDescription className="sr-only">
            Assembling the lineage for {batchId} from job_run_audit, file_ingestion_log, dq_check_results and fact tables.
          </DialogDescription>
          <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
          <p className="text-sm text-muted-foreground">Assembling batch lineage…</p>
        </div>
      ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-sm flex flex-wrap items-center gap-2">
                <GitBranch className="h-4 w-4 text-emerald-600" />
                <span className="font-mono">{lineage.batch.batchId}</span>
                <Chip
                  tone={
                    lineage.batch.status === 'SUCCESS'
                      ? 'green'
                      : lineage.batch.status === 'FAILED'
                        ? 'red'
                        : 'amber'
                  }
                >
                  {lineage.batch.status}
                </Chip>
                <span className="text-muted-foreground font-sans font-normal">
                  business date {lineage.batch.businessDate} · DAG {lineage.batch.dagId}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 ml-auto text-[11px]"
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/batches/${encodeURIComponent(lineage.batch.batchId)}/export?format=md`, { cache: 'no-store' })
                      if (!res.ok) {
                        toast.error('Failed to export lineage')
                        return
                      }
                      const text = await res.text()
                      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url
                      a.download = `batch_lineage_${lineage.batch.batchId}.md`
                      document.body.appendChild(a)
                      a.click()
                      document.body.removeChild(a)
                      URL.revokeObjectURL(url)
                      toast.success('Lineage exported as markdown')
                    } catch {
                      toast.error('Export failed')
                    }
                  }}
                  title="Download the full batch lineage as a Markdown handover artifact"
                >
                  <Download className="h-3.5 w-3.5" /> Export markdown
                </Button>
              </DialogTitle>
              <DialogDescription className="text-xs">
                End-to-end lineage: tasks → files → staging → data quality → incidents → reconciliation →
                warehouse. Started {fmtTime(lineage.batch.startedAt)} · finished{' '}
                {fmtTime(lineage.batch.endedAt)} · wall clock{' '}
                {lineage.batch.totalDurationSeconds.toFixed(1)}s · {lineage.batch.taskCount} tasks
                {lineage.batch.failedTasks > 0 ? ` · ${lineage.batch.failedTasks} failed` : ''}
                {lineage.batch.skippedTasks > 0 ? ` · ${lineage.batch.skippedTasks} skipped` : ''}
              </DialogDescription>
            </DialogHeader>

            {/* ---- impact stat strip ---- */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 text-center">
              <StatTile icon={<FileWarning className="h-3.5 w-3.5" />} label="Files" value={`${lineage.files.length}`} sub={`${lineage.files.filter((f) => f.fileStatus === 'QUARANTINED').length} quarantined`} />
              <StatTile icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="DQ checks" value={`${lineage.dq.summary.passed}/${lineage.dq.summary.executed}`} sub={`${lineage.dq.summary.failed} failed · ${lineage.dq.summary.warn} warn`} />
              <StatTile icon={<ShieldAlert className="h-3.5 w-3.5" />} label="Incidents" value={`${lineage.incidents.length}`} sub={`${lineage.incidents.filter((i) => i.status === 'OPEN' || i.status === 'IN_PROGRESS').length} active`} />
              <StatTile icon={<Boxes className="h-3.5 w-3.5" />} label="Recon" value={lineage.reconciliation.status} sub={`${lineage.reconciliation.diffRows} row diff`} />
              <StatTile icon={<Database className="h-3.5 w-3.5" />} label="Fact rows" value={fmtNum(lineage.warehouse.factRows)} sub={`${lineage.warehouse.sitesCovered} sites`} />
              <StatTile icon={<Siren className="h-3.5 w-3.5" />} label="Alerts" value={`${lineage.alerts.length}`} sub={`${lineage.alerts.filter((a) => !a.acknowledgedFlag).length} unacked`} />
            </div>

            {/* ---- pipeline dependency graph (per-batch) ---- */}
            <SectionTitle
              icon={<GitBranch className="h-3.5 w-3.5" />}
              title="Pipeline dependency graph"
              hint="Node colours are this batch's job_run_audit statuses — the same 8-task topology rendered on the Pipeline Runs tab."
            />
            <DagGraphSvg tasks={lineage.tasks} batchId={lineage.batch.batchId} />

            {/* ---- DAG tasks ---- */}
            <SectionTitle icon={<GitBranch className="h-3.5 w-3.5" />} title={`DAG tasks (${lineage.tasks.length})`} />
            <div className="rounded-lg border overflow-auto max-h-72">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider">#</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Task</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Type</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Started</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-right">Duration</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-right">Read</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-right">Loaded</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-right">Rejected</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineage.tasks.map((t) => (
                    <TableRow key={t.runId} className={t.status === 'FAILED' ? 'bg-red-50/50 dark:bg-red-950/20' : ''}>
                      <TableCell className="text-[11px] tabular-nums text-muted-foreground">{t.sequence + 1}</TableCell>
                      <TableCell className="text-xs font-medium">
                        {t.taskId}
                        {t.errorMessage ? (
                          <CircleAlert className="inline ml-1 h-3.5 w-3.5 text-red-500 align-text-bottom" />
                        ) : null}
                        {t.errorMessage ? (
                          <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5 max-w-md truncate" title={t.errorMessage}>
                            {t.errorMessage}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">{t.jobType}</TableCell>
                      <TableCell className="text-[11px] whitespace-nowrap">{fmtTime(t.startTime).slice(11)}</TableCell>
                      <TableCell className="text-[11px] text-right tabular-nums">
                        {t.durationSeconds !== null ? `${t.durationSeconds.toFixed(1)}s` : '-'}
                      </TableCell>
                      <TableCell className="text-[11px] text-right tabular-nums">{fmtNum(t.rowsRead)}</TableCell>
                      <TableCell className="text-[11px] text-right tabular-nums">{fmtNum(t.rowsLoaded)}</TableCell>
                      <TableCell className="text-[11px] text-right tabular-nums">
                        {t.rowsRejected !== null && t.rowsRejected > 0 ? (
                          <span className="text-red-600 dark:text-red-400 font-medium">{fmtNum(t.rowsRejected)}</span>
                        ) : (
                          fmtNum(t.rowsRejected)
                        )}
                      </TableCell>
                      <TableCell>
                        <JobStatusChip status={t.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* ---- files + staging ---- */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <SectionTitle icon={<ScrollText className="h-3.5 w-3.5" />} title={`Files ingested (${lineage.files.length})`} />
                <div className="rounded-lg border overflow-auto max-h-60">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="text-[10px] font-semibold uppercase tracking-wider">File</TableHead>
                        <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Zone</TableHead>
                        <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Checksum</TableHead>
                        <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-right">Size</TableHead>
                        <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lineage.files.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-xs text-muted-foreground text-center py-6">
                            No files recorded for this batch.
                          </TableCell>
                        </TableRow>
                      ) : (
                        lineage.files.map((f) => (
                          <TableRow key={f.fileId}>
                            <TableCell className="text-[11px] font-mono max-w-[220px] truncate" title={f.fileName}>
                              {f.fileName}
                            </TableCell>
                            <TableCell className="text-[11px] text-muted-foreground">{f.zone}</TableCell>
                            <TableCell className="text-[11px]">
                              <span
                                className={
                                  f.checksumStatus === 'VALID'
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : f.checksumStatus === 'INVALID'
                                      ? 'text-red-600 dark:text-red-400 font-medium'
                                      : 'text-muted-foreground'
                                }
                              >
                                {f.checksumStatus}
                              </span>
                            </TableCell>
                            <TableCell className="text-[11px] text-right tabular-nums">{fmtBytes(f.fileSizeBytes)}</TableCell>
                            <TableCell>
                              <FileStatusChip status={f.fileStatus} />
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div>
                <SectionTitle icon={<Database className="h-3.5 w-3.5" />} title="Staging & warehouse impact" />
                <div className="rounded-lg border p-3 space-y-2.5 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <Kv label="Staging energy rows" value={`${fmtNum(lineage.staging.energyValid)} valid`} extra={`${lineage.staging.energyRejected} rejected`} bad={lineage.staging.energyRejected > 0} />
                    <Kv label="Staging carbon rows" value={`${fmtNum(lineage.staging.carbonValid)} valid`} extra={`${lineage.staging.carbonRejected} rejected`} bad={lineage.staging.carbonRejected > 0} />
                    <Kv label="Staging site_master rows" value={`${fmtNum(lineage.staging.siteMasterValid)} valid`} extra={`${lineage.staging.siteMasterRejected} rejected`} bad={lineage.staging.siteMasterRejected > 0} />
                    <Kv label="Fact rows loaded" value={fmtNum(lineage.warehouse.factRows)} extra={`${lineage.warehouse.sitesCovered} sites covered`} />
                    <Kv label="Energy loaded" value={`${fmtNum(lineage.warehouse.totalEnergyKwh, 1)} kWh`} extra={`${fmtNum(lineage.warehouse.totalEmissionsCo2e, 1)} kg CO2e`} />
                  </div>
                  <Separator />
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                      Source → target reconciliation
                    </p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="tabular-nums">
                        rows {fmtNum(lineage.reconciliation.sourceCount)} → {fmtNum(lineage.reconciliation.targetCount)}
                        <span className={lineage.reconciliation.diffRows !== 0 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-emerald-600 dark:text-emerald-400'}>
                          {' '}({lineage.reconciliation.diffRows >= 0 ? '+' : ''}{lineage.reconciliation.diffRows})
                        </span>
                      </span>
                      <span className="tabular-nums">
                        energy {fmtNum(lineage.reconciliation.sourceEnergy, 1)} → {fmtNum(lineage.reconciliation.targetEnergy, 1)} kWh
                        <span className={Math.abs(lineage.reconciliation.energyDiff) > 0.01 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-emerald-600 dark:text-emerald-400'}>
                          {' '}({lineage.reconciliation.energyDiff.toFixed(2)})
                        </span>
                      </span>
                      <Chip tone={lineage.reconciliation.status === 'PASS' ? 'green' : 'red'}>
                        {lineage.reconciliation.status}
                      </Chip>
                    </div>
                  </div>
                  {lineage.staging.rejectionReasons.length > 0 ? (
                    <>
                      <Separator />
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                          Staging rejection reasons
                        </p>
                        <ul className="space-y-0.5">
                          {lineage.staging.rejectionReasons.slice(0, 6).map((r) => (
                            <li key={r} className="text-[11px] text-red-600 dark:text-red-400 font-mono break-all">
                              • {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            {/* ---- DQ checks ---- */}
            <SectionTitle
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              title={`Data quality checks — ${lineage.dq.summary.passed} passed · ${lineage.dq.summary.failed} failed · ${lineage.dq.summary.warn} warn`}
              right={
                lineage.dq.summary.executed > 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => setShowAllChecks((v) => !v)}
                  >
                    {showAllChecks ? 'Show failures only' : `Show all ${lineage.dq.summary.executed}`}
                  </Button>
                ) : undefined
              }
            />
            <div className="rounded-lg border overflow-auto max-h-64">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Check</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Category</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Target</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Expected → actual</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Severity</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleChecks.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-xs text-muted-foreground text-center py-6">
                        {lineage.dq.summary.executed === 0
                          ? 'No DQ checks recorded for this batch.'
                          : 'All checks passed — switch to "Show all" to review them.'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleChecks.map((c) => (
                      <TableRow key={c.checkId} className={c.status === 'FAIL' ? 'bg-red-50/50 dark:bg-red-950/20' : ''}>
                        <TableCell className="text-[11px] font-mono max-w-[200px] truncate" title={c.checkName}>
                          {c.checkName}
                        </TableCell>
                        <TableCell className="text-[11px] text-muted-foreground">{c.checkCategory}</TableCell>
                        <TableCell className="text-[11px] font-mono text-muted-foreground max-w-[140px] truncate" title={`${c.tableName ?? ''}${c.columnName ? '.' + c.columnName : ''}`}>
                          {c.tableName ?? '-'}
                          {c.columnName ? `.${c.columnName}` : ''}
                        </TableCell>
                        <TableCell className="text-[11px] max-w-[220px] truncate" title={`${c.expectedValue ?? ''} → ${c.actualValue ?? ''}${c.errorDetails ? ' | ' + c.errorDetails : ''}`}>
                          {c.expectedValue !== null || c.actualValue !== null ? (
                            <span className="font-mono">
                              {c.expectedValue ?? '∅'} → <span className={c.status === 'FAIL' ? 'text-red-600 dark:text-red-400 font-medium' : ''}>{c.actualValue ?? '∅'}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip tone={c.severity === 'CRITICAL' ? 'red' : c.severity === 'HIGH' ? 'orange' : c.severity === 'MEDIUM' ? 'amber' : 'zinc'}>
                            {c.severity}
                          </Chip>
                        </TableCell>
                        <TableCell>
                          <CheckStatusChip status={c.status} />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* ---- incidents ---- */}
            <SectionTitle icon={<ShieldAlert className="h-3.5 w-3.5" />} title={`Incidents raised by this batch (${lineage.incidents.length})`} />
            {lineage.incidents.length === 0 ? (
              <EmptyState title="No incidents for this batch" hint="Every check passed — nothing was raised to the incident queue." />
            ) : (
              <ul className="space-y-2">
                {lineage.incidents.map((i) => (
                  <li key={i.incidentId}>
                    <button
                      onClick={() => {
                        onClose()
                        onOpenIncident(i.incidentId)
                      }}
                      className="w-full text-left rounded-lg border bg-card p-3 hover:border-emerald-400/60 hover:shadow-sm transition-colors"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold">{i.incidentId}</span>
                        <SeverityChip severity={i.severity} />
                        <IncidentStatusChip status={i.status} />
                        {i.escalatedFlag ? <Chip tone="violet">ESCALATED</Chip> : null}
                        <Chip tone="zinc">{i.incidentType.replace(/_/g, ' ')}</Chip>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {i.workNoteCount} work note(s) · {i.evidenceCount} evidence file(s)
                        </span>
                      </div>
                      <p className="text-xs mt-1.5 text-muted-foreground line-clamp-2">{i.shortDescription}</p>
                      {i.affectedFile ? (
                        <p className="text-[10px] font-mono text-muted-foreground mt-1 truncate" title={i.affectedFile}>
                          file: {i.affectedFile}
                          {i.affectedCheck ? ` · check: ${i.affectedCheck}` : ''}
                        </p>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* ---- batch alerts ---- */}
            {lineage.alerts.length > 0 ? (
              <>
                <SectionTitle icon={<Siren className="h-3.5 w-3.5" />} title={`Alerts dispatched for this batch (${lineage.alerts.length})`} />
                <ul className="rounded-lg border divide-y divide-border max-h-44 overflow-y-auto">
                  {lineage.alerts.map((a) => (
                    <li key={a.alertId} className="px-3 py-2 flex items-start gap-2">
                      <Chip tone={a.severity === 'CRITICAL' || a.severity === 'P1' ? 'red' : a.severity === 'HIGH' || a.severity === 'P2' ? 'orange' : 'amber'}>
                        {a.alertType.replace(/_/g, ' ')}
                      </Chip>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs leading-snug">{a.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {fmtTime(a.createdAt)} · via {a.channels}
                          {a.acknowledgedFlag ? ' · acknowledged' : ' · unacknowledged'}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <p className="text-[10px] text-muted-foreground">
              Lineage assembled live from job_run_audit, file_ingestion_log, staging tables, dq_check_results,
              incident_log and fact_energy_emissions — the same batch_id joins an L1 engineer would write by hand.
            </p>
          </>
      )}
    </>
  )
}

function StatTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub: string
}) {
  return (
    <div className="rounded-lg border bg-card px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <p className="text-[10px] font-semibold uppercase tracking-wider truncate">{label}</p>
      </div>
      <p className="text-base font-bold tabular-nums leading-tight mt-0.5">{value}</p>
      <p className="text-[10px] text-muted-foreground/80 truncate">{sub}</p>
    </div>
  )
}

function SectionTitle({
  icon,
  title,
  hint,
  right,
}: {
  icon: React.ReactNode
  title: string
  /** Optional one-line explanation rendered under the heading. */
  hint?: string
  right?: React.ReactNode
}) {
  return (
    <div className="mt-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
          {icon}
          <h3 className="text-xs font-semibold tracking-tight text-foreground">{title}</h3>
        </div>
        {right}
      </div>
      {hint ? <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p> : null}
    </div>
  )
}

function Kv({
  label,
  value,
  extra,
  bad,
}: {
  label: string
  value: string
  extra?: string
  bad?: boolean
}) {
  return (
    <div className="rounded border bg-muted/30 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums leading-tight mt-0.5">{value}</p>
      {extra ? (
        <p className={bad ? 'text-[10px] text-red-600 dark:text-red-400' : 'text-[10px] text-muted-foreground/80'}>{extra}</p>
      ) : null}
    </div>
  )
}

export type { BatchLineage }
