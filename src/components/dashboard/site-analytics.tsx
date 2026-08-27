'use client'

// =====================================================================
// Tab: Site Analytics — dim_site + fact_energy_emissions drilldown
// Per-site energy/emissions analytics with charts, a sortable warehouse
// table and a click-through site drilldown modal (daily trend + recent
// fact rows via GET /api/sites/[siteId]).
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, Database, Gauge, Leaf, Loader2, MapPin, Zap } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import type { DashboardState } from '@/lib/esg/dashboard'
import { DailyEnergyTrendChart, SiteEnergyBarChart, Sparkline } from './charts'
import {
  Chip,
  EmptyState,
  MetricCard,
  Mono,
  SectionHeader,
  TableShell,
  fmtNum,
  fmtTime,
} from './shared'

type SortKey = 'siteName' | 'country' | 'totalEnergyKwh' | 'totalEmissionsCo2e' | 'recordCount'

// ---------------------------------------------------------------------
// Site drilldown modal — loads GET /api/sites/[siteId] on open
// ---------------------------------------------------------------------
interface SiteDetail {
  site: {
    siteId: string
    siteName: string
    country: string
    region: string
    siteType: string
    activeFlag: boolean
    totalEnergyKwh: number
    totalEmissionsCo2e: number
    recordCount: number
    carbonIntensity: number
    firstReading: string | null
    latestReading: string | null
    batches: number
  }
  dailyTrend: { date: string; energyKwh: number | null; emissionsCo2e: number | null; records: number }[]
  recentRows: {
    recordId: string
    readingDate: string
    energyKwh: number
    emissionsCo2e: number
    batchId: string
    sourceFileName: string
    loadedAt: string
  }[]
}

