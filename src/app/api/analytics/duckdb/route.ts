/**
 * =====================================================================
 * API Route: GET /api/analytics/duckdb
 * =====================================================================
 *
 * Execute DuckDB analytical queries for:
 * - Data quality metrics with trends
 * - Source-to-target reconciliation
 * - Time-series analysis and anomaly detection
 * - Export CSV for BI tools
 */

import { NextRequest, NextResponse } from 'next/server'
import duckdb from '@/lib/db-duckdb'

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams
    const queryType = searchParams.get('type') || 'health' // 'health', 'quality', 'reconcile', 'timeseries', 'anomalies'
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0]
    const dataset = searchParams.get('dataset')
    const threshold = parseFloat(searchParams.get('threshold') || '1.5')

    let result: any = {
      timestamp: new Date().toISOString(),
      queryType,
      date,
    }

    // Health check
    const health = await duckdb.healthCheck()
    if (health.status !== 'ok') {
      return NextResponse.json(
        {
          status: 'unavailable',
          message: 'DuckDB analytics layer not available',
          details: health,
          fallback: 'Falling back to Prisma ORM for operational queries',
        },
        { status: 200 } // 200 because the app still functions without DuckDB
      )
    }

    // Execute requested analysis
    if (queryType === 'health' || queryType === 'quality') {
      result.dataQualityMetrics = await duckdb.getDataQualityMetrics(date)
    }

    if (queryType === 'health' || queryType === 'reconcile') {
      result.reconciliation = await duckdb.reconcile(date)
    }

    if (queryType === 'health' || queryType === 'timeseries') {
      const startDate = new Date(date)
      startDate.setDate(startDate.getDate() - 7)
      const endDate = new Date(date)

      result.timeSeries = await duckdb.getTimeSeries(
        dataset || 'energy_consumption',
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0]
      )
    }

    if (queryType === 'health' || queryType === 'anomalies') {
      result.anomalies = await duckdb.detectAnomalies(date, threshold)
    }

    return NextResponse.json({
      status: 'success',
      duckdbStatus: health,
      data: result,
    })
  } catch (error) {
    console.error('[api/analytics/duckdb] Error:', error)
    return NextResponse.json(
      {
        status: 'error',
        message: 'DuckDB query failed',
        details: String(error),
        fallback: 'Use Prisma API for operational data',
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/analytics/duckdb
 * Export DuckDB query results to CSV
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { query, outputPath } = body

    if (!query) {
      return NextResponse.json(
        { error: 'Query parameter is required' },
        { status: 400 }
      )
    }

    await duckdb.exportQueryToCSV(query, outputPath || 'exports/query_result.csv')

    return NextResponse.json({
      status: 'success',
      message: `Query exported to CSV`,
      outputPath: outputPath || 'exports/query_result.csv',
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[api/analytics/duckdb] Export error:', error)
    return NextResponse.json(
      { error: 'Failed to export query', details: String(error) },
      { status: 500 }
    )
  }
}
