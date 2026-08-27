import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getDashboardState } from '@/lib/esg/dashboard'
import { RUNBOOK_MAP, RUNBOOK_TITLES } from '@/lib/esg/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/shift-handover — generate a shift handover summary from the live dashboard state.
 */
export async function POST() {
  try {
    const state = await getDashboardState()
    const now = new Date()
    const since24h = new Date(now.getTime() - 24 * 3600 * 1000)

    const lastBatches = await db.jobRunAudit.groupBy({
      by: ['batchId', 'status'],
      where: { startTime: { gte: since24h } },
      _count: { _all: true },
    })
    const batchIds24h = [...new Set(lastBatches.map((r) => r.batchId))]
    const batchesFailed = new Set(
      lastBatches.filter((r) => r.status === 'FAILED').map((r) => r.batchId),
    )
    const batches24h = batchIds24h.map((batchId) => ({
      batchId,
      status: batchesFailed.has(batchId) ? 'FAILED' : 'SUCCESS',
    }))

    const activeIncidents = state.incidents
      .filter((i) => i.status === 'OPEN' || i.status === 'IN_PROGRESS')
      .map((i) => {
        const rbId = i.runbookLink?.match(/RB\d{3}/)?.[0] ?? null
        return `- ${i.incidentId} [${i.severity}] ${i.incidentType.replace(/_/g, ' ')} — ${i.status.replace(/_/g, ' ')}${i.escalatedFlag ? ' (ESCALATED)' : ''} — age ${i.ageMinutes}m — batch ${i.batchId ?? 'n/a'} — runbook ${rbId ?? 'n/a'}${rbId ? ` (${RUNBOOK_TITLES[rbId] ?? ''})` : ''} — ${i.shortDescription}`
      })

    const alertsTotal = state.alerts.length
    const alertsUnacked = state.alerts.filter((a) => !a.acknowledgedFlag).length
    const alertsBySeverity: Record<string, number> = {}
    for (const a of state.alerts) {
      alertsBySeverity[a.severity] = (alertsBySeverity[a.severity] ?? 0) + 1
    }

    const summary = [
      '## Shift summary',
      `The ${state.health.status} pipeline status indicates ${state.health.reasons.join(' · ') || 'normal operational conditions'}. The key item to watch is ${state.health.lastBatchId ?? 'the next scheduled batch'} and any open SLA-sensitive incidents that could affect file arrival, warehouse reconciliation, or report accuracy.`,
      '',
      '## Open incidents',
      activeIncidents.length > 0 ? activeIncidents.join('\n') : 'No open incidents currently require handover attention.',
      '',
      '## What happened on the last shift',
      `Last 24h batches: ${batches24h.map((b) => `${b.batchId} (${b.status})`).join(', ') || 'no data'}. Alerts: ${alertsTotal} total, ${alertsUnacked} unacknowledged. DQ summary: ${state.dq.summary.executed} executed, ${state.dq.summary.failed} failed, ${state.dq.summary.warn} warnings.`,
      '',
      '## What to watch / handover items',
      '- Validate file arrival and checksum agreement for the next scheduled feed.\n- Monitor open incidents for SLA countdown and escalation status.\n- Watch reconciliation counts and site-level drift for the latest warehouse load.\n- Confirm any quarantine or row-level data quality issues have been reviewed before the next batch.',
      '',
      '## Escalation contacts',
      'P1 immediate escalation; P2 auto-escalates after 240 minutes; P3 next business day; assignment group: Data Engineering L2.',
    ].join('\n')

    return NextResponse.json({
      summary,
      generatedAt: now.toISOString(),
      context: {
        health: state.health,
        activeIncidents: activeIncidents.length,
        batches24h: batchIds24h.length,
        alertsTotal,
        alertsUnacked,
        dqSummary: state.dq.summary,
        alertBreakdown: alertsBySeverity,
      },
    })
  } catch (err) {
    console.error('[api/shift-handover] failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Shift handover generation failed' },
      { status: 500 },
    )
  }
}
