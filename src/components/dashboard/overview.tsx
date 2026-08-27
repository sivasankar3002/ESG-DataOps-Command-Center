'use client'

// =====================================================================
// Tab: Overview — pipeline health, SLA, 24h metrics, trends, alerts, and
// a shift handover generator for the incoming on-call engineer.
// =====================================================================

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, FileWarning, NotebookPen, ShieldAlert, Timer, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DashboardState } from '@/lib/esg/dashboard'
import { DqTrendChart, IncidentsDonut, RunsByDayChart } from './charts'
import { IncidentTimelineStrip } from './incident-timeline'
import { ShiftHandoverDialog } from './shift-handover'
import {
  Chip,
  EmptyState,
  HealthChip,
  MetricCard,
  SectionHeader,
  fmtAge,
  fmtTime,
} from './shared'

export function OverviewTab({
  state,
  onOpenIncident,
  onAcknowledgeAlert,
  can,
}: {
  state: DashboardState
  onOpenIncident: (id: string) => void
  onAcknowledgeAlert: (alertId: number) => void
  /** RBAC capability check — acknowledging alerts is L1+ only. */
  can: (capability: import('@/lib/esg/roles').Capability) => boolean
}) {
  const [handoverOpen, setHandoverOpen] = useState(false)
  const h = state.health
  const o = state.overview
  const healthTone =
    h.status === 'GREEN'
      ? 'border-emerald-500/60 bg-emerald-50 dark:bg-emerald-950/40'
      : h.status === 'AMBER'
        ? 'border-amber-500/60 bg-amber-50 dark:bg-amber-950/40'
        : h.status === 'RED'
          ? 'border-red-500/60 bg-red-50 dark:bg-red-950/40'
          : 'border-zinc-300 bg-zinc-50 dark:bg-zinc-900/40'

  const openBySeverity = o.openBySeverity
  const donutData = [
    { name: 'P1', value: openBySeverity.P1 },
    { name: 'P2', value: openBySeverity.P2 },
    { name: 'P3', value: openBySeverity.P3 },
    { name: 'P4', value: openBySeverity.P4 },
  ].filter((d) => d.value > 0)

  const slaTone =
    h.sla.status === 'OK'
      ? 'green'
      : h.sla.status === 'PENDING'
        ? 'amber'
        : h.sla.status === 'BREACHED'
          ? 'red'
          : 'zinc'

  const recentIncidents = state.incidents.slice(0, 6)
  const recentAlerts = state.alerts.slice(0, 8)

  // ---- day-over-day deltas (last trend day vs the day before) ------------
  const t = state.dailyTrend
  const last = t[t.length - 1]
  const prev = t[t.length - 2]
  const delta = (pick: (d: DashboardState['dailyTrend'][number]) => number) =>
    last && prev ? pick(last) - pick(prev) : undefined
  const jobsDelta = delta((d) => d.jobsSuccess + d.jobsFailed)
  const incidentsDelta = delta((d) => d.incidents)
  const filesDelta = delta((d) => d.filesReceived)
  const dqFailDelta = delta((d) => d.dqFail)

  return (
    <div className="space-y-5">
      {/* ---- health banner (VLM: increased padding, right-aligned last-load timestamp) ---- */}
      <div className={cn('rounded-lg border p-5', healthTone)}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-3">
            {h.status === 'GREEN' ? (
              <CheckCircle2 className="h-9 w-9 text-emerald-600" />
            ) : h.status === 'AMBER' ? (
              <AlertTriangle className="h-9 w-9 text-amber-600" />
            ) : h.status === 'RED' ? (
              <XCircle className="h-9 w-9 text-red-600" />
            ) : (
              <ShieldAlert className="h-9 w-9 text-zinc-500" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                  Pipeline health
                </p>
                <HealthChip status={h.status} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {h.reasons.join(' · ')}
              </p>
            </div>
          </div>
          <div className="h-9 w-px bg-border hidden sm:block" />
          <div className="flex items-center gap-2 text-xs">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">SLA status:</span>
            <Chip tone={slaTone}>{h.sla.status.replace('_', ' ')}</Chip>
            <span className="text-muted-foreground">{h.sla.text}</span>
          </div>
          <div className="flex items-center gap-2 text-xs sm:ml-auto">
            <Timer className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Last successful load:</span>
            <span className="font-medium tabular-nums">{o.lastSuccessfulLoad ?? 'never'}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950"
            onClick={() => setHandoverOpen(true)}
            title="Generate a shift handover document (markdown) for the incoming on-call shift"
          >
            <NotebookPen className="h-3.5 w-3.5 text-emerald-600" />
            Generate shift handover
          </Button>
        </div>
      </div>

      {/* ---- AI-assisted shift handover dialog ---- */}
      <ShiftHandoverDialog open={handoverOpen} onOpenChange={setHandoverOpen} />

      {/* ---- metric cards ---- */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <MetricCard
          label="Jobs (24h)"
          value={o.jobs24h.total}
          sub={`${o.jobs24h.success} ok · ${o.jobs24h.failed} failed · ${o.jobs24h.skipped} skipped`}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone={o.jobs24h.failed > 0 ? 'red' : 'green'}
          delta={jobsDelta !== undefined ? { value: jobsDelta, label: 'vs prev day' } : undefined}
        />
        <MetricCard
          label="Active incidents"
          value={o.activeIncidents}
          sub={`${o.openBySeverity.P1} P1 · ${o.openBySeverity.P2} P2 · ${o.openBySeverity.P3} P3`}
          icon={<ShieldAlert className="h-4 w-4" />}
          tone={o.openBySeverity.P1 + o.openBySeverity.P2 > 0 ? 'red' : o.activeIncidents > 0 ? 'amber' : 'green'}
          delta={incidentsDelta !== undefined ? { value: incidentsDelta, goodWhenDown: true, label: 'vs prev day' } : undefined}
        />
        <MetricCard
          label="Files (24h)"
          value={o.files24h.received}
          sub={`${o.files24h.processed} processed · ${o.files24h.quarantined} quarantined`}
          icon={<FileWarning className="h-4 w-4" />}
          tone={o.files24h.quarantined > 0 ? 'amber' : 'green'}
          delta={filesDelta !== undefined ? { value: filesDelta, label: 'vs prev day' } : undefined}
        />
        <MetricCard
          label="DQ checks (14d)"
          value={state.dq.summary.executed}
          sub={`${state.dq.summary.passed} pass · ${state.dq.summary.failed} fail · ${state.dq.summary.warn} warn`}
          tone={state.dq.summary.failed > 0 ? 'amber' : 'green'}
          delta={dqFailDelta !== undefined ? { value: dqFailDelta, goodWhenDown: true, label: 'failures vs prev day' } : undefined}
        />
        <MetricCard
          label="Sites tracked"
          value={o.sitesTracked}
          sub={`${o.warehouseRows.toLocaleString()} fact rows`}
          tone="teal"
        />
        <MetricCard
          label="Last batch"
          value={h.lastBatchId ? h.lastBatchId.replace(/^B-(\d{4})(\d{2})(\d{2})-/, '$1-$2-$3 #') : '-'}
          sub={h.lastBatchId ? `DAG ${state.config.dagId}` : 'no runs yet'}
          tone="violet"
          valueClassName="text-base font-mono"
        />
      </div>

      {/* ---- incident & pipeline timeline strip ---- */}
      <IncidentTimelineStrip state={state} onOpenIncident={onOpenIncident} />

      {/* ---- charts ---- */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-0 pt-4 px-4">
            <CardTitle className="text-sm font-medium">Pipeline runs — last {state.config.trendDays} days</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2">
            <RunsByDayChart data={state.dailyTrend} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-0 pt-4 px-4">
            <CardTitle className="text-sm font-medium">Open incidents by severity</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2">
            <IncidentsDonut data={donutData} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-0 pt-4 px-4">
            <CardTitle className="text-sm font-medium">Data quality trend — checks passed vs failed</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2">
            <DqTrendChart data={state.dailyTrend} />
          </CardContent>
        </Card>

        {/* ---- recent alerts ---- */}
        <Card>
          <CardHeader className="pb-0 pt-4 px-4">
            <CardTitle className="text-sm font-medium">Recent alerts</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            {recentAlerts.length === 0 ? (
              <EmptyState title="No alerts recorded" hint="Alerts appear when checks fail or incidents escalate." />
            ) : (
              <ul className="divide-y divide-border max-h-[240px] overflow-y-auto">
                {recentAlerts.map((a) => (
                  <li key={a.alertId} className="py-2 flex items-start gap-2">
                    <Chip tone={a.severity === 'P1' || a.severity === 'CRITICAL' ? 'red' : a.severity === 'P2' || a.severity === 'HIGH' ? 'orange' : 'amber'}>
                      {a.alertType.replace(/_/g, ' ')}
                    </Chip>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs leading-snug line-clamp-2" title={a.message}>
                        {a.message}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {fmtTime(a.createdAt)} · via {a.channels}
                        {a.acknowledgedFlag ? ' · acknowledged' : ''}
                      </p>
                    </div>
                    {!a.acknowledgedFlag ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px] hover:bg-emerald-100 dark:hover:bg-emerald-950"
                        disabled={!can('alerts.ack')}
                        title={can('alerts.ack') ? undefined : 'Requires L1 Operator role or higher'}
                        onClick={() => onAcknowledgeAlert(a.alertId)}
                      >
                        Ack
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---- recent incidents ---- */}
      <div>
        <SectionHeader
          title="Latest incidents"
          description="Most recent incidents across all pipelines — click to open the incident record"
        />
        {recentIncidents.length === 0 ? (
          <EmptyState title="No incidents recorded" hint="Run a failure simulation from the Control Room to see incident management in action." />
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {recentIncidents.map((i) => (
              <li key={i.incidentId}>
                <button
                  onClick={() => onOpenIncident(i.incidentId)}
                  className="w-full text-left rounded-lg border bg-card p-3 hover:border-emerald-400/60 hover:shadow-sm transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{i.incidentId}</span>
                    <Chip tone={i.severity === 'P1' ? 'red' : i.severity === 'P2' ? 'orange' : 'amber'}>{i.severity}</Chip>
                    <Chip tone="zinc">{i.status.replace('_', ' ')}</Chip>
                    {i.escalatedFlag ? <Chip tone="violet">ESCALATED</Chip> : null}
                    <span className="ml-auto text-[10px] text-muted-foreground">{fmtAge(i.ageMinutes)} old</span>
                  </div>
                  <p className="text-xs mt-1.5 line-clamp-2 text-muted-foreground">{i.shortDescription}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
