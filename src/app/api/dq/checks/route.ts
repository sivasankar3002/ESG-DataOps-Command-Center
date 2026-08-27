import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadConfig } from '@/lib/esg/config'
import { CHECK_DESCRIPTIONS, RUNBOOK_MAP, RUNBOOK_TITLES } from '@/lib/esg/types'
import type { IncidentType } from '@/lib/esg/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/dq/checks?checkName=<name>&limit=<n>
 *
 * Returns the rule definition + recent execution history for one
 * YAML-configured DQ check — the L1 triage surface behind the DQ tab's
 * check detail drawer. Combines:
 *   - the rule config from config/data_quality_rules.yaml (category,
 *     severity, incidentType, createIncident)
 *   - a human-readable description (CHECK_DESCRIPTIONS)
 *   - the latest dq_check_results rows for this check name across all
 *     batches (status, expected/actual/threshold, table.column,
 *     errorDetails, batchId, businessDate, executedAt).
 *     `limit` defaults to 8, clamped to 1..50 (the drawer fetches 50 and
 *     shows 8 with a "show all" toggle).
 *   - the runbook link (RUNBOOK_MAP by incidentType) when the check
 *     auto-raises incidents
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const checkName = url.searchParams.get('checkName')
    if (!checkName) {
      return NextResponse.json(
        { error: 'checkName query parameter is required' },
        { status: 400 },
      )
    }
    const limitRaw = Number(url.searchParams.get('limit') ?? '8')
    const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, Math.floor(limitRaw))) : 8

    const config = loadConfig()
    const rule = config.rules.checks[checkName] ?? null

    // Latest executions of this check (most recent first).
    const recent = await db.dqCheckResult.findMany({
      where: { checkName },
      orderBy: { executedAt: 'desc' },
      take: limit,
    })

    const incidentType = (rule?.incidentType ?? null) as IncidentType | null
    const runbookId = incidentType ? RUNBOOK_MAP[incidentType] : null
    const runbookSlug = runbookId
      ? RUNBOOK_TITLES[runbookId]?.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '')
      : ''

    return NextResponse.json({
      checkName,
      description: CHECK_DESCRIPTIONS[checkName] ?? 'No description available for this check.',
      rule: rule
        ? {
            category: rule.category,
            severity: rule.severity,
            incidentType: rule.incidentType,
            createIncident: rule.createIncident,
          }
        : null,
      runbook: runbookId
        ? {
            id: runbookId,
            title: RUNBOOK_TITLES[runbookId] ?? '',
            file: `docs/runbooks/${runbookId}_${runbookSlug}.md`,
          }
        : null,
      trend: {
        examined: recent.length,
        pass: recent.filter((r) => r.status === 'PASS').length,
        fail: recent.filter((r) => r.status === 'FAIL').length,
        warn: recent.filter((r) => r.status === 'WARN').length,
      },
      recent: recent.map((r) => ({
        checkId: r.checkId,
        batchId: r.batchId,
        businessDate: r.businessDate,
        status: r.status,
        severity: r.severity,
        tableName: r.tableName,
        columnName: r.columnName,
        expectedValue: r.expectedValue,
        actualValue: r.actualValue,
        thresholdValue: r.thresholdValue,
        errorDetails: r.errorDetails,
        executedAt: r.executedAt.toISOString(),
      })),
    })
  } catch (err) {
    console.error('[api/dq/checks] failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load check details' },
      { status: 500 },
    )
  }
}
