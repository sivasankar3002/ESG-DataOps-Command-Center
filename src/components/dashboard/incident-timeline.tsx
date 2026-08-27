'use client'

// =====================================================================
// ESG DataOps Command Center — Incident & pipeline timeline strip
// (Overview tab). A 14-day horizontal timeline: one column per day with
// the batch status bar, incident dots (severity-coloured, open vs
// resolved, escalation ring) and per-day DQ / quarantine mini-counts.
// Every incident dot is a button that deep-links into the incident
// console — the "at a glance" severity history an L1 on-call engineer
// scans at the start of a shift.
// =====================================================================

import { useMemo } from 'react'
import { CalendarRange } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { DashboardState } from '@/lib/esg/dashboard'

const SEVERITY_DOT: Record<string, string> = {
  P1: 'bg-red-500 dark:bg-red-400',
  P2: 'bg-orange-500 dark:bg-orange-400',
  P3: 'bg-amber-500 dark:bg-amber-400',
  P4: 'bg-zinc-400 dark:bg-zinc-500',
}

const SEVERITY_RING: Record<string, string> = {
  P1: 'hover:ring-red-300 dark:hover:ring-red-700',
  P2: 'hover:ring-orange-300 dark:hover:ring-orange-700',
  P3: 'hover:ring-amber-300 dark:hover:ring-amber-700',
  P4: 'hover:ring-zinc-300 dark:hover:ring-zinc-700',
}

const MAX_DOTS = 4

