import { NextResponse } from 'next/server'
import { generateSyntheticData } from '@/lib/esg/datagen'
import { SCENARIOS, type Scenario } from '@/lib/esg/types'
import { assertRole, RoleError } from '@/lib/esg/roles-server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/datagen — synthetic ESG data generator (MODULE 3).
 * Body: { businessDate?: string, scenarios?: Scenario[], siteCount?: number }
 */
export async function POST(request: Request) {
  try {
    await assertRole('datagen.generate')
    const body = (await request.json().catch(() => ({}))) as {
      businessDate?: string
      scenarios?: string[]
      siteCount?: number
    }
    const scenarios = (body.scenarios ?? []).filter((s): s is Scenario =>
      (SCENARIOS as readonly string[]).includes(s),
    )
    const result = generateSyntheticData({
      businessDate: body.businessDate,
      scenarios,
      siteCount: body.siteCount,
    })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof RoleError) {
      return NextResponse.json({ error: err.message, requiredRole: err.required }, { status: err.status })
    }
    console.error('[api/datagen] failed:', err)
    return NextResponse.json({ error: 'Data generation failed' }, { status: 500 })
  }
}
