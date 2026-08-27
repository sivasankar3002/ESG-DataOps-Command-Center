import { NextResponse } from 'next/server'
import { runPipeline } from '@/lib/esg/engine'
import { assertRole, RoleError } from '@/lib/esg/roles-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/pipeline/run — run the esg_daily_ingestion DAG.
 * Body: { businessDate?: string }  (defaults to today)
 */
export async function POST(request: Request) {
  try {
    await assertRole('run.dag')
    const body = (await request.json().catch(() => ({}))) as { businessDate?: string }
    if (body.businessDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.businessDate)) {
      return NextResponse.json({ error: 'businessDate must be YYYY-MM-DD' }, { status: 400 })
    }
    const result = await runPipeline({ businessDate: body.businessDate, trigger: 'manual' })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof RoleError) {
      return NextResponse.json({ error: err.message, requiredRole: err.required }, { status: err.status })
    }
    console.error('[api/pipeline/run] failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Pipeline run failed' },
      { status: 500 },
    )
  }
}
