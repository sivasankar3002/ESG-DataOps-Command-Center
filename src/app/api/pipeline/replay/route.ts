import { NextResponse } from 'next/server'
import { generateSyntheticData } from '@/lib/esg/datagen'
import { runPipeline } from '@/lib/esg/engine'
import { assertRole, RoleError } from '@/lib/esg/roles-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/pipeline/replay — batch replay / backfill (L1 recovery workflow).
 *
 * Regenerates clean synthetic feeds for a historical business date into the
 * landing zone (data/incoming), then re-runs the 8-task DAG for that date as
 * a NEW append-only batch (B-YYYYMMDD-NN + 1). Existing batches are never
 * modified — this models the "root cause fixed, reload the feed" runbook
 * step an L1 engineer performs after resolving an incident.
 *
 * Body: { businessDate: string (YYYY-MM-DD, required), regenerate?: boolean (default true) }
 */
export async function POST(request: Request) {
  try {
    await assertRole('run.dag')
    const body = (await request.json().catch(() => ({}))) as {
      businessDate?: string
      regenerate?: boolean
    }
    if (!body.businessDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.businessDate)) {
      return NextResponse.json({ error: 'businessDate (YYYY-MM-DD) is required' }, { status: 400 })
    }
    const businessDate = body.businessDate
    const regenerate = body.regenerate !== false

    let regenerated: string[] = []
    if (regenerate) {
      const gen = generateSyntheticData({ businessDate, scenarios: [] })
      regenerated = gen.files.map((f) => f.fileName)
    }

    const result = await runPipeline({ businessDate, trigger: 'replay' })
    return NextResponse.json({ ...result, replayed: true, regeneratedFiles: regenerated })
  } catch (err) {
    if (err instanceof RoleError) {
      return NextResponse.json({ error: err.message, requiredRole: err.required }, { status: err.status })
    }
    console.error('[api/pipeline/replay] failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Replay failed' },
      { status: 500 },
    )
  }
}
