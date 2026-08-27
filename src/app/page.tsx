'use client'

// =====================================================================
// ESG DataOps Command Center — main operational console (single page)
// Tabs: Control Room | Overview | Pipeline Runs | File Ingestion |
//       Data Quality | Incidents | Reconciliation | Runbooks | Daily Report
// =====================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { Leaf, Loader2, Moon, RefreshCw, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { DashboardState } from '@/lib/esg/dashboard'
import { DEFAULT_ROLE, can as roleCan, type Capability, type Role } from '@/lib/esg/roles'
import { ControlRoomTab } from '@/components/dashboard/control-room'
import { OverviewTab } from '@/components/dashboard/overview'
import { PipelineRunsTab } from '@/components/dashboard/pipeline-runs'
import { FileIngestionTab } from '@/components/dashboard/file-ingestion'
import { DataQualityTab } from '@/components/dashboard/data-quality'
import { IncidentsTab, IncidentDialog } from '@/components/dashboard/incidents'
import { ReconciliationTab } from '@/components/dashboard/reconciliation'
import { RunbooksTab } from '@/components/dashboard/runbooks'
import { DailyReportTab } from '@/components/dashboard/daily-report'
import { SiteAnalyticsTab } from '@/components/dashboard/site-analytics'
import { AlertsConsoleTab } from '@/components/dashboard/alerts-console'
import { HealthChip } from '@/components/dashboard/shared'
import { ShortcutsHelpDialog, useGlobalKeyboardShortcuts } from '@/components/dashboard/shortcuts'
import { CommandPalette } from '@/components/dashboard/command-palette'
import { RoleSwitcher, fetchPersistedRole } from '@/components/dashboard/role-switcher'
import { Search } from 'lucide-react'

// Tab order — index maps to the 1..9,0,d keyboard shortcuts.
const TAB_ORDER = [
  'control-room',
  'overview',
  'pipeline-runs',
  'file-ingestion',
  'data-quality',
  'incidents',
  'alerts',
  'reconciliation',
  'sites',
  'runbooks',
  'daily-report',
] as const

