import { NextResponse } from 'next/server'
import { acknowledgeAllAlerts } from '@/lib/esg/alerts'
import { assertRole, RoleError } from '@/lib/esg/roles-server'

export const dynamic = 'force-dynamic'

/** POST /api/alerts/ack-all — bulk-acknowledge every open alert (shift handover). */
export async function POST() {
  try {
    await assertRole('alerts.ack')
    const count = await acknowledgeAllAlerts()
    return NextResponse.json({ message: `${count} alert(s) acknowledged`, count })
  } catch (err) {
    if (err instanceof RoleError) {
      return NextResponse.json({ error: err.message, requiredRole: err.required }, { status: err.status })
    }
    console.error('[api/alerts/ack-all] failed:', err)
    return NextResponse.json({ error: 'Failed to acknowledge alerts' }, { status: 500 })
  }
}
