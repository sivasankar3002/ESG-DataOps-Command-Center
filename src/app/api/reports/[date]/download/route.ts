import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ date: string }>
}

/** GET /api/reports/[date]/download?format=md|csv — download report artefact. */
export async function GET(request: Request, { params }: RouteParams) {
  const { date } = await params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }
  const report = await db.dailyOpsReport.findUnique({ where: { reportDate: date } })
  if (!report) return NextResponse.json({ error: `No report for ${date}` }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const format = (searchParams.get('format') ?? 'md').toLowerCase()

  if (format === 'csv') {
    return new NextResponse(report.csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="daily_ops_report_${date}.csv"`,
      },
    })
  }
  return new NextResponse(report.markdownContent, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="daily_ops_report_${date}.md"`,
    },
  })
}
