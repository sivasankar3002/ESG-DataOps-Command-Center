'use client'

// =====================================================================
// Tab: Data Quality — dq_check_results with trends, check summaries, and
// a per-check detail drawer (rule config + recent execution history +
// runbook deep-link) for L1 triage.
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, CheckCircle2, CircleX, ExternalLink, Loader2, TriangleAlert } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { DashboardState } from '@/lib/esg/dashboard'
import { DqTrendChart } from './charts'
import {
  CheckStatusChip,
  Chip,
  DqSeverityChip,
  EmptyState,
  MetricCard,
  Mono,
  SectionHeader,
  TableShell,
  fmtTime,
} from './shared'

// ---------------------------------------------------------------------
// DQ check detail drawer — loads GET /api/dq/checks?checkName=...
// ---------------------------------------------------------------------
interface DqCheckDetail {
  checkName: string
  description: string
  rule: {
    category: string
    severity: string
    incidentType: string | null
    createIncident: boolean
  } | null
  runbook: { id: string; title: string; file: string } | null
  trend: { examined: number; pass: number; fail: number; warn: number }
  recent: {
    checkId: number
    batchId: string
    businessDate: string
    status: string
    severity: string
    tableName: string | null
    columnName: string | null
    expectedValue: string | null
    actualValue: string | null
    thresholdValue: string | null
    errorDetails: string | null
    executedAt: string
  }[]
}

