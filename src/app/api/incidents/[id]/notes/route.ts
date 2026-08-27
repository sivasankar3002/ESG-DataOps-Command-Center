import { NextResponse } from 'next/server'
import { addWorkNote } from '@/lib/esg/incidents'
import { assertRole, RoleError } from '@/lib/esg/roles-server'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

/** POST /api/incidents/[id]/notes — add a ServiceNow-style work note. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    await assertRole('incidents.mutate')
    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as { note?: string; author?: string }
    if (!body.note || body.note.trim() === '') {
      return NextResponse.json({ error: 'note is required' }, { status: 400 })
    }
    const ok = await addWorkNote(id, body.note.trim(), body.author ?? 'L1 Support')
    if (!ok) return NextResponse.json({ error: `Incident ${id} not found` }, { status: 404 })
    return NextResponse.json({ message: 'Work note added' }, { status: 201 })
  } catch (err) {
    if (err instanceof RoleError) {
      return NextResponse.json({ error: err.message, requiredRole: err.required }, { status: err.status })
    }
    console.error('[api/incidents/notes POST] failed:', err)
    return NextResponse.json({ error: 'Failed to add work note' }, { status: 500 })
  }
}
