'use client'

// =====================================================================
// Tab: Reconciliation — source-to-target row counts + aggregates
// =====================================================================

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { DashboardState } from '@/lib/esg/dashboard'
import { ReconChart } from './charts'
import { Chip, EmptyState, MetricCard, Mono, SectionHeader, TableShell, fmtNum } from './shared'

export function ReconciliationTab({ state }: { state: DashboardState }) {
  const rows = state.reconciliation
  const latest = rows[0]
  const allPass = rows.filter((r) => r.status === 'PASS').length
  const mismatched = rows.filter((r) => r.status !== 'PASS')

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
        <MetricCard
          label="Latest batch"
          value={latest ? latest.batchId : '-'}
          sub={latest ? `business date ${latest.businessDate}` : 'no batches yet'}
          tone="violet"
          valueClassName="text-base font-mono"
        />
        <MetricCard
          label="Latest source rows"
          value={latest ? fmtNum(latest.sourceCount) : '-'}
          sub="staging (validation_status = VALID)"
          tone="zinc"
        />
        <MetricCard
          label="Latest target rows"
          value={latest ? fmtNum(latest.targetCount) : '-'}
          sub="fact_energy_emissions"
          tone="teal"
        />
        <MetricCard
          label="Row difference"
          value={latest ? fmtNum(latest.diffRows) : '-'}
          sub="source - target (must be 0)"
          tone={latest && latest.diffRows !== 0 ? 'red' : 'green'}
        />
        <MetricCard
          label="Batches balanced"
          value={`${allPass}/${rows.length}`}
          sub={`${mismatched.length} mismatch(es) in window`}
          tone={mismatched.length > 0 ? 'amber' : 'green'}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-0 pt-4 px-4">
            <CardTitle className="text-sm font-medium">Source vs target row counts (latest batches)</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2">
            {rows.length === 0 ? (
              <EmptyState title="No batches to reconcile yet" />
            ) : (
              <ReconChart data={[...rows].reverse().map((r) => ({ batchId: r.batchId, businessDate: r.businessDate, sourceCount: r.sourceCount, targetCount: r.targetCount }))} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-0 pt-4 px-4">
            <CardTitle className="text-sm font-medium">Aggregate reconciliation (energy_kwh)</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2 pt-4">
            {rows.length === 0 ? (
              <EmptyState title="No aggregates yet" />
            ) : (
              <ul className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {rows.slice(0, 12).map((r) => (
                  <li key={r.batchId} className="flex items-center gap-2 text-xs">
                    <Mono className="w-28 shrink-0">{r.batchId}</Mono>
                    <div className="flex-1 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden relative">
                      <div
                        className="absolute inset-y-0 left-0 bg-emerald-500/80 rounded-full"
                        style={{
                          width: `${
                            r.targetEnergy > 0
                              ? Math.min(100, (r.targetEnergy / Math.max(...rows.map((x) => x.targetEnergy || 1))) * 100)
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                    <span className="tabular-nums w-24 text-right font-mono">{fmtNum(r.targetEnergy, 1)} kWh</span>
                    <Chip tone={r.energyDiff === 0 ? 'green' : 'red'} className="text-[9px] px-1.5 py-0">
                      Δ {r.energyDiff.toFixed(2)}
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <SectionHeader
          title="Reconciliation detail (per batch)"
          description="staging_energy_data (VALID) vs fact_energy_emissions — counts and aggregates with source-to-target deltas"
        />
        {rows.length === 0 ? (
          <EmptyState title="No reconciliation data yet" hint="Run the DAG from the Control Room to produce reconciliation results." />
        ) : (
          <TableShell>
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Batch</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Business date</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Source rows</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Target rows</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Row diff</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Source kWh</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Target kWh</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">kWh diff</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Source CO2e</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Target CO2e</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.batchId} className={r.status !== 'PASS' ? 'bg-red-50/50 dark:bg-red-950/20' : ''}>
                    <TableCell className="font-mono text-[11px]">{r.batchId}</TableCell>
                    <TableCell className="text-xs">{r.businessDate}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{fmtNum(r.sourceCount)}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{fmtNum(r.targetCount)}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">
                      <span className={r.diffRows !== 0 ? 'text-red-600 dark:text-red-400 font-semibold' : ''}>
                        {fmtNum(r.diffRows)}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{fmtNum(r.sourceEnergy, 2)}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{fmtNum(r.targetEnergy, 2)}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{fmtNum(r.energyDiff, 2)}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{fmtNum(r.sourceEmissions, 2)}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{fmtNum(r.targetEmissions, 2)}</TableCell>
                    <TableCell>
                      <Chip tone={r.status === 'PASS' ? 'green' : r.status === 'FAIL' ? 'red' : 'zinc'}>
                        {r.status}
                      </Chip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableShell>
        )}
      </div>
    </div>
  )
}
