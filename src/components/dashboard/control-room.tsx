'use client'

// =====================================================================
// Tab: Control Room — data generator, DAG runner, failure simulations
// The interactive entry point that drives the whole platform demo.
// =====================================================================

import { useMemo, useState } from 'react'
import {
  Bug,
  DatabaseZap,
  Eye,
  FileStack,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { DashboardState } from '@/lib/esg/dashboard'
import { SCENARIO_LABELS, SCENARIOS, type Scenario } from '@/lib/esg/types'
import { requiredRoleLabel, type Capability } from '@/lib/esg/roles'
import { Chip, JobStatusChip, Mono, SectionHeader } from './shared'

const SIMULATIONS: { key: string; label: string; expect: string; tone: 'green' | 'red' | 'amber' }[] = [
  { key: 'success', label: 'simulate_success_run', expect: '0 incidents, all checks pass', tone: 'green' },
  { key: 'missing_file', label: 'simulate_missing_file', expect: 'FILE_MISSING (P2)', tone: 'red' },
  { key: 'empty_file', label: 'simulate_empty_file', expect: 'EMPTY_FILE (P2)', tone: 'red' },
  { key: 'schema_drift', label: 'simulate_schema_drift', expect: 'SCHEMA_DRIFT (P1)', tone: 'red' },
  { key: 'duplicates', label: 'simulate_duplicates', expect: 'DUPLICATE_RECORDS (P3)', tone: 'amber' },
  { key: 'null_values', label: 'simulate_null_values', expect: 'NULL_VALUES (P2)', tone: 'amber' },
  { key: 'checksum_mismatch', label: 'simulate_checksum_mismatch', expect: 'CHECKSUM_MISMATCH (P2)', tone: 'red' },
  { key: 'sla_breach', label: 'simulate_sla_breach', expect: 'SLA_BREACH (P2)', tone: 'red' },
  { key: 'load_failure', label: 'simulate_load_failure', expect: 'LOAD_FAILURE (P1)', tone: 'red' },
  { key: 'row_count_mismatch', label: 'simulate_row_count_mismatch', expect: 'ROW_COUNT_MISMATCH (P2)', tone: 'amber' },
  { key: 'freshness_failure', label: 'simulate_freshness_failure', expect: 'FRESHNESS_FAILURE (P2)', tone: 'amber' },
]

interface PipelineRunResult {
  batchId: string
  businessDate: string
  dagStatus: string
  durationSeconds: number
  tasks: { taskId: string; jobName: string; status: string; durationSeconds: number | null; errorMessage: string | null }[]
  incidents: { incidentId: string; severity: string; incidentType: string }[]
  files: { received: number; validated: number; quarantined: number }
  load: { rowsRead: number; rowsLoaded: number; rowsRejected: number }
  dq: { executed: number; passed: number; failed: number; warn: number }
  report: { reportDate: string; overallHealth: string } | null
}

interface SimulationResult {
  simulation: string
  businessDate: string
  batchId: string
  dagStatus: string
  expectedIncidentType: string | null
  verified: boolean
  incidents: { incidentId: string; severity: string; incidentType: string }[]
  message: string
}

export function ControlRoomTab({
  state,
  refresh,
  onOpenIncident,
  can,
}: {
  state: DashboardState
  refresh: () => void
  onOpenIncident: (id: string) => void
  can: (capability: Capability) => boolean
}) {
  const [genDate, setGenDate] = useState(state.today)
  const [siteCount, setSiteCount] = useState(24)
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<PipelineRunResult | null>(null)
  const [simResult, setSimResult] = useState<SimulationResult | null>(null)
  const [runDate, setRunDate] = useState<string>('today')

  // Business dates available in the landing zone (from file names)
  const incomingDates = useMemo(() => {
    const dates = new Set<string>()
    for (const f of state.incoming) {
      const m = f.fileName.match(/(\d{4}-\d{2}-\d{2})/)
      if (m) dates.add(m[1])
    }
    return [...dates].sort()
  }, [state.incoming])
  const effectiveRunDate = runDate === 'today' ? state.today : runDate

  const toggleScenario = (s: Scenario, checked: boolean) => {
    setScenarios((prev) => (checked ? [...new Set([...prev, s])] : prev.filter((x) => x !== s)))
  }

  const generate = async () => {
    setBusy('datagen')
    try {
      const res = await fetch('/api/datagen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessDate: genDate, scenarios, siteCount }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Generation failed')
        return
      }
      toast.success(json.message as string, { duration: 6000 })
      refresh()
    } catch {
      toast.error('Generation failed')
    } finally {
      setBusy(null)
    }
  }

  const runDag = async () => {
    setBusy('run')
    setRunResult(null)
    try {
      const res = await fetch('/api/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessDate: effectiveRunDate }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Pipeline run failed')
        return
      }
      setRunResult(json as PipelineRunResult)
      toast.success(
        `Batch ${json.batchId} finished — ${json.dagStatus}, ${json.incidents.length} incident(s)`,
        { duration: 5000 },
      )
      refresh()
    } catch {
      toast.error('Pipeline run failed')
    } finally {
      setBusy(null)
    }
  }

  const runSimulation = async (key: string) => {
    setBusy(`sim-${key}`)
    setSimResult(null)
    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: key }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Simulation failed')
        return
      }
      setSimResult(json as SimulationResult)
      if (json.verified) toast.success(json.message as string, { duration: 6000 })
      else toast.warning(json.message as string, { duration: 8000 })
      refresh()
    } catch {
      toast.error('Simulation failed')
    } finally {
      setBusy(null)
    }
  }

  const seed = async () => {
    setBusy('seed')
    try {
      const res = await fetch('/api/seed', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Seeding failed')
        return
      }
      toast.success(json.message as string, { duration: 8000 })
      setRunResult(null)
      setSimResult(null)
      refresh()
    } finally {
      setBusy(null)
    }
  }

  const reset = async () => {
    setBusy('reset')
    try {
      const res = await fetch('/api/reset', { method: 'POST' })
      if (res.ok) {
        toast.success('All operational data wiped')
        setRunResult(null)
        setSimResult(null)
        refresh()
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* ---- read-only role notice (RBAC) ---- */}
      {!can('datagen.generate') ? (
        <div className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-muted/40 dark:bg-muted/20 p-3 text-xs flex items-start gap-2">
          <Eye className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-muted-foreground">
            <span className="font-semibold text-foreground">Read-only role active.</span> Every tab and
            export stays available, but feed generation, DAG runs and simulations are disabled for the
            current operator role. Mutating API routes enforce the same policy server-side (HTTP 403).
          </p>
        </div>
      ) : null}

      {/* ---- demo walkthrough ---- */}
      <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30 p-3 text-xs">
        <p className="font-semibold flex items-center gap-1.5 mb-1">
          <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
          3-step demo walkthrough
        </p>
        <ol className="list-decimal ml-5 space-y-0.5 text-muted-foreground">
          <li>Generate synthetic ESG feeds (optionally with failure scenarios) into the landing zone.</li>
          <li>Run the <Mono>esg_daily_ingestion</Mono> DAG — files are validated, staged, checked, loaded and reconciled.</li>
          <li>Watch the Overview, Incidents, Data Quality and Daily Report tabs update; open an incident for the full ServiceNow-style console with evidence.</li>
        </ol>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* ---- data generator ---- */}
        <Card className="border-l-4 border-l-violet-400/80 dark:border-l-violet-700">
          <CardHeader className="pb-0 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-violet-600" />
              Synthetic data generator
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Writes feeds + manifest sidecars into <Mono>data/incoming</Mono> (simulated SFTP/S3 drop).
            </p>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                  Business date
                </label>
                <Input
                  type="date"
                  value={genDate}
                  onChange={(e) => setGenDate(e.target.value)}
                  className="h-9 w-40 text-xs bg-background"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                  Sites (10-50)
                </label>
                <Input
                  type="number"
                  min={10}
                  max={50}
                  value={siteCount}
                  onChange={(e) => setSiteCount(Math.min(50, Math.max(10, parseInt(e.target.value, 10) || 24)))}
                  className="h-9 w-24 text-xs bg-background"
                />
              </div>
              <Button
                size="sm"
                className="h-9"
                onClick={generate}
                disabled={busy !== null || !can('datagen.generate')}
                title={can('datagen.generate') ? undefined : `Requires ${requiredRoleLabel('datagen.generate')} role or higher (switch from the header profile menu)`}
              >
                {busy === 'datagen' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileStack className="h-3.5 w-3.5" />}
                Generate files
              </Button>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Failure scenarios (applied to the energy feed unless noted)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {SCENARIOS.map((s) => (
                  <label
                    key={s}
                    className={cn(
                      'flex items-start gap-2 text-xs rounded border px-2 py-1.5 cursor-pointer',
                      'hover:bg-muted/60 hover:border-emerald-300 dark:hover:border-emerald-800 transition-colors',
                      scenarios.includes(s) && 'border-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/40',
                    )}
                  >
                    <Checkbox
                      checked={scenarios.includes(s)}
                      onCheckedChange={(checked) => toggleScenario(s, checked === true)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-mono text-[10px] text-foreground/90">{s}</span>
                      <span className="block text-[10px] text-muted-foreground/80 leading-tight">{SCENARIO_LABELS[s]}</span>
                    </span>
                  </label>
                ))}
              </div>
              {scenarios.length > 1 ? (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1.5">
                  Tip: scenarios are applied in order; one per feed is the cleanest demo.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* ---- pipeline execution ---- */}
        <Card className="border-l-4 border-l-emerald-400/80 dark:border-l-emerald-700">
          <CardHeader className="pb-0 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Play className="h-4 w-4 text-emerald-600" />
              Pipeline execution
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Runs the 8-task DAG sequentially: sensor, validation gate, staging, DQ checks, warehouse,
              reconciliation, report, notify.
            </p>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                  Business date to process
                </label>
                <Select value={runDate} onValueChange={setRunDate}>
                  <SelectTrigger className="h-9 w-52 text-xs bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Today ({state.today})</SelectItem>
                    {incomingDates
                      .filter((d) => d !== state.today)
                      .map((d) => (
                        <SelectItem key={d} value={d}>
                          {d} (files in landing zone)
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                className="h-9"
                onClick={runDag}
                disabled={busy !== null || !can('run.dag')}
                title={can('run.dag') ? undefined : `Requires ${requiredRoleLabel('run.dag')} role or higher (switch from the header profile menu)`}
              >
                {busy === 'run' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Run DAG for {effectiveRunDate}
              </Button>
            </div>
            <div className="rounded-lg border bg-muted/40 dark:bg-muted/20 px-3 py-2 text-xs flex items-center gap-2">
              <FileStack className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-semibold tabular-nums text-foreground">{state.incoming.length}</span>
              <span className="text-muted-foreground">file(s) currently in the landing zone</span>
            </div>

            {runResult ? (
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Chip tone={runResult.dagStatus === 'SUCCESS' ? 'green' : 'red'}>{runResult.dagStatus}</Chip>
                  <Mono className="font-semibold">{runResult.batchId}</Mono>
                  <span className="text-muted-foreground">{runResult.durationSeconds.toFixed(1)}s wall time</span>
                  <span className="text-muted-foreground">
                    files {runResult.files.validated} valid / {runResult.files.quarantined} quarantined
                  </span>
                  <span className="text-muted-foreground">
                    rows {runResult.load.rowsLoaded} loaded / {runResult.load.rowsRejected} rejected
                  </span>
                  {runResult.report ? (
                    <Chip tone={runResult.report.overallHealth === 'GREEN' ? 'green' : runResult.report.overallHealth === 'AMBER' ? 'amber' : 'red'}>
                      report {runResult.report.overallHealth}
                    </Chip>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {runResult.tasks.map((t) => (
                    <div key={t.taskId} className="rounded border px-2 py-1.5">
                      <div className="flex items-center justify-between gap-1">
                        <Mono className="text-[9px] truncate" >{t.taskId.replace('_task', '')}</Mono>
                        <JobStatusChip status={t.status} />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {t.durationSeconds !== null ? `${t.durationSeconds.toFixed(1)}s` : '-'}
                        {t.errorMessage ? ' · error' : ''}
                      </p>
                    </div>
                  ))}
                </div>
                {runResult.incidents.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-xs text-muted-foreground">Incidents created:</span>
                    {runResult.incidents.map((i) => (
                      <button key={i.incidentId} onClick={() => onOpenIncident(i.incidentId)}>
                        <Chip tone={i.severity === 'P1' ? 'red' : i.severity === 'P2' ? 'orange' : 'amber'}>
                          {i.incidentId} · {i.incidentType.replace(/_/g, ' ')}
                        </Chip>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-emerald-700 dark:text-emerald-400">No incidents — clean batch.</p>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* ---- failure simulations ---- */}
      <div>
        <SectionHeader
          title="Failure simulations"
          description="Each simulation creates the condition, runs the DAG end-to-end and verifies the expected incident was raised (scripts/simulation equivalents)."
          right={
            !can('simulate.run') ? (
              <Chip tone="zinc" title={`Requires ${requiredRoleLabel('simulate.run')} role or higher`}>
                simulations disabled — {requiredRoleLabel('simulate.run')} only
              </Chip>
            ) : undefined
          }
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
          {SIMULATIONS.map((sim) => (
            <button
              key={sim.key}
              onClick={() => runSimulation(sim.key)}
              disabled={busy !== null || !can('simulate.run')}
              title={can('simulate.run') ? undefined : `Requires ${requiredRoleLabel('simulate.run')} role or higher`}
              className={cn(
                'text-left rounded-lg border bg-card p-3 transition-colors hover:border-emerald-400/60 hover:shadow-sm disabled:opacity-60',
                busy === `sim-${sim.key}` && 'border-emerald-500',
              )}
            >
              <div className="flex items-center gap-2">
                {busy === `sim-${sim.key}` ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
                ) : (
                  <Bug className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <Mono className="text-[10px] font-semibold">{sim.label}</Mono>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">expects {sim.expect}</p>
            </button>
          ))}
        </div>

        {simResult ? (
          <div
            className={cn(
              'mt-3 rounded-lg border p-3',
              simResult.verified
                ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30'
                : 'border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/30',
            )}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Chip tone={simResult.verified ? 'green' : 'amber'}>
                {simResult.verified ? 'VERIFIED' : 'CHECK RESULT'}
              </Chip>
              <Mono className="font-semibold">{simResult.simulation}</Mono>
              <Mono>{simResult.batchId}</Mono>
              <span className="text-muted-foreground">date {simResult.businessDate}</span>
            </div>
            <p className="text-xs mt-1.5">{simResult.message}</p>
            {simResult.incidents.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {simResult.incidents.map((i) => (
                  <button key={i.incidentId} onClick={() => onOpenIncident(i.incidentId)}>
                    <Chip tone={i.severity === 'P1' ? 'red' : i.severity === 'P2' ? 'orange' : 'amber'}>
                      {i.incidentId} · {i.severity} · {i.incidentType.replace(/_/g, ' ')}
                    </Chip>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ---- demo data management ---- */}
      <Card>
        <CardHeader className="pb-0 pt-4 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <DatabaseZap className="h-4 w-4 text-muted-foreground" />
            Demo data management
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Seed produces 14 days of believable history (good days, P1-P3 incidents, cascades, escalations,
            resolved tickets, daily reports). Today&apos;s feeds are generated but left unprocessed for you to run.
          </p>
        </CardHeader>
        <CardContent className="px-4 pb-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={seed}
            disabled={busy !== null || !can('demo.reset')}
            title={can('demo.reset') ? 'Replaces ALL operational data with a fresh 14-day narrative' : `Requires ${requiredRoleLabel('demo.reset')} role (destructive — switch from the header profile menu)`}
          >
            {busy === 'seed' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DatabaseZap className="h-3.5 w-3.5" />}
            Seed 14-day demo history
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-red-700 dark:text-red-300 border-red-300 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950"
            onClick={reset}
            disabled={busy !== null || !can('demo.reset')}
            title={can('demo.reset') ? 'Wipes ALL operational data and landing zones' : `Requires ${requiredRoleLabel('demo.reset')} role (destructive — switch from the header profile menu)`}
          >
            {busy === 'reset' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Reset all data
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={refresh} disabled={busy !== null}>
            <RotateCcw className="h-3.5 w-3.5" />
            Refresh state
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
