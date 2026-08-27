'use client'

// =====================================================================
// ESG DataOps Command Center — command palette (Ctrl/⌘+K)
// Global search across every operational object an L1 engineer needs:
// actions (refresh / generate feeds / run DAG / theme), the 11 tabs,
// incidents, batches (deep-links into the Batch Explorer lineage),
// runbooks + SOPs and sites. Modeled on the Grafana / Linear palettes
// that on-call engineers live in.
// =====================================================================

import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  Building2,
  CircleAlert,
  ClipboardList,
  Cpu,
  GitBranch,
  GitCompare,
  Keyboard,
  Loader2,
  Moon,
  Package,
  PlayCircle,
  RefreshCw,
  Sun,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import type { DashboardState } from '@/lib/esg/dashboard'
import { downloadIncidentHandover } from './handover'

interface DocEntry {
  id: string
  title: string
  file: string
}

/** Tab metadata — labels double as the palette search keywords. */
const TAB_ITEMS: { value: string; label: string; shortcut: string }[] = [
  { value: 'control-room', label: 'Control Room — generate feeds, run the DAG, simulate failures', shortcut: '1' },
  { value: 'overview', label: 'Overview — health, KPIs, incident timeline', shortcut: '2' },
  { value: 'pipeline-runs', label: 'Pipeline Runs — Gantt, replay, batch lineage', shortcut: '3' },
  { value: 'file-ingestion', label: 'File Ingestion — landing zone + quarantine', shortcut: '4' },
  { value: 'data-quality', label: 'Data Quality — 17 YAML-configured checks', shortcut: '5' },
  { value: 'incidents', label: 'Incidents — ServiceNow-style console', shortcut: '6' },
  { value: 'alerts', label: 'Alerts — dispatch feed + subscriptions', shortcut: '7' },
  { value: 'reconciliation', label: 'Reconciliation — source vs warehouse', shortcut: '8' },
  { value: 'sites', label: 'Sites — energy & emissions analytics', shortcut: '9' },
  { value: 'runbooks', label: 'Runbooks — RB001–RB010 + SOPs', shortcut: '0' },
  { value: 'daily-report', label: 'Daily Report — ops report archive', shortcut: 'd' },
]

/** Module-level doc cache — runbooks/SOPs are static files on disk, so a
 *  single fetch per session is enough (never re-fetched while mounted). */
let docsCache: DocEntry[] | null = null

