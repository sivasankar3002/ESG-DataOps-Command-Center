/**
 * =====================================================================
 * API Route: POST /api/analytics/transformations
 * =====================================================================
 *
 * Execute and test real dbt-style data transformations:
 * - Raw to Staging (validation, cleansing)
 * - Staging to Enrichment (dimension joins)
 * - Enrichment to Fact (incremental load)
 * - Fact to Mart (aggregations)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getMetricsCollector } from '@/lib/esg/metrics'
import transformations from '@/lib/esg/transformations'
import type { PipelineContext } from '@/lib/esg/context'

// Mock PipelineContext for API calls
function createMockContext(batchId: string): PipelineContext {
  return {
    batchId,
    currentRunId: `RUN-${Date.now()}`,
    businessDate: new Date(),
    asOf: new Date(),
    dagId: 'esg_daily_ingestion',
    dqResults: [],
    logger: {
      info: (module: string, message: string) => console.log(`[${module}] ${message}`),
      warn: (module: string, message: string) => console.warn(`[${module}] ${message}`),
      error: (module: string, message: string) => console.error(`[${module}] ${message}`),
      debug: (module: string, message: string) => console.debug(`[${module}] ${message}`),
      buffer: () => [],
      render: () => '',
    },
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      transformationType, // 'staging', 'enrichment', 'fact', 'mart', 'all'
      dataset = 'energy_consumption',
      sourceData = [],
      sourceFileName = 'sample_data.csv',
      batchId = `BATCH-${Date.now()}`,
    } = body

    if (!transformationType) {
      return NextResponse.json(
        { error: 'transformationType is required (staging|enrichment|fact|mart|all)' },
        { status: 400 }
      )
    }

    const ctx = createMockContext(batchId)
    const results: any[] = []

    try {
      // Stage 1: Raw to Staging
      if (transformationType === 'staging' || transformationType === 'all') {
        const stagingResult = await transformations.transformRawToStaging(
          ctx,
          sourceData,
          dataset,
          sourceFileName
        )
        results.push({
          stage: 'staging',
          ...stagingResult,
        })
      }

      // Stage 2: Enrichment
      if (transformationType === 'enrichment' || transformationType === 'all') {
        const enrichmentResult = await transformations.enrichStagingData(ctx, dataset, batchId)
        results.push({
          stage: 'enrichment',
          ...enrichmentResult,
        })
      }

      // Stage 3: Fact Load
      if (transformationType === 'fact' || transformationType === 'all') {
        const factResult = await transformations.loadFactTables(ctx, dataset, batchId)
        results.push({
          stage: 'fact',
          ...factResult,
        })
      }

      // Stage 4: Mart Creation
      if (transformationType === 'mart' || transformationType === 'all') {
        const martResult = await transformations.createAnalyticsMarts(ctx, batchId)
        results.push({
          stage: 'mart',
          ...martResult,
        })
      }

      // Export metrics
      const metrics = getMetricsCollector()
      metrics.exportMetricsToJSONL()
      metrics.exportSLAReport()

      return NextResponse.json({
        status: 'success',
        batchId,
        dataset,
        transformationType,
        stages: results,
        summary: {
          totalStages: results.length,
          totalRecordsProcessed: results.reduce((sum, r) => sum + r.recordsRead, 0),
          totalRecordsRejected: results.reduce((sum, r) => sum + r.recordsRejected, 0),
          totalDurationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
        },
        metricsExported: {
          metrics: 'logs/metrics_YYYY-MM-DD.jsonl',
          slaTracking: 'logs/sla_tracking.json',
        },
        timestamp: new Date().toISOString(),
      })
    } catch (error) {
      return NextResponse.json(
        {
          status: 'error',
          message: 'Transformation pipeline failed',
          error: String(error),
          completedStages: results,
        },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('[api/analytics/transformations] Error:', error)
    return NextResponse.json(
      { error: 'Failed to process request', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * GET /api/analytics/transformations/lineage
 * Trace data lineage for a specific record through all transformations
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams
    const recordId = searchParams.get('recordId') || 'SRC-sample_data.csv-0'

    // Simulate transformation chain
    const lineage = transformations.traceRecordLineage(recordId, [])

    return NextResponse.json({
      status: 'success',
      recordId,
      lineage: {
        path: lineage.path,
        transformationChain: lineage.transformationChain,
        stageCount: lineage.path.length,
      },
      description: 'This record traveled through the transformation pipeline: ' +
        lineage.transformationChain.join(' → '),
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[api/analytics/transformations/lineage] Error:', error)
    return NextResponse.json(
      { error: 'Failed to trace lineage', details: String(error) },
      { status: 500 }
    )
  }
}
