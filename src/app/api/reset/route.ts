import { NextResponse } from 'next/server'
import { wipeAll } from '@/lib/esg/seed'
import { assertRole, RoleError } from '@/lib/esg/roles-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** POST /api/reset — wipe all operational data and landing zones. */
export async function POST() {
  try {
    await assertRole('demo.reset')
    await wipeAll()
    return NextResponse.json({ message: 'All operational data and files wiped.' })
  } catch (err) {
    if (err instanceof RoleError) {
      return NextResponse.json({ error: err.message, requiredRole: err.required }, { status: err.status })
    }
    console.error('[api/reset] failed:', err)
    return NextResponse.json({ error: 'Reset failed' }, { status: 500 })
  }
}