export default function CommandCenterPage() {
  const [state, setState] = useState<DashboardState | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<string>('control-room')
  const [incidentId, setIncidentId] = useState<string | null>(null)
  const [pendingRunbook, setPendingRunbook] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [pendingBatchId, setPendingBatchId] = useState<string | null>(null)
  const [pendingSiteId, setPendingSiteId] = useState<string | null>(null)
  const [pendingCompare, setPendingCompare] = useState(false)
  const [role, setRole] = useState<Role>(DEFAULT_ROLE)
  const { theme, setTheme } = useTheme()
  const refreshInFlight = useRef(false)
  const initialSwitchDone = useRef(false)

  // RBAC: hydrate the server-persisted operator role once (the server
  // store is the source of truth — mutating routes enforce it too).
  useEffect(() => {
    let cancelled = false
    void fetchPersistedRole().then((r) => {
      if (!cancelled) setRole(r)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const can = useCallback((capability: Capability) => roleCan(role, capability), [role])

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return
    refreshInFlight.current = true
    try {
      const res = await fetch('/api/state', { cache: 'no-store' })
      if (res.ok) {
        const json = (await res.json()) as DashboardState
        setState(json)
        // Land first-time visitors on the Overview when history exists,
        // but never yank the user out of a tab they chose.
        if (!initialSwitchDone.current) {
          initialSwitchDone.current = true
          setTab((prev) => (prev === 'control-room' && json.hasData ? 'overview' : prev))
        }
      }
    } catch {
      // transient network error — keep the last good state
    } finally {
      refreshInFlight.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setMounted(true)
    void refresh()
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void refresh()
      }
    }, 30000)
    return () => clearInterval(interval)
  }, [refresh])

  const acknowledgeAlert = async (alertId: number) => {
    const res = await fetch(`/api/alerts/${alertId}/ack`, { method: 'POST' })
    if (res.ok) {
      toast.success(`Alert ${alertId} acknowledged`)
      void refresh()
    } else {
      toast.error('Failed to acknowledge alert')
    }
  }

  const openRunbook = (file: string) => {
    setPendingRunbook(file)
    setTab('runbooks')
  }

  // ---- global keyboard shortcuts (?, r, 1..0, Ctrl/⌘+K) ----
  useGlobalKeyboardShortcuts({
    onHelp: () => setHelpOpen((o) => !o),
    onRefresh: () => {
      void refresh()
      toast.success('State refreshed')
    },
    onTabSelect: (index) => {
      if (index >= 0 && index < TAB_ORDER.length) setTab(TAB_ORDER[index])
    },
    onPalette: () => setPaletteOpen((o) => !o),
  })

  const health = state?.health
  const stripTone =
    health?.status === 'GREEN'
      ? 'bg-emerald-600'
      : health?.status === 'AMBER'
        ? 'bg-amber-500'
        : health?.status === 'RED'
          ? 'bg-red-600'
          : 'bg-zinc-500'

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      {/* ================= header ================= */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-[1500px] px-4 sm:px-6">
          <div className="flex h-14 items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="rounded-md bg-emerald-600 p-1.5 shrink-0 shadow-sm">
                <Leaf className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm font-semibold tracking-tight truncate">
                  ESG DataOps Command Center
                </h1>
                <p className="text-[11px] text-muted-foreground truncate hidden sm:block">
                  Pipeline Observability &amp; L1 Support Platform
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <RoleSwitcher role={role} onChangeRole={setRole} />
              <Badge variant="outline" className="hidden lg:inline-flex text-[10px] font-mono border-zinc-300 dark:border-zinc-700">
                DAG esg_daily_ingestion
              </Badge>
              <button
                onClick={() => setPaletteOpen(true)}
                className="hidden sm:inline-flex items-center gap-1.5 h-7 rounded-md border border-zinc-300 dark:border-zinc-700 bg-muted/60 px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-label="Open command palette (Ctrl K)"
                title="Command palette — Ctrl/⌘ + K"
              >
                <Search className="h-3 w-3" />
                <span className="font-mono">⌘K</span>
              </button>
              <button
                onClick={() => setHelpOpen(true)}
                className="hidden sm:inline-flex items-center justify-center h-7 w-7 rounded-md border border-zinc-300 dark:border-zinc-700 bg-muted/60 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-label="Keyboard shortcuts (press question mark)"
                title="Keyboard shortcuts (?)"
              >
                ?
              </button>
              <span className="hidden sm:inline text-[10px] text-muted-foreground whitespace-nowrap">
                updated {state ? new Date(state.generatedAt).toLocaleTimeString() : '…'}
              </span>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void refresh()} aria-label="Refresh">
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </Button>
              {mounted ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Toggle theme"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                >
                  {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
              ) : null}
            </div>
          </div>

          {/* ---- health strip (vertically centered) ---- */}
          {state ? (
            <div className="flex items-center gap-3 pb-2 text-[11px]">
              <span className={cn('h-2.5 w-2.5 rounded-full shrink-0 self-center', stripTone)} aria-hidden />
              <HealthChip status={state.health.status} className="self-center" />
              <span className="text-muted-foreground truncate hidden md:inline self-center">
                {state.health.reasons.join(' · ')}
              </span>
              <span className="ml-auto text-muted-foreground whitespace-nowrap hidden sm:inline self-center">
                SLA: {state.health.sla.text}
              </span>
            </div>
          ) : null}
        </div>
      </header>

      {/* ================= main ================= */}
      <main className="flex-1 mx-auto w-full max-w-[1500px] px-4 sm:px-6 py-4">
        {loading && !state ? (
          <div className="flex flex-col items-center justify-center py-32 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
            <p className="text-sm text-muted-foreground">Assembling operational state…</p>
          </div>
        ) : state ? (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-9 w-full justify-start overflow-x-auto mb-4 bg-muted/60 rounded-lg">
              <TabsTrigger value="control-room" className="text-xs">Control Room</TabsTrigger>
              <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
              <TabsTrigger value="pipeline-runs" className="text-xs">Pipeline Runs</TabsTrigger>
              <TabsTrigger value="file-ingestion" className="text-xs">File Ingestion</TabsTrigger>
              <TabsTrigger value="data-quality" className="text-xs">Data Quality</TabsTrigger>
              <TabsTrigger value="incidents" className="text-xs">
                <span className="leading-none">Incidents</span>
                {state.overview.activeIncidents > 0 ? (
                  <span className="ml-1 inline-flex items-center rounded-full bg-red-600 text-white text-[9px] px-1.5 h-[14px] font-semibold leading-none">
                    {state.overview.activeIncidents}
                  </span>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="alerts" className="text-xs">
                <span className="leading-none">Alerts</span>
                {state.alerts.filter((a) => !a.acknowledgedFlag).length > 0 ? (
                  <span className="ml-1 inline-flex items-center rounded-full bg-amber-500 text-white text-[9px] px-1.5 h-[14px] font-semibold leading-none">
                    {state.alerts.filter((a) => !a.acknowledgedFlag).length}
                  </span>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="reconciliation" className="text-xs">Reconciliation</TabsTrigger>
              <TabsTrigger value="sites" className="text-xs">Sites</TabsTrigger>
              <TabsTrigger value="runbooks" className="text-xs">Runbooks</TabsTrigger>
              <TabsTrigger value="daily-report" className="text-xs">Daily Report</TabsTrigger>
            </TabsList>

            <TabsContent value="control-room">
              <ControlRoomTab state={state} refresh={() => void refresh()} onOpenIncident={setIncidentId} can={can} />
            </TabsContent>
            <TabsContent value="overview">
              <OverviewTab
                state={state}
                onOpenIncident={setIncidentId}
                onAcknowledgeAlert={acknowledgeAlert}
                can={can}
              />
            </TabsContent>
            <TabsContent value="pipeline-runs">
              <PipelineRunsTab
                state={state}
                onOpenIncident={setIncidentId}
                refresh={() => void refresh()}
                pendingBatchId={pendingBatchId}
                onConsumePendingBatchId={() => setPendingBatchId(null)}
                pendingCompare={pendingCompare}
                onConsumePendingCompare={() => setPendingCompare(false)}
                can={can}
              />
            </TabsContent>
            <TabsContent value="file-ingestion">
              <FileIngestionTab state={state} />
            </TabsContent>
            <TabsContent value="data-quality">
              <DataQualityTab state={state} onViewRunbook={openRunbook} />
            </TabsContent>
            <TabsContent value="incidents">
              <IncidentsTab state={state} onOpenIncident={setIncidentId} />
            </TabsContent>
            <TabsContent value="alerts">
              <AlertsConsoleTab
                state={state}
                onAcknowledgeAlert={acknowledgeAlert}
                refresh={() => void refresh()}
                can={can}
              />
            </TabsContent>
            <TabsContent value="reconciliation">
              <ReconciliationTab state={state} />
            </TabsContent>
            <TabsContent value="sites">
              <SiteAnalyticsTab
                state={state}
                pendingSiteId={pendingSiteId}
                onConsumePendingSiteId={() => setPendingSiteId(null)}
              />
            </TabsContent>
            <TabsContent value="runbooks">
              <RunbooksTab initialDoc={pendingRunbook} onConsumeInitialDoc={() => setPendingRunbook(null)} />
            </TabsContent>
            <TabsContent value="daily-report">
              <DailyReportTab state={state} />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="flex flex-col items-center justify-center py-32 gap-3">
            <p className="text-sm text-muted-foreground">Failed to load operational state.</p>
            <Button size="sm" onClick={() => void refresh()}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          </div>
        )}
      </main>

      {/* ================= footer (sticky) ================= */}
      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto max-w-[1500px] px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            ESG DataOps Command Center — operational monitoring for ESG batch pipelines, validation, and incident response.
          </span>
          <span className="sm:ml-auto font-mono">
            SQLite · Prisma · YAML-configured DQ engine · alert routing
          </span>
        </div>
      </footer>

      {/* ================= incident console ================= */}
      <IncidentDialog
        incidentId={incidentId}
        escalationThresholdMinutes={state?.config.escalationThresholdMinutes ?? 240}
        onClose={() => setIncidentId(null)}
        onChanged={() => void refresh()}
        onViewRunbook={openRunbook}
        can={can}
      />

      {/* ================= command palette (Ctrl/⌘+K) ================= */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        state={state}
        onRefresh={() => void refresh()}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onSelectTab={setTab}
        onOpenIncident={setIncidentId}
        onOpenBatch={(batchId) => {
          setPendingBatchId(batchId)
          setTab('pipeline-runs')
        }}
        onOpenRunbook={openRunbook}
        onOpenSite={(siteId) => {
          setPendingSiteId(siteId)
          setTab('sites')
        }}
        onCompareLatestBatches={() => {
          setPendingCompare(true)
          setTab('pipeline-runs')
        }}
        can={can}
      />

      {/* ================= keyboard shortcuts help ================= */}
      <ShortcutsHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  )
}
