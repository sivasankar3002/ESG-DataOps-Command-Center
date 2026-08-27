import { NextResponse } from 'next/server'
import { seedDemoData } from '@/lib/esg/seed'
import { assertRole, RoleError } from '@/lib/esg/roles-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** POST /api/seed — wipe + seed 14 days of demo operational history. */
export async function POST() {
  try {
    await assertRole('demo.reset')
    const result = await seedDemoData()
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof RoleError) {
      return NextResponse.json({ error: err.message, requiredRole: err.required }, { status: err.status })
    }
    console.error('[api/seed] failed:', err)
    return NextResponse.json({ error: 'Seeding failed' }, { status: 500 })
  }
}
