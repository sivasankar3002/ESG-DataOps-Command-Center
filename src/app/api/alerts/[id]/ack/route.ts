import { NextResponse } from 'next/server'
import { acknowledgeAlert } from '@/lib/esg/alerts'
import { assertRole, RoleError } from '@/lib/esg/roles-server'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

/** POST /api/alerts/[id]/ack — acknowledge an alert (on-call action). */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    await assertRole('alerts.ack')
    const { id } = await params
    const alertId = parseInt(id, 10)
    if (Number.isNaN(alertId)) {
      return NextResponse.json({ error: 'Invalid alert id' }, { status: 400 })
    }
    const ok = await acknowledgeAlert(alertId)
    if (!ok) return NextResponse.json({ error: 'Alert not found or already acknowledged' }, { status: 404 })
    return NextResponse.json({ message: `Alert ${alertId} acknowledged` })
  } catch (err) {
    if (err instanceof RoleError) {
      return NextResponse.json({ error: err.message, requiredRole: err.required }, { status: err.status })
    }
    console.error('[api/alerts/ack] failed:', err)
    return NextResponse.json({ error: 'Failed to acknowledge alert' }, { status: 500 })
  }
}
