import { NextResponse } from 'next/server'
import { getDashboardState } from '@/lib/esg/dashboard'

export const dynamic = 'force-dynamic'

/** GET /api/state — full dashboard payload for the operational UI. */
export async function GET() {
  try {
    const state = await getDashboardState()
    return NextResponse.json(state)
  } catch (err) {
    console.error('[api/state] failed:', err)
    return NextResponse.json({ error: 'Failed to assemble dashboard state' }, { status: 500 })
  }
}
