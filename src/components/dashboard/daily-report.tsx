'use client'

// =====================================================================
// Tab: Daily Report — operational summary (md + csv) with downloads
// =====================================================================

import { useCallback, useEffect, useState } from 'react'
import { Download, FileSpreadsheet, FileText, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { DashboardState } from '@/lib/esg/dashboard'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Chip, EmptyState, HealthChip, SectionHeader, TableShell } from './shared'

interface ReportPayload {
  reportDate: string
  filesExpected: number
  filesReceived: number
  filesQuarantined: number
  jobsExecuted: number
  jobsSucceeded: number
  jobsFailed: number
  dqChecksExecuted: number
  dqChecksPassed: number
  dqChecksFailed: number
  openIncidents: number
  p1Incidents: number
  p2Incidents: number
  reconciliationStatus: string
  overallHealth: string
  markdownContent: string
  csvContent: string
}

export function DailyReportTab({ state }: { state: DashboardState }) {
  const [report, setReport] = useState<ReportPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [dateInput, setDateInput] = useState(state.today)

  const loadReport = useCallback(async (date: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/reports?date=${date}`)
      if (res.ok) setReport((await res.json()) as ReportPayload)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const initial = state.reports[0]?.reportDate ?? state.today
    setDateInput(initial)
    void loadReport(initial)
  }, [])

  const generate = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      toast.error('Date must be YYYY-MM-DD')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateInput }),
      })
      if (res.ok) {
        toast.success(`Report generated for ${dateInput}`)
        await loadReport(dateInput)
      } else {
        toast.error('Failed to generate report')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
            Business date
          </label>
          <Input
            type="date"
            value={dateInput}
            onChange={(e) => setDateInput(e.target.value)}
            className="h-8 w-40 text-xs bg-background"
          />
        </div>
        <Button size="sm" className="h-8" onClick={generate} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Generate / refresh report
        </Button>
        {report ? (
          <div className="flex gap-2 ml-auto">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-[11px] font-medium tracking-wide hover:bg-emerald-50 dark:hover:bg-emerald-950 hover:border-emerald-300 dark:hover:border-emerald-800"
              asChild
            >
              <a href={`/api/reports/${report.reportDate}/download?format=md`} download>
                <FileText className="h-3.5 w-3.5" /> .md
              </a>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-[11px] font-medium tracking-wide hover:bg-emerald-50 dark:hover:bg-emerald-950 hover:border-emerald-300 dark:hover:border-emerald-800"
              asChild
            >
              <a href={`/api/reports/${report.reportDate}/download?format=csv`} download>
                <FileSpreadsheet className="h-3.5 w-3.5" /> .csv
              </a>
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* ---- report viewer ---- */}
        <Card className="xl:col-span-2">
          <CardHeader className="pb-0 pt-4 px-4 flex-row items-center gap-2">
            <CardTitle className="text-sm font-medium">
              Daily operations report {report ? `— ${report.reportDate}` : ''}
            </CardTitle>
            {report ? <HealthChip status={report.overallHealth} /> : null}
          </CardHeader>
          <CardContent className="px-2 pb-2">
            {loading && !report ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : report ? (
              <ScrollArea className="h-[520px]">
                <div className="px-4 py-2">
                  <article className="prose prose-sm max-w-none dark:prose-invert prose-h1:text-base prose-h1:mb-2 prose-h2:text-sm prose-h2:mt-4 prose-p:my-1.5 prose-table:text-xs prose-th:py-1 prose-td:py-1">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.markdownContent}</ReactMarkdown>
                  </article>
                </div>
              </ScrollArea>
            ) : (
              <EmptyState title="No report for this date" hint="Generate one above." />
            )}
          </CardContent>
        </Card>

        {/* ---- report history ---- */}
        <div>
          <SectionHeader
            title="Report history"
            description="Persisted in reports/ + daily_ops_report table"
          />
          {state.reports.length === 0 ? (
            <EmptyState title="No reports generated yet" />
          ) : (
            <TableShell className="max-h-[520px]">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Date</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Health</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Files</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Jobs</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">DQ fail</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Incidents</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.reports.map((r) => (
                    <TableRow
                      key={r.reportDate}
                      className={cn(
                        'cursor-pointer',
                        report?.reportDate === r.reportDate && 'bg-emerald-50/60 dark:bg-emerald-950/30',
                      )}
                      onClick={() => {
                        setDateInput(r.reportDate)
                        void loadReport(r.reportDate)
                      }}
                    >
                      <TableCell className="font-mono text-[11px]">{r.reportDate}</TableCell>
                      <TableCell>
                        <HealthChip status={r.overallHealth} />
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums">
                        <span title={`${r.filesReceived} file(s) received`}>{r.filesReceived}</span>
                        {r.filesQuarantined > 0 ? (
                          <span
                            className="text-red-600 dark:text-red-400"
                            title={`${r.filesQuarantined} file(s) quarantined — failed validation and routed to data/quarantine/`}
                          >
                            {' '}
                            ({r.filesQuarantined}q)
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums">
                        {r.jobsSucceeded}/{r.jobsSucceeded + r.jobsFailed}
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums">
                        <span className={r.dqChecksFailed > 0 ? 'text-red-600 dark:text-red-400' : ''}>
                          {r.dqChecksFailed}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums">
                        <span
                          className={
                            r.openIncidents > 0 ? 'text-amber-600 dark:text-amber-400 font-medium' : ''
                          }
                        >
                          {r.openIncidents}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableShell>
          )}
          <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1.5">
            <Download className="h-3 w-3" />
            Reports are written to reports/daily_ops_report_YYYY-MM-DD (.md and .csv) on the server.
          </p>
        </div>
      </div>
    </div>
  )
}
