'use client'

// =====================================================================
// ESG DataOps Command Center — Tab: Alerts Console
// The alert_log feed with L1 on-call workflow: severity/type/ack filters,
// per-alert acknowledge, bulk acknowledge (shift handover) and the
// simulated channel-routing matrix (console / email_stub / webhook_stub —
// standing in for CloudWatch alarms + SNS/Slack/PagerDuty).
// =====================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, BellRing, Check, CheckCheck, Cloud, CloudOff, Loader2, Mail, Radio, Terminal, Webhook } from 'lucide-react'
import { toast } from 'sonner'
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
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import type { DashboardState } from '@/lib/esg/dashboard'
import {
  Chip,
  EmptyState,
  MetricCard,
  SectionHeader,
  TableShell,
  fmtTime,
} from './shared'

const CHANNEL_META: Record<string, { label: string; description: string; icon: React.ReactNode }> = {
  console: {
    label: 'console',
    description: 'Structured line written to logs/alert_channels.log — the CloudWatch Logs stand-in.',
    icon: <Terminal className="h-3.5 w-3.5" />,
  },
  email_stub: {
    label: 'email_stub',
    description: 'SES/email stub — message rendered to the on-call mailbox file, nothing sent.',
    icon: <Mail className="h-3.5 w-3.5" />,
  },
  webhook_stub: {
    label: 'webhook_stub',
    description: 'Slack/PagerDuty-style webhook stub — JSON payload logged, no external call.',
    icon: <Webhook className="h-3.5 w-3.5" />,
  },
}

// ---- per-user alert subscription preferences --------------------------
// Hydrated from the server-side preference store (UserPreference via
// /api/prefs) with localStorage as the offline fallback, and written
// through to both on every change. The production stand-in for
// PagerDuty/SNS per-user notification rules that follow the operator
// across browsers and machines.
const SUBS_KEY = 'esg.alert.subscriptions.v1'
const SUBS_PREF = 'alert.subscriptions'
const ALL_ALERT_TYPES = [
  'PIPELINE_COMPLETED',
  'FILE_MISSING',
  'CHECKSUM_MISMATCH',
  'SCHEMA_DRIFT',
  'LOAD_FAILURE',
  'SLA_BREACH',
  'FRESHNESS_FAILURE',
  'RECONCILIATION_MISMATCH',
  'INCIDENT_ESCALATED',
]
const ALL_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']

interface Subscriptions {
  types: Record<string, boolean>
  severities: Record<string, boolean>
}

function backfillSubscriptions(parsed: Subscriptions): Subscriptions {
  const next: Subscriptions = {
    types: { ...(parsed.types ?? {}) },
    severities: { ...(parsed.severities ?? {}) },
  }
  // Backfill any missing keys (e.g. if a new alert type ships later)
  for (const t of ALL_ALERT_TYPES) {
    if (next.types[t] === undefined) next.types[t] = true
  }
  for (const s of ALL_SEVERITIES) {
    if (next.severities[s] === undefined) next.severities[s] = true
  }
  return next
}

function loadSubscriptions(): Subscriptions {
  if (typeof window === 'undefined') {
    return {
      types: Object.fromEntries(ALL_ALERT_TYPES.map((t) => [t, true])),
      severities: Object.fromEntries(ALL_SEVERITIES.map((s) => [s, true])),
    }
  }
  try {
    const raw = window.localStorage.getItem(SUBS_KEY)
    if (raw) {
      return backfillSubscriptions(JSON.parse(raw) as Subscriptions)
    }
  } catch {
    // fall through to defaults
  }
  return {
    types: Object.fromEntries(ALL_ALERT_TYPES.map((t) => [t, true])),
    severities: Object.fromEntries(ALL_SEVERITIES.map((s) => [s, true])),
  }
}

