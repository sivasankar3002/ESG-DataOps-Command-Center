import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateDailyReport } from '@/lib/esg/reporting'

export const dynamic = 'force-dynamic'

/** GET /api/reports?date=YYYY-MM-DD — report content (generates if missing). */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
    }
    let report = await db.dailyOpsReport.findUnique({ where: { reportDate: date } })
    if (!report) {
      const stats = await generateDailyReport(date)
      report = await db.dailyOpsReport.findUnique({ where: { reportDate: date } })
      if (!report) return NextResponse.json({ error: 'Report generation failed' }, { status: 500 })
      void stats
    }
    return NextResponse.json({
      reportDate: report.reportDate,
      filesExpected: report.filesExpected,
      filesReceived: report.filesReceived,
      filesQuarantined: report.filesQuarantined,
      jobsExecuted: report.jobsExecuted,
      jobsSucceeded: report.jobsSucceeded,
      jobsFailed: report.jobsFailed,
      dqChecksExecuted: report.dqChecksExecuted,
      dqChecksPassed: report.dqChecksPassed,
      dqChecksFailed: report.dqChecksFailed,
      openIncidents: report.openIncidents,
      p1Incidents: report.p1Incidents,
      p2Incidents: report.p2Incidents,
      reconciliationStatus: report.reconciliationStatus,
      overallHealth: report.overallHealth,
      markdownContent: report.markdownContent,
      csvContent: report.csvContent,
      createdAt: report.createdAt.toISOString(),
    })
  } catch (err) {
    console.error('[api/reports GET] failed:', err)
    return NextResponse.json({ error: 'Failed to load report' }, { status: 500 })
  }
}

/** POST /api/reports — (re)generate the daily ops report. Body: { date } */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { date?: string }
    const date = body.date ?? new Date().toISOString().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
    }
    const stats = await generateDailyReport(date)
    return NextResponse.json(stats)
  } catch (err) {
    console.error('[api/reports POST] failed:', err)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}