// ---------------------------------------------------------------------
// Rolling pass-rate trend mini-chart (pure SVG — no recharts overhead).
// Shows the 5-run rolling pass rate for one check over its recent
// executions (oldest → newest): degrading checks dip visibly, flaky
// checks sawtooth. FAIL runs get a red tick on the baseline so single
// failures stay visible even while the rolling window recovers.
// ---------------------------------------------------------------------
function RollingPassRateChart({ recent }: { recent: DqCheckDetail['recent'] }) {
  const WINDOW = 5
  // oldest → newest for a left-to-right time axis
  const runs = [...recent].reverse()
  const rates = runs.map((_, i) => {
    const slice = runs.slice(Math.max(0, i - WINDOW + 1), i + 1)
    const pass = slice.filter((r) => r.status === 'PASS').length
    return Math.round((pass / slice.length) * 100)
  })

  const W = 100
  const H = 44
  const PAD = 2
  const n = rates.length
  const x = (i: number) => (n === 1 ? W - PAD : PAD + (i / (n - 1)) * (W - 2 * PAD))
  const y = (rate: number) => H - PAD - (rate / 100) * (H - 2 * PAD)

  const line = rates.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(r).toFixed(2)}`).join(' ')
  const area = `${line} L${x(n - 1).toFixed(2)},${H - PAD} L${x(0).toFixed(2)},${H - PAD} Z`
  const REF = 80 // dashed reference line at 80%
  const latest = rates[rates.length - 1] ?? 0
  const overallPass = runs.filter((r) => r.status === 'PASS').length
  const overall = Math.round((overallPass / n) * 100)
  const fails = runs.map((r, i) => ({ r, i })).filter(({ r }) => r.status === 'FAIL')

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] uppercase text-muted-foreground">
          Rolling {WINDOW}-run pass rate
        </p>
        <p className="text-[10px] text-muted-foreground tabular-nums">
          latest{' '}
          <span
            className={cn(
              'font-bold',
              latest >= 80
                ? 'text-emerald-600 dark:text-emerald-400'
                : latest >= 50
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-red-600 dark:text-red-400',
            )}
          >
            {latest}%
          </span>{' '}
          · all-time {overall}% ({overallPass}/{n})
        </p>
      </div>
      <div className="rounded-lg border bg-muted/20 px-2 pt-2 pb-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full h-[72px]"
          role="img"
          aria-label={`Rolling ${WINDOW}-run pass rate: latest ${latest}%, all-time ${overall}%`}
        >
          {/* 80% dashed reference */}
          <line
            x1={0}
            x2={W}
            y1={y(REF)}
            y2={y(REF)}
            stroke="currentColor"
            className="text-muted-foreground/50"
            strokeWidth={0.5}
            strokeDasharray="2 2"
          />
          {/* area + line */}
          <path d={area} fill="currentColor" className="text-emerald-500/15 dark:text-emerald-400/15" />
          <path
            d={line}
            fill="none"
            stroke="currentColor"
            className={latest >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}
            strokeWidth={1.2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {/* FAIL ticks on the baseline */}
          {fails.map(({ r, i }) => (
            <line
              key={`fail-${r.checkId}`}
              x1={x(i)}
              x2={x(i)}
              y1={H - PAD}
              y2={H - PAD - 5}
              stroke="currentColor"
              className="text-red-500 dark:text-red-400"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            >
              <title>{`${r.businessDate} · ${r.batchId} · FAIL${r.actualValue ? ` · actual: ${r.actualValue}` : ''}`}</title>
            </line>
          ))}
          {/* latest point marker */}
          <circle
            cx={x(n - 1)}
            cy={y(latest)}
            r={1.6}
            fill="currentColor"
            className={latest >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}
          >
            <title>{`latest rolling rate: ${latest}%`}</title>
          </circle>
        </svg>
        <div className="flex items-center justify-between mt-0.5 mb-1 text-[9px] text-muted-foreground tabular-nums">
          <span>{runs[0]?.businessDate}</span>
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 border-t border-dashed border-muted-foreground/60" />
              80% ref
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-1.5 h-2 bg-red-500 dark:bg-red-400 rounded-[1px]" />
              fail
            </span>
          </span>
          <span>{runs[n - 1]?.businessDate}</span>
        </div>
      </div>
    </div>
  )
}

function DqCheckDetailSheet({
  checkName,
  onClose,
  onViewRunbook,
}: {
  checkName: string | null
  onClose: () => void
  onViewRunbook: (file: string) => void
}) {
  const [detail, setDetail] = useState<DqCheckDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async (name: string) => {
    setLoading(true)
    try {
      // Fetch up to 50 executions; the table shows 8 by default with a
      // "show all" toggle, and the status ribbon renders every fetched run.
      const res = await fetch(
        `/api/dq/checks?checkName=${encodeURIComponent(name)}&limit=50`,
      )
      if (res.ok) setDetail((await res.json()) as DqCheckDetail)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (checkName) {
      setDetail(null)
      setShowAll(false)
      void load(checkName)
    } else {
      setDetail(null)
    }
  }, [checkName, load])

  return (
    <Sheet open={checkName !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        {loading || !detail ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <SheetTitle className="sr-only">Loading check details</SheetTitle>
            <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
            <p className="text-sm text-muted-foreground">Loading rule + recent history…</p>
          </div>
        ) : (
          <>
            <SheetHeader className="px-4">
              <SheetTitle className="text-sm font-mono break-all flex items-center gap-2">
                {detail.checkName}
              </SheetTitle>
              <SheetDescription className="text-xs">
                DQ rule · {detail.rule?.category ?? 'n/a'} · {detail.rule?.severity ?? 'n/a'} severity
              </SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6 space-y-4 text-xs">
              {/* rule chips */}
              <div className="flex flex-wrap items-center gap-2">
                {detail.rule ? <Chip tone="zinc">{detail.rule.category}</Chip> : null}
                {detail.rule ? <DqSeverityChip severity={detail.rule.severity} /> : null}
                {detail.rule?.incidentType ? (
                  <Chip tone="violet">raises {detail.rule.incidentType.replace(/_/g, ' ')}</Chip>
                ) : null}
                {detail.rule?.createIncident ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-violet-600 dark:text-violet-400 font-medium">
                    auto-incident on fail
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">no auto-incident</span>
                )}
              </div>

              {/* description */}
              <div>
                <p className="text-[10px] uppercase text-muted-foreground mb-1">What this check validates</p>
                <p className="text-xs leading-relaxed rounded-lg border bg-muted/30 p-3">{detail.description}</p>
              </div>

              {/* trend */}
              <div className="grid grid-cols-4 gap-2">
                <div className="rounded border p-2 text-center">
                  <p className="text-[10px] uppercase text-muted-foreground">Examined</p>
                  <p className="font-bold tabular-nums">{detail.trend.examined}</p>
                </div>
                <div className="rounded border p-2 text-center">
                  <p className="text-[10px] uppercase text-muted-foreground">Pass</p>
                  <p className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{detail.trend.pass}</p>
                </div>
                <div className="rounded border p-2 text-center">
                  <p className="text-[10px] uppercase text-muted-foreground">Fail</p>
                  <p className="font-bold tabular-nums text-red-600 dark:text-red-400">{detail.trend.fail}</p>
                </div>
                <div className="rounded border p-2 text-center">
                  <p className="text-[10px] uppercase text-muted-foreground">Warn</p>
                  <p className="font-bold tabular-nums text-amber-600 dark:text-amber-400">{detail.trend.warn}</p>
                </div>
              </div>

              {/* rolling pass-rate trend mini-chart (pure SVG sparkline) */}
              {detail.recent.length >= 2 ? <RollingPassRateChart recent={detail.recent} /> : null}

              {/* execution status ribbon — one bar per execution, oldest → newest */}
              {detail.recent.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] uppercase text-muted-foreground">
                      Execution ribbon (oldest → newest)
                    </p>
                    <p className="text-[10px] text-muted-foreground tabular-nums">
                      {detail.recent.length} run{detail.recent.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 px-2 py-2.5">
                    <div className="flex items-end gap-[3px] h-10">
                      {[...detail.recent]
                        .reverse()
                        .map((r) => (
                          <div
                            key={r.checkId}
                            className={cn(
                              'flex-1 min-w-[4px] rounded-sm transition-all',
                              r.status === 'PASS'
                                ? 'bg-emerald-500 dark:bg-emerald-400 h-3/5'
                                : r.status === 'FAIL'
                                  ? 'bg-red-500 dark:bg-red-400 h-full'
                                  : r.status === 'WARN'
                                    ? 'bg-amber-500 dark:bg-amber-400 h-4/5'
                                    : 'bg-zinc-400 dark:bg-zinc-600 h-2/5',
                            )}
                            title={`${r.businessDate} · ${r.batchId} · ${r.status}${
                              r.actualValue ? ` · actual: ${r.actualValue}` : ''
                            }`}
                          />
                        ))}
                    </div>
                    <div className="flex items-center justify-between mt-1.5 text-[9px] text-muted-foreground tabular-nums">
                      <span>{[...detail.recent].reverse()[0]?.businessDate}</span>
                      <span>newest →</span>
                      <span>{detail.recent[0]?.businessDate}</span>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* runbook deep-link */}
              {detail.runbook ? (
                <>
                  <Separator />
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground mb-1">Runbook</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full h-8 text-xs justify-start"
                      onClick={() => onViewRunbook(detail.runbook!.file)}
                    >
                      <BookOpen className="h-3.5 w-3.5 text-emerald-600" />
                      <Mono className="font-semibold">{detail.runbook.id}</Mono>
                      <span className="truncate">{detail.runbook.title}</span>
                      <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
                    </Button>
                  </div>
                </>
              ) : null}

              {/* recent execution history */}
              <Separator />
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] uppercase text-muted-foreground">
                    Recent execution history
                    <span className="normal-case font-normal">
                      {' '}
                      (showing {showAll ? detail.recent.length : Math.min(8, detail.recent.length)} of{' '}
                      {detail.recent.length})
                    </span>
                  </p>
                  {detail.recent.length > 8 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => setShowAll((v) => !v)}
                    >
                      {showAll ? 'Show latest 8' : `Show all ${detail.recent.length}`}
                    </Button>
                  ) : null}
                </div>
                {detail.recent.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No executions recorded yet.</p>
                ) : (
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-[10px]">
                      <thead className="bg-muted/60">
                        <tr>
                          <th className="text-left font-semibold uppercase tracking-wider px-2 py-1.5">Batch</th>
                          <th className="text-left font-semibold uppercase tracking-wider px-2 py-1.5">Status</th>
                          <th className="text-left font-semibold uppercase tracking-wider px-2 py-1.5">Expected</th>
                          <th className="text-left font-semibold uppercase tracking-wider px-2 py-1.5">Actual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(showAll ? detail.recent : detail.recent.slice(0, 8)).map((r) => (
                          <tr key={r.checkId} className="border-t">
                            <td className="px-2 py-1.5 font-mono align-top">
                              {r.batchId}
                              <span className="block text-muted-foreground">{r.businessDate}</span>
                            </td>
                            <td className="px-2 py-1.5 align-top">
                              <CheckStatusChip status={r.status} />
                            </td>
                            <td className="px-2 py-1.5 font-mono align-top break-all max-w-[110px]">{r.expectedValue ?? '-'}</td>
                            <td className="px-2 py-1.5 font-mono align-top break-all max-w-[110px]">{r.actualValue ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {detail.recent[0]?.errorDetails ? (
                  <div className="mt-2">
                    <p className="text-[10px] uppercase text-muted-foreground mb-1">Latest error detail</p>
                    <pre className="whitespace-pre-wrap break-words rounded border bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 p-2 font-mono text-[10px]">
                      {detail.recent[0].errorDetails}
                    </pre>
                  </div>
                ) : null}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

export function DataQualityTab({
  state,
  onViewRunbook,
}: {
  state: DashboardState
  onViewRunbook: (file: string) => void
}) {
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [checkFilter, setCheckFilter] = useState('ALL')
  const [detailCheckName, setDetailCheckName] = useState<string | null>(null)

  const checkNames = useMemo(
    () => [...new Set(state.dq.latest.map((c) => c.checkName))].sort(),
    [state.dq.latest],
  )

  const filtered = state.dq.latest.filter(
    (c) =>
      (statusFilter === 'ALL' || c.status === statusFilter) &&
      (checkFilter === 'ALL' || c.checkName === checkFilter),
  )

  const passRate =
    state.dq.summary.executed > 0
      ? Math.round((state.dq.summary.passed / state.dq.summary.executed) * 100)
      : 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <MetricCard
          label="Checks (14d)"
          value={state.dq.summary.executed}
          sub="executed"
          tone="teal"
        />
        <MetricCard
          label="Passed"
          value={state.dq.summary.passed}
          sub={`${passRate}% pass rate`}
          tone="green"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <MetricCard
          label="Failed"
          value={state.dq.summary.failed}
          sub="raise incidents per YAML mapping"
          tone="red"
          icon={<CircleX className="h-4 w-4" />}
        />
        <MetricCard
          label="Warnings"
          value={state.dq.summary.warn}
          sub="advisory"
          tone="amber"
          icon={<TriangleAlert className="h-4 w-4" />}
        />
        <MetricCard
          label="Rejection threshold"
          value={`${state.config.rejectedThresholdPct}%`}
          sub="per batch (settings.yaml)"
          tone="violet"
        />
        <MetricCard
          label="Check catalogue"
          value={state.dq.checksSummary.length}
          sub="configured in data_quality_rules.yaml"
          tone="zinc"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-0 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">Validation failures trend (14 days)</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2">
            <DqTrendChart data={state.dailyTrend} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-0 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">Failures by severity (14d)</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-2">
            {state.dq.failsBySeverity.length === 0 ? (
              <EmptyState title="No failures recorded" hint="All configured checks are passing." />
            ) : (
              <ul className="space-y-2">
                {state.dq.failsBySeverity.map((s) => (
                  <li key={s.severity} className="flex items-center justify-between gap-3">
                    <DqSeverityChip severity={s.severity} />
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          s.severity === 'CRITICAL'
                            ? 'bg-red-500'
                            : s.severity === 'HIGH'
                              ? 'bg-orange-500'
                              : s.severity === 'MEDIUM'
                                ? 'bg-amber-500'
                                : 'bg-teal-500',
                        )}
                        style={{
                          width: `${Math.max(6, (s.count / Math.max(...state.dq.failsBySeverity.map((x) => x.count))) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm font-bold tabular-nums w-10 text-right">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---- per-check summary ---- */}
      <div>
        <SectionHeader
          title="Check catalogue performance (14 days)"
          description="Every configured check from config/data_quality_rules.yaml with pass / fail / warn counts — click a row to open the rule + recent history drawer"
        />
        <TableShell className="max-h-72">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Check</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Category</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Pass</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Fail</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Warn</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Reliability</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.dq.checksSummary.map((c) => {
                const total = c.pass + c.fail + c.warn
                const pct = total > 0 ? Math.round((c.pass / total) * 100) : 0
                return (
                  <TableRow
                    key={c.checkName}
                    className="cursor-pointer"
                    onClick={() => setDetailCheckName(c.checkName)}
                    title={`Open ${c.checkName} rule + recent history`}
                  >
                    <TableCell className="font-mono text-[11px]">{c.checkName}</TableCell>
                    <TableCell>
                      <Chip tone="zinc">{c.category}</Chip>
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                      {c.pass}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums text-red-600 dark:text-red-400">
                      {c.fail}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums text-amber-600 dark:text-amber-400">
                      {c.warn === 0 ? <span className="italic opacity-40">0</span> : c.warn}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground tabular-nums font-semibold">{pct}%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <div className="border-t bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground tabular-nums">
            showing {state.dq.checksSummary.length} of {state.dq.checksSummary.length} configured checks · scroll for more
          </div>
        </TableShell>
      </div>
      <div>
        <SectionHeader
          title="Check results (dq_check_results)"
          description="Latest executed checks with expected vs actual values and error details"
          right={
            <div className="flex flex-wrap gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 w-[120px] text-xs">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="PASS">PASS</SelectItem>
                  <SelectItem value="FAIL">FAIL</SelectItem>
                  <SelectItem value="WARN">WARN</SelectItem>
                </SelectContent>
              </Select>
              <Select value={checkFilter} onValueChange={setCheckFilter}>
                <SelectTrigger className="h-8 w-[240px] text-xs">
                  <SelectValue placeholder="Check" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All checks</SelectItem>
                  {checkNames.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />
        {filtered.length === 0 ? (
          <EmptyState title="No check results match the filters" />
        ) : (
          <TableShell>
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Check</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Severity</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Table / column</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Expected</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Actual</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Batch</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Executed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow
                    key={c.checkId}
                    className={cn(
                      'cursor-pointer',
                      c.status === 'FAIL' ? 'bg-red-50/50 dark:bg-red-950/20' : '',
                    )}
                    onClick={() => setDetailCheckName(c.checkName)}
                    title={`Open ${c.checkName} rule + recent history`}
                  >
                    <TableCell className="font-mono text-[11px]">{c.checkName}</TableCell>
                    <TableCell>
                      <CheckStatusChip status={c.status} />
                    </TableCell>
                    <TableCell>
                      <DqSeverityChip severity={c.severity} />
                    </TableCell>
                    <TableCell className="text-[11px] max-w-[200px] truncate" title={`${c.tableName ?? ''} ${c.columnName ?? ''}`}>
                      {c.tableName ?? '-'}
                      {c.columnName ? <span className="text-muted-foreground"> · {c.columnName}</span> : null}
                    </TableCell>
                    <TableCell className="text-[11px] max-w-[140px] truncate" title={c.expectedValue ?? undefined}>
                      {c.expectedValue ?? '-'}
                    </TableCell>
                    <TableCell className="text-[11px] max-w-[140px] truncate" title={c.actualValue ?? undefined}>
                      {c.actualValue ?? '-'}
                    </TableCell>
                    <TableCell className="font-mono text-[10px]">{c.batchId}</TableCell>
                    <TableCell className="text-[11px] whitespace-nowrap">{fmtTime(c.executedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableShell>
        )}
      </div>

      {/* ---- DQ check detail drawer (rule + recent history) ---- */}
      <DqCheckDetailSheet
        checkName={detailCheckName}
        onClose={() => setDetailCheckName(null)}
        onViewRunbook={onViewRunbook}
      />
    </div>
  )
}