export function AlertsConsoleTab({
  state,
  onAcknowledgeAlert,
  refresh,
  can,
}: {
  state: DashboardState
  onAcknowledgeAlert: (alertId: number) => void
  refresh: () => void
  /** RBAC capability check — ack is L1+, subscriptions editor is L1+. */
  can: (capability: import('@/lib/esg/roles').Capability) => boolean
}) {
  const [severityFilter, setSeverityFilter] = useState('ALL')
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [ackFilter, setAckFilter] = useState('ALL')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [subs, setSubs] = useState<Subscriptions>(() => loadSubscriptions())
  const [subsOpen, setSubsOpen] = useState(false)
  // Where the prefs currently live: 'loading' until the first server
  // round-trip resolves, then 'synced' (server store reachable) or
  // 'local' (offline fallback — localStorage only).
  const [syncStatus, setSyncStatus] = useState<'loading' | 'synced' | 'local'>('loading')
  const subsTouched = useRef(false)
  const subsAtMount = useRef<Subscriptions | null>(null)
  if (subsAtMount.current === null) subsAtMount.current = subs

  // Hydrate once from the server-side preference store. If the operator
  // toggled something before the round-trip lands, their in-flight choice
  // wins (no clobbering).
  useEffect(() => {
    let cancelled = false
    fetch(`/api/prefs?key=${SUBS_PREF}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`)
        return (await res.json()) as { value: Subscriptions | null }
      })
      .then((json) => {
        if (cancelled) return
        if (json.value && !subsTouched.current) {
          setSubs(backfillSubscriptions(json.value))
        } else if (!json.value && subsAtMount.current) {
          // First run on this machine: seed the server store with the
          // localStorage-derived prefs so they start following the operator.
          void fetch('/api/prefs', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: SUBS_PREF, value: subsAtMount.current }),
          }).catch(() => undefined)
        }
        setSyncStatus('synced')
      })
      .catch(() => {
        if (!cancelled) setSyncStatus('local')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Persist subscriptions whenever they change: localStorage mirror
  // (offline fallback) + write-through to the server preference store.
  // The mount pass is skipped — hydration above decides what to push.
  const firstSubsPass = useRef(true)
  useEffect(() => {
    if (firstSubsPass.current) {
      firstSubsPass.current = false
      return
    }
    subsTouched.current = true
    try {
      window.localStorage.setItem(SUBS_KEY, JSON.stringify(subs))
    } catch {
      // localStorage might be unavailable (private mode); fail silently.
    }
    void fetch('/api/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: SUBS_PREF, value: subs }),
    })
      .then((res) => setSyncStatus(res.ok ? 'synced' : 'local'))
      .catch(() => setSyncStatus('local'))
  }, [subs])

  const alerts = state.alerts
  const alertTypes = useMemo(() => [...new Set(alerts.map((a) => a.alertType))].sort(), [alerts])

  const filtered = alerts.filter(
    (a) =>
      (severityFilter === 'ALL' || a.severity === severityFilter) &&
      (typeFilter === 'ALL' || a.alertType === typeFilter) &&
      (ackFilter === 'ALL' ||
        (ackFilter === 'UNACKED' && !a.acknowledgedFlag) ||
        (ackFilter === 'ACKED' && a.acknowledgedFlag)),
  )

  // ---- per-user "what my prefs would hide" preview ----
  const subsHideCount = useMemo(
    () =>
      alerts.filter((a) => {
        const typeOk = subs.types[a.alertType] ?? false
        const sevOk = subs.severities[a.severity] ?? false
        return !(typeOk && sevOk)
      }).length,
    [alerts, subs],
  )

  const unacked = alerts.filter((a) => !a.acknowledgedFlag).length
  const critical = alerts.filter((a) => a.severity === 'CRITICAL' || a.severity === 'P1').length
  const high = alerts.filter((a) => a.severity === 'HIGH' || a.severity === 'P2').length
  const ackRate = alerts.length > 0 ? Math.round(((alerts.length - unacked) / alerts.length) * 100) : 100

  const ackAll = async () => {
    if (unacked === 0) {
      toast.info('No unacknowledged alerts')
      return
    }
    setBulkBusy(true)
    try {
      const res = await fetch('/api/alerts/ack-all', { method: 'POST' })
      if (res.ok) {
        const body = (await res.json()) as { count: number }
        toast.success(`${body.count} alert(s) acknowledged — clean handover`)
        refresh()
      } else {
        toast.error('Bulk acknowledge failed')
      }
    } finally {
      setBulkBusy(false)
    }
  }

  const toggleType = (t: string, checked: boolean) => {
    setSubs((prev) => ({ ...prev, types: { ...prev.types, [t]: checked } }))
  }
  const toggleSeverity = (s: string, checked: boolean) => {
    setSubs((prev) => ({ ...prev, severities: { ...prev.severities, [s]: checked } }))
  }
  const setAllTypes = (checked: boolean) => {
    setSubs((prev) => ({
      ...prev,
      types: Object.fromEntries(ALL_ALERT_TYPES.map((t) => [t, checked])),
    }))
  }
  const setAllSeverities = (checked: boolean) => {
    setSubs((prev) => ({
      ...prev,
      severities: Object.fromEntries(ALL_SEVERITIES.map((s) => [s, checked])),
    }))
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Alert console"
        description="Every alert dispatched by the pipeline (alert_log), with the simulated channel matrix that stands in for CloudWatch alarms + SNS. Acknowledge individually or bulk-ack at shift handover."
        right={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setSubsOpen((v) => !v)}
              disabled={!can('prefs.edit')}
              title={can('prefs.edit') ? undefined : 'Requires L1 Operator role or higher'}
            >
              <Bell className="h-3.5 w-3.5" />
              {subsOpen ? 'Hide subscriptions' : 'My subscriptions'}
            </Button>
            <Button
              size="sm"
              className="h-8"
              onClick={() => void ackAll()}
              disabled={bulkBusy || unacked === 0 || !can('alerts.ack')}
              title={can('alerts.ack') ? undefined : 'Requires L1 Operator role or higher'}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {bulkBusy ? 'Acknowledging…' : `Ack all (${unacked})`}
            </Button>
          </div>
        }
      />

      {/* ---- stat cards ---- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Alerts in window"
          value={alerts.length}
          sub="most recent dispatches across all channels"
          icon={<Bell className="h-4 w-4" />}
          tone="violet"
        />
        <MetricCard
          label="Unacknowledged"
          value={unacked}
          sub={unacked > 0 ? 'awaiting L1 on-call action' : 'queue is clear'}
          icon={<BellRing className="h-4 w-4" />}
          tone={unacked > 0 ? 'red' : 'green'}
        />
        <MetricCard
          label="Critical / high"
          value={critical + high}
          sub={`${critical} critical · ${high} high severity`}
          icon={<Radio className="h-4 w-4" />}
          tone={critical > 0 ? 'red' : high > 0 ? 'orange' : 'green'}
        />
        <MetricCard
          label="Acknowledge rate"
          value={`${ackRate}%`}
          sub="acknowledged ÷ dispatched in window"
          icon={<CheckCheck className="h-4 w-4" />}
          tone={ackRate === 100 ? 'green' : ackRate >= 80 ? 'amber' : 'orange'}
        />
      </div>

      {/* ---- per-user alert subscription preferences ---- */}
      {subsOpen ? (
        <Card className="border-violet-200 dark:border-violet-900 bg-violet-50/30 dark:bg-violet-950/10">
          <CardHeader className="pb-0 pt-4 px-4">
            <CardTitle className="text-sm font-medium flex flex-wrap items-center gap-2">
              <Bell className="h-4 w-4 text-violet-600" />
              My alert subscriptions
              <span
                className="ml-auto inline-flex items-center gap-1 text-[10px] font-normal"
                title={
                  syncStatus === 'synced'
                    ? 'Preferences are persisted in the server-side preference store (SQLite via Prisma) and follow you across browsers.'
                    : syncStatus === 'local'
                      ? 'Server preference store unreachable — preferences are kept in this browser only (localStorage fallback).'
                      : 'Contacting the server preference store…'
                }
              >
                {syncStatus === 'loading' ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    <span className="text-muted-foreground">syncing…</span>
                  </>
                ) : syncStatus === 'synced' ? (
                  <>
                    <Cloud className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-emerald-700 dark:text-emerald-400">synced to server</span>
                  </>
                ) : (
                  <>
                    <CloudOff className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                    <span className="text-amber-700 dark:text-amber-400">local only</span>
                  </>
                )}
              </span>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Production stand-in for per-user PagerDuty / SNS subscription preferences, persisted in the
              server-side preference store (with a localStorage mirror as the offline fallback) so they
              follow the operator across browsers. Untick a type or severity to model how an on-call
              engineer would opt out of noisy alert streams without touching the central routing config
              (settings.yaml).
            </p>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-3 space-y-3">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>
                Current prefs would hide <span className="font-semibold text-violet-700 dark:text-violet-400">{subsHideCount}</span> of {alerts.length} alerts in the current window.
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-2 text-[10px] ml-auto"
                onClick={() => {
                  setAllTypes(true)
                  setAllSeverities(true)
                  toast.info('All alert subscriptions re-enabled')
                }}
              >
                Reset all
              </Button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Alert types
                  </p>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-5 px-2 text-[10px]" onClick={() => setAllTypes(true)}>
                      All on
                    </Button>
                    <Button variant="ghost" size="sm" className="h-5 px-2 text-[10px]" onClick={() => setAllTypes(false)}>
                      All off
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {ALL_ALERT_TYPES.map((t) => (
                    <label
                      key={t}
                      className="flex items-center gap-2 text-xs rounded border bg-card px-2 py-1.5 cursor-pointer hover:border-violet-300 dark:hover:border-violet-800"
                    >
                      <Checkbox
                        checked={subs.types[t] ?? false}
                        onCheckedChange={(c) => toggleType(t, c === true)}
                      />
                      <span className="font-mono text-[11px]">{t.replace(/_/g, ' ')}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Severities
                  </p>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-5 px-2 text-[10px]" onClick={() => setAllSeverities(true)}>
                      All on
                    </Button>
                    <Button variant="ghost" size="sm" className="h-5 px-2 text-[10px]" onClick={() => setAllSeverities(false)}>
                      All off
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {ALL_SEVERITIES.map((s) => (
                    <label
                      key={s}
                      className="flex items-center gap-2 text-xs rounded border bg-card px-2 py-1.5 cursor-pointer hover:border-violet-300 dark:hover:border-violet-800"
                    >
                      <Checkbox
                        checked={subs.severities[s] ?? false}
                        onCheckedChange={(c) => toggleSeverity(s, c === true)}
                      />
                      <span className="font-mono text-[11px]">{s}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ---- channel routing matrix ---- */}
      <Card>
        <CardHeader className="pb-0 pt-4 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Radio className="h-4 w-4 text-emerald-600" />
            Channel routing (simulated)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Configured in config/settings.yaml → alerts.channels. Every dispatch is fanned out to all
            channels; each stub writes to logs/alert_channels.log on disk (no paid services).
          </p>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {state.config.alertChannels.map((ch) => {
              const meta = CHANNEL_META[ch] ?? {
                label: ch,
                description: 'Custom stub channel configured in settings.yaml.',
                icon: <Radio className="h-3.5 w-3.5" />,
              }
              return (
                <div key={ch} className="rounded-lg border bg-muted/30 px-3 py-2.5" title={meta.description}>
                  <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                    {meta.icon}
                    <p className="text-xs font-semibold font-mono">{meta.label}</p>
                    <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                      active
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-snug line-clamp-2">{meta.description}</p>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* ---- alert feed ---- */}
      <SectionHeader
        title="Alert feed (alert_log)"
        description={`${filtered.length} of ${alerts.length} alerts shown — newest first.`}
        right={
          <div className="flex flex-wrap gap-2">
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All severities</SelectItem>
                <SelectItem value="CRITICAL">CRITICAL</SelectItem>
                <SelectItem value="HIGH">HIGH</SelectItem>
                <SelectItem value="MEDIUM">MEDIUM</SelectItem>
                <SelectItem value="LOW">LOW</SelectItem>
                <SelectItem value="INFO">INFO</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-[190px] text-xs">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All types</SelectItem>
                {alertTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={ackFilter} onValueChange={setAckFilter}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue placeholder="Ack state" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All ack states</SelectItem>
                <SelectItem value="UNACKED">Unacknowledged</SelectItem>
                <SelectItem value="ACKED">Acknowledged</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      {filtered.length === 0 ? (
        <EmptyState
          title="No alerts match the filters"
          hint="Alerts are dispatched when file checks fail, incidents are raised, SLA breaches occur or escalations fire — run a failure simulation to generate some."
        />
      ) : (
        <TableShell className="max-h-[560px]">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Time</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Type</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Severity</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Message</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Batch</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Channels</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Ack</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => {
                const subbed = (subs.types[a.alertType] ?? false) && (subs.severities[a.severity] ?? false)
                return (
                  <TableRow key={a.alertId} className={a.acknowledgedFlag ? 'opacity-70' : ''}>
                    <TableCell className="text-[11px] whitespace-nowrap text-muted-foreground">
                      {fmtTime(a.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Chip
                          tone={
                            a.severity === 'CRITICAL' || a.severity === 'P1'
                              ? 'red'
                              : a.severity === 'HIGH' || a.severity === 'P2'
                                ? 'orange'
                                : a.severity === 'MEDIUM'
                                  ? 'amber'
                                  : 'zinc'
                          }
                        >
                          {a.alertType.replace(/_/g, ' ')}
                        </Chip>
                        {!subbed ? (
                          <span
                            title="Muted by your subscription preferences"
                            className="text-[9px] text-violet-600 dark:text-violet-400 font-medium uppercase tracking-wider"
                          >
                            muted
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-[11px] font-mono">{a.severity}</TableCell>
                    <TableCell className="text-xs max-w-[380px]">
                      <p className="line-clamp-2" title={a.message}>
                        {a.message}
                      </p>
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">{a.batchId ?? '-'}</TableCell>
                    <TableCell className="max-w-[170px]">
                      {/* one tiny chip per channel — wraps instead of truncating
                          (VLM fix: the comma-joined mono string was unreadable) */}
                      <div className="flex flex-wrap gap-1" title={`Dispatched via ${a.channels}`}>
                        {a.channels.split(',').map((ch) => (
                          <span
                            key={ch}
                            className="inline-flex items-center rounded border border-zinc-300 dark:border-zinc-700 bg-muted/60 px-1 py-px font-mono text-[9px] text-muted-foreground leading-none"
                          >
                            {ch.trim()}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {a.acknowledgedFlag ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                          <CheckCheck className="h-3 w-3" /> acked
                        </span>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[10px] hover:bg-emerald-100 dark:hover:bg-emerald-950 hover:border-emerald-400 dark:hover:border-emerald-700"
                          onClick={() => onAcknowledgeAlert(a.alertId)}
                          disabled={!can('alerts.ack')}
                          title={can('alerts.ack') ? undefined : 'Requires L1 Operator role or higher'}
                        >
                          <Check className="h-3 w-3" /> Ack
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableShell>
      )}

      <p className="text-[11px] text-muted-foreground">
        Alert conditions (from settings.yaml): file_missing, checksum_mismatch, schema_drift, load_failure,
        sla_breach, freshness_failure, reconciliation_mismatch — each maps to a runbook in the Runbooks tab.
      </p>
    </div>
  )
}
