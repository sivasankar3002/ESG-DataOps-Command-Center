import { NextResponse } from 'next/server'
import { getIncidentDetail, addWorkNote } from '@/lib/esg/incidents'
import { db } from '@/lib/db'
import { RUNBOOK_TITLES } from '@/lib/esg/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * POST /api/incidents/[id]/assist — generate a first-level support summary.
 * This stays local and deterministic so the repo does not depend on external AI services.
 * Body: { attachAsWorkNote?: boolean }
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as { attachAsWorkNote?: boolean }

    const detail = await getIncidentDetail(id)
    if (!detail) return NextResponse.json({ error: `Incident ${id} not found` }, { status: 404 })

    const inc = detail.incident
    const runbookId = inc.runbookLink?.match(/RB\d{3}/)?.[0] ?? null
    const runbookTitle = runbookId ? RUNBOOK_TITLES[runbookId] ?? '' : ''

    const failedChecks = await db.dqCheckResult.findMany({
      where: { batchId: inc.batchId ?? '__none__', status: { not: 'PASS' } },
      take: 8,
      orderBy: { executedAt: 'desc' },
    })

    const summary = [
      '## What happened',
      `${inc.shortDescription} for ${inc.pipelineName ?? 'the ESG pipeline'} on batch ${inc.batchId ?? 'n/a'}. The current incident is ${inc.severity} severity and is in ${inc.status.toLowerCase()} status.`,
      '',
      '## Business impact',
      `This issue affects ${inc.affectedTable ?? 'the upstream data flow'} and ${inc.affectedFile ?? 'the scheduled batch'}; it can delay warehouse updates, reporting accuracy, or SLA compliance for ESG metrics.`,
      '',
      '## First-level checks already done',
      `- Confirmed the incident context: ${inc.affectedCheck ?? 'pipeline stage validation'}.
- Reviewed the relevant batch and run metadata: ${inc.runId ?? 'n/a'}.
- Checked the file / table impact: ${inc.affectedFile ?? 'n/a'} / ${inc.affectedTable ?? 'n/a'}.
- Reviewed the runbook reference: ${runbookId ?? 'n/a'} ${runbookTitle}.`,
      '',
      '## Most likely root causes',
      failedChecks.length > 0
        ? failedChecks.slice(0, 3).map((c) => `- ${c.checkName}: ${c.errorDetails ?? c.status}`).join('\n')
        : '- No failed DQ checks were recorded for this batch; the issue is likely tied to file arrival, record quality, or downstream stage execution.',
      '',
      '## Recommended next steps',
      '- Validate file arrival, checksum, and manifest agreement for the affected business date.\n- Review the staging and warehouse rows for the impacted table and compare counts to the expected reconciliation baseline.\n- Confirm whether the data issue is isolated to one file or whether a wider batch failure requires follow-up escalation.\n- Record a clear resolution note once the fix is confirmed and re-run the impacted checks.',
      '',
      '## Escalate if',
      '- The same issue recurs across batches or across more than one site.\n- A warehouse load or reconciliation mismatch persists after the fix.\n- SLA countdown is near expiry or the incident is already past the escalation threshold.',
    ].join('\n')

    if (body.attachAsWorkNote) {
      await addWorkNote(id, `First-level support summary:\n\n${summary}`, 'l1-copilot')
    }

    return NextResponse.json({ incidentId: id, summary, attachedAsWorkNote: Boolean(body.attachAsWorkNote) })
  } catch (err) {
    console.error('[api/incidents/assist] failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Support summary failed' },
      { status: 500 },
    )
  }
}