export function CommandPalette({
  open,
  onOpenChange,
  state,
  onRefresh,
  onToggleTheme,
  onSelectTab,
  onOpenIncident,
  onOpenBatch,
  onOpenRunbook,
  onOpenSite,
  onCompareLatestBatches,
  can,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: DashboardState | null
  onRefresh: () => void
  onToggleTheme: () => void
  onSelectTab: (tabValue: string) => void
  onOpenIncident: (incidentId: string) => void
  /** Switch to Pipeline Runs and open the Batch Explorer for this batch. */
  onOpenBatch: (batchId: string) => void
  /** Switch to Runbooks and open this document (path or id). */
  onOpenRunbook: (docFile: string) => void
  /** Switch to Sites and open the per-site drilldown dialog. */
  onOpenSite: (siteId: string) => void
  /** Switch to Pipeline Runs and open the compare dialog on the two latest batches. */
  onCompareLatestBatches: () => void
  /** RBAC capability check — mutating palette actions are hidden below role. */
  can: (capability: import('@/lib/esg/roles').Capability) => boolean
}) {
  const [docs, setDocs] = useState<DocEntry[] | null>(docsCache)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const today = state?.today ?? new Date().toISOString().slice(0, 10)

  // Lazy-load the doc index the first time the palette opens.
  useEffect(() => {
    if (!open || docsCache) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/runbooks')
        if (!res.ok) return
        const json = (await res.json()) as { runbooks: DocEntry[]; sops: DocEntry[] }
        const all = [...(json.runbooks ?? []), ...(json.sops ?? [])]
        if (!cancelled && all.length > 0) {
          docsCache = all
          setDocs(all)
        }
      } catch {
        // palette still works without the doc index
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  const close = () => onOpenChange(false)

  const activeIncidents = useMemo(
    () => (state?.incidents ?? []).filter((i) => i.status === 'OPEN' || i.status === 'IN_PROGRESS'),
    [state],
  )

  const exportHandover = () => {
    if (!state || activeIncidents.length === 0) {
      toast.info('No active incidents — nothing to hand over')
      close()
      return
    }
    downloadIncidentHandover(activeIncidents, { status: 'ACTIVE', severity: 'ALL' }, state.config)
    toast.success('Incident queue handover exported', {
      description: `${activeIncidents.length} active incident(s) — queue summary, detail and triage checklist.`,
    })
    close()
  }

  const generateFeeds = async () => {
    setBusyAction('datagen')
    try {
      const res = await fetch('/api/datagen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessDate: today, scenarios: [] }),
      })
      if (!res.ok) {
        toast.error('Feed generation failed')
        return
      }
      toast.success(`Clean feeds for ${today} generated in the landing zone`)
      onRefresh()
      close()
    } finally {
      setBusyAction(null)
    }
  }

  const runDag = async () => {
    setBusyAction('dag')
    try {
      const res = await fetch('/api/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessDate: today }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'DAG run failed')
        return
      }
      const batchId = (json as { batchId?: string }).batchId ?? 'batch'
      toast.success(`DAG complete — ${batchId}`)
      onRefresh()
      onSelectTab('pipeline-runs')
      close()
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search actions, tabs, incidents, batches, runbooks and sites"
      className="sm:max-w-[560px]"
      filter={(value, search) => {
        // Precise substring matching (ops engineers search exact
        // identifiers: INC-000011, RB005, B-20260831). cmdk's fuzzy
        // ranking surfaced unrelated incidents over the exact runbook.
        const s = search.trim().toLowerCase()
        if (!s) return 1
        return value.toLowerCase().includes(s) ? 1 : 0
      }}
    >
      <CommandInput placeholder="Search the command center… (e.g. INC-000009, RB005, replay)" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>No results — try an incident id, batch id or runbook name.</CommandEmpty>

        {/* ---------------- actions ---------------- */}
        <CommandGroup heading="Actions">
          <CommandItem
            value="refresh state reload operational"
            onSelect={() => {
              onRefresh()
              toast.success('State refreshed')
              close()
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh operational state
            <kbd className="ml-auto font-mono text-[10px] text-muted-foreground">r</kbd>
          </CommandItem>
          {can('datagen.generate') ? (
            <CommandItem
              value="generate feeds today synthetic data landing zone"
              onSelect={() => void generateFeeds()}
              disabled={busyAction === 'datagen'}
            >
              {busyAction === 'datagen' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Package className="h-4 w-4" />
              )}
              Generate clean feeds for {today}
            </CommandItem>
          ) : null}
          {can('run.dag') ? (
            <CommandItem
              value="run dag pipeline execute orchestrate"
              onSelect={() => void runDag()}
              disabled={busyAction === 'dag'}
            >
              {busyAction === 'dag' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              Run DAG esg_daily_ingestion for {today}
            </CommandItem>
          ) : null}
          <CommandItem
            value="toggle theme dark light mode"
            onSelect={() => {
              onToggleTheme()
              close()
            }}
          >
            <Moon className="h-4 w-4 dark:hidden" />
            <Sun className="hidden h-4 w-4 dark:block" />
            Toggle dark / light theme
          </CommandItem>
          <CommandItem
            value="export incident queue handover markdown shift"
            onSelect={exportHandover}
          >
            <ClipboardList className="h-4 w-4" />
            Export incident queue handover
            <span className="ml-auto text-[9px] text-muted-foreground/70">
              {state ? `${activeIncidents.length} active` : ''}
            </span>
          </CommandItem>
          <CommandItem
            value="compare latest two batches diff side by side"
            onSelect={() => {
              onCompareLatestBatches()
              close()
            }}
            disabled={!state || state.batchTimeline.length < 2}
          >
            <GitCompare className="h-4 w-4" />
            Compare latest 2 batches
            <span className="ml-auto text-[9px] text-muted-foreground/70">
              {state && state.batchTimeline.length >= 2 ? state.batchTimeline[0].batchId : 'need 2 batches'}
            </span>
          </CommandItem>
          <CommandItem
            value="keyboard shortcuts help"
            onSelect={() => {
              close()
              // re-use the existing ? shortcut help via a synthetic keydown
              window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))
            }}
          >
            <Keyboard className="h-4 w-4" />
            Keyboard shortcuts
            <kbd className="ml-auto font-mono text-[10px] text-muted-foreground">?</kbd>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* ---------------- tabs ---------------- */}
        <CommandGroup heading="Navigate">
          {TAB_ITEMS.map((t) => (
            <CommandItem
              key={t.value}
              value={`go to tab ${t.label}`}
              onSelect={() => {
                onSelectTab(t.value)
                close()
              }}
            >
              <Zap className="h-4 w-4 text-muted-foreground" />
              {t.label}
              <kbd className="ml-auto font-mono text-[10px] text-muted-foreground">{t.shortcut}</kbd>
            </CommandItem>
          ))}
        </CommandGroup>

        {/* ---------------- incidents ---------------- */}
        {state && state.incidents.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Incidents">
              {state.incidents.slice(0, 30).map((inc) => (
                <CommandItem
                  key={inc.incidentId}
                  value={`incident ${inc.incidentId} ${inc.incidentType} ${inc.severity} ${inc.shortDescription}`}
                  onSelect={() => {
                    onOpenIncident(inc.incidentId)
                    close()
                  }}
                >
                  <CircleAlert
                    className={
                      inc.severity === 'P1'
                        ? 'h-4 w-4 text-red-500'
                        : inc.severity === 'P2'
                          ? 'h-4 w-4 text-orange-500'
                          : 'h-4 w-4 text-amber-500'
                    }
                  />
                  <span className="font-mono text-xs font-semibold">{inc.incidentId}</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {inc.incidentType.replace(/_/g, ' ')} · {inc.status.replace('_', ' ')} ·{' '}
                    {inc.shortDescription}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {/* ---------------- batches (lineage deep-link) ---------------- */}
        {state && state.batchTimeline.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Batches — open lineage">
              {state.batchTimeline.slice(0, 10).map((b) => (
                <CommandItem
                  key={b.batchId}
                  value={`batch ${b.batchId} lineage ${b.businessDate}`}
                  onSelect={() => {
                    onOpenBatch(b.batchId)
                    close()
                  }}
                >
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono text-xs font-semibold">{b.batchId}</span>
                  <span className="text-xs text-muted-foreground">
                    {b.businessDate} · {b.tasks.length} tasks · {b.totalDurationSeconds.toFixed(2)}s
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {/* ---------------- runbooks + SOPs ---------------- */}
        {docs && docs.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Runbooks & SOPs">
              {docs.map((d) => (
                <CommandItem
                  key={d.id}
                  value={`runbook sop doc ${d.id} ${d.title}`}
                  onSelect={() => {
                    onOpenRunbook(d.file)
                    close()
                  }}
                >
                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs">{d.title}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground truncate max-w-[180px]">
                    {d.file}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {/* ---------------- sites ---------------- */}
        {state && state.sites.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Sites">
              {state.sites.slice(0, 24).map((s) => (
                <CommandItem
                  key={s.siteId}
                  value={`site ${s.siteId} ${s.siteName} ${s.country}`}
                  onSelect={() => {
                    onOpenSite(s.siteId)
                    close()
                  }}
                >
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono text-xs font-semibold">{s.siteId}</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {s.siteName} · {s.country}
                  </span>
                  <span className="ml-auto text-[9px] text-muted-foreground/70">drilldown</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        <CommandSeparator />
        <div className="flex items-center justify-between px-3 py-2 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Cpu className="h-3 w-3" /> ESG DataOps command palette
          </span>
          <span className="font-mono">Ctrl/⌘ + K</span>
        </div>
      </CommandList>
    </CommandDialog>
  )
}