function localDateKey(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function IncidentTimelineStrip({
  state,
  onOpenIncident,
}: {
  state: DashboardState
  onOpenIncident: (incidentId: string) => void
}) {
  const days = state.dailyTrend
  const today = state.today

  // Group incidents by local creation date (keep newest first within a day).
  const incidentsByDay = useMemo(() => {
    const map = new Map<string, DashboardState['incidents']>()
    for (const inc of state.incidents) {
      const key = localDateKey(inc.createdAt)
      const list = map.get(key) ?? []
      list.push(inc)
      map.set(key, list)
    }
    return map
  }, [state.incidents])

  // Batch status by business date (latest batch for that date wins).
  const batchByDate = useMemo(() => {
    const map = new Map<string, string>()
    for (const b of state.batches) {
      map.set(b.businessDate, b.status) // batches[] is newest-first
    }
    return map
  }, [state.batches])

  const totalIncidents = days.reduce((a, d) => a + d.incidents, 0)
  const worstDay = days.reduce(
    (worst, d) => (d.incidents > worst.incidents ? d : worst),
    { date: '', incidents: 0 } as DashboardState['dailyTrend'][number],
  )

  return (
    <Card>
      <CardHeader className="pb-0 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-emerald-600" />
          Incident &amp; pipeline timeline — last {days.length} days
          <span className="ml-auto text-[10px] font-normal text-muted-foreground">
            {totalIncidents} incident(s) in window
            {worstDay.incidents > 0 ? ` · busiest ${worstDay.date.slice(5)} (${worstDay.incidents})` : ''}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Each column is one business day. Click an incident dot to open its record — dots are
          severity-coloured, hollow when resolved, ringed when auto-escalated.
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-3">
        <div className="overflow-x-auto pb-1">
          <div className="flex gap-1.5 min-w-[720px]">
            {days.map((day) => {
              const dayIncidents = incidentsByDay.get(day.date) ?? []
              const batchStatus = batchByDate.get(day.date)
              const isToday = day.date === today
              const shown = dayIncidents.slice(0, MAX_DOTS)
              const overflow = dayIncidents.length - shown.length
              return (
                <div
                  key={day.date}
                  className={cn(
                    'flex-1 min-w-0 rounded-lg border px-1.5 pt-1.5 pb-1.5 flex flex-col items-center gap-1.5 transition-colors',
                    isToday
                      ? 'border-emerald-400/80 bg-emerald-50/50 dark:bg-emerald-950/20'
                      : 'border-border/70 bg-muted/20 hover:border-emerald-300/60',
                  )}
                >
                  {/* ---- date label ---- */}
                  <div className="text-center leading-none">
                    <p
                      className={cn(
                        'font-mono text-[10px] tabular-nums',
                        isToday
                          ? 'text-emerald-700 dark:text-emerald-300 font-bold'
                          : 'text-foreground/85 dark:text-zinc-300',
                      )}
                    >
                      {day.date.slice(5)}
                    </p>
                    <p className="text-[8px] uppercase tracking-wide text-muted-foreground dark:text-zinc-400 mt-0.5">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${day.date}T00:00:00`).getDay()]}
                    </p>
                  </div>

                  {/* ---- batch status bar ---- */}
                  <div
                    className={cn(
                      'h-1.5 w-full rounded-full',
                      batchStatus === 'SUCCESS'
                        ? 'bg-emerald-500/80'
                        : batchStatus === 'FAILED'
                          ? 'bg-red-500/80'
                          : 'bg-zinc-300 dark:bg-zinc-700 border border-dashed border-zinc-400 dark:border-zinc-600',
                    )}
                    title={
                      batchStatus === 'SUCCESS'
                        ? `Batch on ${day.date}: SUCCESS (${day.jobsSuccess} task(s) succeeded)`
                        : batchStatus === 'FAILED'
                          ? `Batch on ${day.date}: FAILED (${day.jobsFailed} task(s) failed)`
                          : `No DAG run recorded for ${day.date}`
                    }
                  />

                  {/* ---- incident dots ---- */}
                  <div className="flex flex-col items-center justify-start gap-[3px] min-h-[52px] w-full">
                    {shown.length === 0 ? (
                      <span
                        className="text-[9px] text-muted-foreground/60 dark:text-zinc-500 mt-3 select-none"
                        title={`No incidents on ${day.date}`}
                      >
                        —
                      </span>
                    ) : (
                      shown.map((inc) => {
                        const active = inc.status === 'OPEN' || inc.status === 'IN_PROGRESS'
                        return (
                          <button
                            key={inc.incidentId}
                            onClick={() => onOpenIncident(inc.incidentId)}
                            title={`${inc.incidentId} · ${inc.severity} · ${inc.incidentType.replace(/_/g, ' ')} · ${inc.status.replace('_', ' ')}${inc.escalatedFlag ? ' · escalated' : ''}\n${inc.shortDescription}`}
                            aria-label={`Open incident ${inc.incidentId} (${inc.severity}, ${inc.status})`}
                            className={cn(
                              'h-3 w-3 rounded-full ring-offset-1 ring-offset-transparent transition-all',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
                              'hover:scale-125',
                              SEVERITY_DOT[inc.severity] ?? SEVERITY_DOT.P4,
                              SEVERITY_RING[inc.severity] ?? SEVERITY_RING.P4,
                              inc.escalatedFlag &&
                                'ring-1 ring-violet-500 dark:ring-violet-400 ring-offset-0',
                              !active && 'opacity-45 saturate-50',
                            )}
                          />
                        )
                      })
                    )}
                    {overflow > 0 ? (
                      <span className="text-[8px] font-semibold text-muted-foreground dark:text-zinc-400 leading-none">
                        +{overflow}
                      </span>
                    ) : null}
                  </div>

                  {/* ---- per-day mini counts ---- */}
                  <div className="flex items-center gap-1 text-[8px] leading-none font-medium tabular-nums">
                    {day.dqFail > 0 ? (
                      <span className="text-red-600 dark:text-red-400" title={`${day.dqFail} DQ check failure(s)`}>
                        ✗{day.dqFail}
                      </span>
                    ) : null}
                    {day.filesQuarantined > 0 ? (
                      <span
                        className="text-amber-600 dark:text-amber-400"
                        title={`${day.filesQuarantined} file(s) quarantined`}
                      >
                        ⧗{day.filesQuarantined}
                      </span>
                    ) : null}
                    {day.dqFail === 0 && day.filesQuarantined === 0 ? (
                      <span className="text-emerald-600/80 dark:text-emerald-400/80" title="Clean day">
                        ✓
                      </span>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ---- legend ---- */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-muted-foreground dark:text-zinc-400 border-t pt-2.5">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 dark:bg-red-400" aria-hidden /> P1
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-orange-500 dark:bg-orange-400" aria-hidden /> P2
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500 dark:bg-amber-400" aria-hidden /> P3
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-400 dark:bg-zinc-500" aria-hidden /> P4
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500/40 dark:bg-red-400/40" aria-hidden /> resolved
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full ring-1 ring-violet-500 dark:ring-violet-400 bg-orange-500" aria-hidden />{' '}
            escalated
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-5 rounded-full bg-emerald-500/80" aria-hidden /> batch ok
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-5 rounded-full bg-red-500/80" aria-hidden /> batch failed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-5 rounded-full border border-dashed border-zinc-400" aria-hidden /> no run
          </span>
          <span className="ml-auto hidden sm:inline">✗ DQ fails · ⧗ quarantined · today is highlighted</span>
        </div>
      </CardContent>
    </Card>
  )
}