function SiteDrilldownDialog({
  siteId,
  onClose,
}: {
  siteId: string | null
  onClose: () => void
}) {
  // The parent passes key={siteId} so this component remounts (state resets)
  // whenever a different site is opened — no reset effects needed.
  const [detail, setDetail] = useState<SiteDetail | null>(null)
  const [loading, setLoading] = useState(siteId !== null)

  useEffect(() => {
    if (!siteId) return
    let cancelled = false
    fetch(`/api/sites/${encodeURIComponent(siteId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as SiteDetail
      })
      .then((json) => {
        if (cancelled) return
        setDetail(json)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setDetail(null)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [siteId])

  return (
    <Dialog open={siteId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl w-[95vw] max-h-[90vh] overflow-y-auto">
        {loading || !detail ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <DialogTitle className="sr-only">Loading site detail</DialogTitle>
            <DialogDescription className="sr-only">
              Fetching per-site aggregates from fact_energy_emissions.
            </DialogDescription>
            <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
            <p className="text-xs text-muted-foreground">
              {loading ? 'Loading site aggregates…' : 'Site detail unavailable.'}
            </p>
          </div>
        ) : (
          <>
            <DialogHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="text-base flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-emerald-600" />
                  {detail.site.siteName}
                </DialogTitle>
                <Mono className="text-[10px] text-muted-foreground">{detail.site.siteId}</Mono>
                <Chip tone="zinc">{detail.site.siteType}</Chip>
                <Chip tone="teal">{detail.site.country}</Chip>
                {detail.site.activeFlag ? <Chip tone="green">ACTIVE</Chip> : <Chip tone="zinc">INACTIVE</Chip>}
              </div>
              <DialogDescription className="text-xs">
                Region {detail.site.region} · {fmtNum(detail.site.recordCount)} fact rows across{' '}
                {detail.site.batches} batch(es) · readings {fmtTime(detail.site.firstReading)} →{' '}
                {fmtTime(detail.site.latestReading)}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3">
              <MetricCard
                label="Total energy"
                value={fmtNum(Math.round(detail.site.totalEnergyKwh))}
                sub="kWh (all facts)"
                tone="green"
                icon={<Zap className="h-4 w-4" />}
              />
              <MetricCard
                label="Total emissions"
                value={fmtNum(Math.round(detail.site.totalEmissionsCo2e))}
                sub="kg CO2e (all facts)"
                tone="orange"
                icon={<Leaf className="h-4 w-4" />}
              />
              <MetricCard
                label="Carbon intensity"
                value={detail.site.carbonIntensity.toFixed(3)}
                sub="kg CO2e / kWh"
                tone={
                  detail.site.carbonIntensity > 0.5
                    ? 'red'
                    : detail.site.carbonIntensity > 0.3
                      ? 'amber'
                      : 'green'
                }
                icon={<Gauge className="h-4 w-4" />}
              />
              <MetricCard
                label="Fact rows"
                value={fmtNum(detail.site.recordCount)}
                sub={`${detail.site.batches} batch(es)`}
                tone="violet"
                icon={<Database className="h-4 w-4" />}
              />
            </div>

            <Card>
              <CardHeader className="pb-0 pt-3 px-4">
                <CardTitle className="text-sm font-semibold">Daily energy &amp; emissions trend</CardTitle>
              </CardHeader>
              <CardContent className="px-2 pb-2">
                {detail.dailyTrend.every((d) => !d.energyKwh) ? (
                  <EmptyState title="No readings in the trend window" />
                ) : (
                  <DailyEnergyTrendChart data={detail.dailyTrend} />
                )}
              </CardContent>
            </Card>

            <div>
              <p className="text-xs font-semibold mb-2">Recent fact rows (latest 10 readings)</p>
              <TableShell className="max-h-64">
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Record</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Reading date</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">kWh</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">kg CO2e</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Batch</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Source file</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.recentRows.map((r) => (
                      <TableRow key={r.recordId}>
                        <TableCell className="font-mono text-[10px]">{r.recordId}</TableCell>
                        <TableCell className="text-[11px] whitespace-nowrap">{fmtTime(r.readingDate)}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums font-medium">
                          {fmtNum(r.energyKwh, 2)}
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums font-medium">
                          {fmtNum(r.emissionsCo2e, 2)}
                        </TableCell>
                        <TableCell className="font-mono text-[10px]">{r.batchId}</TableCell>
                        <TableCell className="font-mono text-[10px] max-w-[200px] truncate" title={r.sourceFileName}>
                          {r.sourceFileName}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableShell>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------
// Sites tab
// ---------------------------------------------------------------------
export function SiteAnalyticsTab({
  state,
  pendingSiteId,
  onConsumePendingSiteId,
}: {
  state: DashboardState
  /** Site to auto-open in the drilldown (set by the command palette). */
  pendingSiteId?: string | null
  /** Clear the pending deep-link once consumed. */
  onConsumePendingSiteId?: () => void
}) {
  const [sortKey, setSortKey] = useState<SortKey>('totalEnergyKwh')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [countryFilter, setCountryFilter] = useState<string>('ALL')
  const [drilldownSiteId, setDrilldownSiteId] = useState<string | null>(null)

  const closeDrilldown = useCallback(() => {
    setDrilldownSiteId(null)
    onConsumePendingSiteId?.()
  }, [onConsumePendingSiteId])

  // Lint-safe deep-link: the palette writes pendingSiteId; we merge it with
  // the locally-clicked drilldown site id (palette wins when set) and drive
  // the dialog via a derived value + key remount — no setState-in-effect.
  const openSiteId = pendingSiteId ?? drilldownSiteId

  const countries = useMemo(
    () => [...new Set(state.sites.map((s) => s.country))].sort(),
    [state.sites],
  )

  const filtered = useMemo(() => {
    const list = state.sites.filter((s) => countryFilter === 'ALL' || s.country === countryFilter)
    return [...list].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [state.sites, sortKey, sortDir, countryFilter])

  const totals = useMemo(() => {
    const totalEnergy = filtered.reduce((a, s) => a + s.totalEnergyKwh, 0)
    const totalEmissions = filtered.reduce((a, s) => a + s.totalEmissionsCo2e, 0)
    const totalRecords = filtered.reduce((a, s) => a + s.recordCount, 0)
    return { totalEnergy, totalEmissions, totalRecords }
  }, [filtered])

  const topSitesForChart = useMemo(() => {
    return [...filtered].sort((a, b) => b.totalEnergyKwh - a.totalEnergyKwh).slice(0, 12)
  }, [filtered])

  // Carbon intensity: kg CO2e per kWh — a key ESG efficiency metric.
  const carbonIntensity = totals.totalEnergy > 0 ? totals.totalEmissions / totals.totalEnergy : 0

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'siteName' || key === 'country' ? 'asc' : 'desc')
    }
  }

  return (
    <div className="space-y-4">
      {/* ---- KPI row ---- */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
        <MetricCard
          label="Sites tracked"
          value={state.overview.sitesTracked}
          sub={`of which ${filtered.length} active in window`}
          tone="teal"
          icon={<Building2 className="h-4 w-4" />}
        />
        <MetricCard
          label="Total energy"
          value={fmtNum(Math.round(totals.totalEnergy))}
          sub="kWh (warehouse facts)"
          tone="green"
          icon={<Zap className="h-4 w-4" />}
        />
        <MetricCard
          label="Total emissions"
          value={fmtNum(Math.round(totals.totalEmissions))}
          sub="kg CO2e (warehouse facts)"
          tone="orange"
          icon={<Leaf className="h-4 w-4" />}
        />
        <MetricCard
          label="Carbon intensity"
          value={carbonIntensity.toFixed(3)}
          sub="kg CO2e / kWh (efficiency)"
          tone={carbonIntensity > 0.5 ? 'red' : carbonIntensity > 0.3 ? 'amber' : 'green'}
          icon={<Gauge className="h-4 w-4" />}
        />
        <MetricCard
          label="Fact rows"
          value={fmtNum(totals.totalRecords)}
          sub={`across ${filtered.length} sites`}
          tone="violet"
          icon={<Database className="h-4 w-4" />}
        />
      </div>

      {/* ---- charts ---- */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-0 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">
              Top sites — energy vs emissions (kWh &amp; kg CO2e)
            </CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2">
            {topSitesForChart.length === 0 ? (
              <EmptyState title="No site data yet" hint="Run the DAG from the Control Room to load warehouse facts." />
            ) : (
              <SiteEnergyBarChart
                data={topSitesForChart.map((s) => ({
                  siteName: s.siteName,
                  energyKwh: s.totalEnergyKwh,
                  emissionsCo2e: s.totalEmissionsCo2e,
                }))}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-0 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex flex-wrap items-center gap-2">
              Daily energy &amp; emissions trend ({state.config.trendDays} days)
              <span
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 bg-muted/40 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
                title="Days without a DAG run render as an honest gap in the line — not a dip to zero"
              >
                <span className="h-0 w-3 border-t-2 border-dashed border-zinc-400 dark:border-zinc-600" aria-hidden />
                gaps = no batch
              </span>
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-1">
              Days without a DAG run render as an honest gap in the line (no dip to zero). Hover a point for daily totals.
            </p>
          </CardHeader>
          <CardContent className="px-2 pb-2">
            {state.siteTrend.every((d) => !d.energyKwh) ? (
              <EmptyState title="No daily aggregates yet" hint="Warehouse facts will appear here once the DAG has run." />
            ) : (
              <DailyEnergyTrendChart data={state.siteTrend} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---- per-site table ---- */}
      <div>
        <SectionHeader
          title="Site directory (dim_site ⋈ fact_energy_emissions)"
          description="Per-site totals aggregated from the warehouse fact table. Click a column header to sort."
          right={
            <Select value={countryFilter} onValueChange={setCountryFilter}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="Country" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All countries</SelectItem>
                {countries.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        {filtered.length === 0 ? (
          <EmptyState
            title="No sites in the warehouse"
            hint="Generate feeds and run the DAG to populate dim_site + fact_energy_emissions."
          />
        ) : (
          <TableShell className="max-h-[520px]">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow className="hover:bg-transparent">
                  <TableHead
                    className="text-[11px] font-semibold uppercase tracking-wider cursor-pointer select-none"
                    onClick={() => toggleSort('siteName')}
                  >
                    Site {sortKey === 'siteName' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                  </TableHead>
                  <TableHead
                    className="text-[11px] font-semibold uppercase tracking-wider cursor-pointer select-none"
                    onClick={() => toggleSort('country')}
                  >
                    Country {sortKey === 'country' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                  </TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Region</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Type</TableHead>
                  <TableHead
                    className="text-[11px] font-semibold uppercase tracking-wider text-right cursor-pointer select-none"
                    onClick={() => toggleSort('totalEnergyKwh')}
                  >
                    Energy (kWh) {sortKey === 'totalEnergyKwh' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                  </TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-center">
                    {state.config.trendDays}-day trend
                  </TableHead>
                  <TableHead
                    className="text-[11px] font-semibold uppercase tracking-wider text-right cursor-pointer select-none"
                    onClick={() => toggleSort('totalEmissionsCo2e')}
                  >
                    Emissions (kg CO2e) {sortKey === 'totalEmissionsCo2e' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                  </TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">
                    Intensity
                  </TableHead>
                  <TableHead
                    className="text-[11px] font-semibold uppercase tracking-wider text-right cursor-pointer select-none"
                    onClick={() => toggleSort('recordCount')}
                  >
                    Records {sortKey === 'recordCount' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                  </TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Latest reading</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => {
                  const intensity = s.totalEnergyKwh > 0 ? s.totalEmissionsCo2e / s.totalEnergyKwh : 0
                  const intensityTone = intensity > 0.5 ? 'red' : intensity > 0.3 ? 'amber' : 'green'
                  return (
                    <TableRow
                      key={s.siteId}
                      className="cursor-pointer"
                      onClick={() => setDrilldownSiteId(s.siteId)}
                      title={`Click to drill into ${s.siteName}`}
                    >
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate group-hover:text-emerald-600">{s.siteName}</p>
                            <Mono className="text-[10px] text-muted-foreground">{s.siteId}</Mono>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{s.country}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{s.region}</TableCell>
                      <TableCell>
                        <Chip tone="zinc">{s.siteType}</Chip>
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums font-medium">
                        {fmtNum(Math.round(s.totalEnergyKwh))}
                      </TableCell>
                      <TableCell className="text-center" title={`Daily kWh, last ${s.trend.length} days`}>
                        <Sparkline values={s.trend} />
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums font-medium">
                        {fmtNum(Math.round(s.totalEmissionsCo2e))}
                      </TableCell>
                      <TableCell className="text-right">
                        <Chip tone={intensityTone}>{intensity.toFixed(3)}</Chip>
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{fmtNum(s.recordCount)}</TableCell>
                      <TableCell className="text-[11px] whitespace-nowrap text-muted-foreground">
                        {fmtTime(s.latestReading)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableShell>
        )}
      </div>

      {/* ---- site drilldown modal (key remounts it per site) ---- */}
      <SiteDrilldownDialog key={openSiteId ?? 'closed'} siteId={openSiteId} onClose={closeDrilldown} />
    </div>
  )
}
