/**
 * =====================================================================
 * API Route: GET /api/analytics/metrics
 * =====================================================================
 *
 * Fetch real performance metrics and data quality KPIs
 * Supports filtering by date range, dataset, task, and metric type
 */

import { NextRequest, NextResponse } from 'next/server'
import { getMetricsCollector } from '@/lib/esg/metrics'

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams
    const metricType = searchParams.get('type') || 'all' // 'all', 'data_quality', 'performance', 'sla'
    const taskFilter = searchParams.get('task')
    const datasetFilter = searchParams.get('dataset')

    const collector = getMetricsCollector()

    let response: any = {
      timestamp: new Date().toISOString(),
      type: metricType,
    }

    if (metricType === 'all' || metricType === 'data_quality') {
      response.dataQualityTrend = collector.getDataQualityTrend(datasetFilter)
    }

    if (metricType === 'all' || metricType === 'performance') {
      response.performanceSummary = collector.getPerformanceSummary(taskFilter)
    }

    if (metricType === 'all' || metricType === 'sla') {
      response.slaStatus = {
        message: 'SLA tracking enabled. Run operations to populate metrics.',
      }
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[api/analytics/metrics] Error:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve metrics', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/analytics/export
 * Export metrics to JSON Lines format (for BI tools, log aggregators)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const format = body.format || 'jsonl' // 'jsonl' or 'json'

    const collector = getMetricsCollector()

    // Export to file system
    collector.exportMetricsToJSONL()
    collector.exportSLAReport()

    return NextResponse.json({
      status: 'success',
      message: 'Metrics exported to logs/metrics_YYYY-MM-DD.jsonl and logs/sla_tracking.json',
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[api/analytics/export] Error:', error)
    return NextResponse.json(
      { error: 'Failed to export metrics', details: String(error) },
      { status: 500 }
    )
  }
}
