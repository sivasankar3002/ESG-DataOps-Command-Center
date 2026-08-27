import { NextResponse } from 'next/server'
import { getIncidentDetail, updateIncident } from '@/lib/esg/incidents'
import type { IncidentStatus } from '@/lib/esg/types'
import { assertRole, RoleError } from '@/lib/esg/roles-server'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

/** GET /api/incidents/[id] — full incident record + work notes + evidence. */
export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const detail = await getIncidentDetail(id)
  if (!detail) return NextResponse.json({ error: `Incident ${id} not found` }, { status: 404 })
  return NextResponse.json(detail)
}

/**
 * PATCH /api/incidents/[id] — ServiceNow-style update.
 * Body: { status?, assignedTo?, resolutionNotes?, escalate?, author? }
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    await assertRole('incidents.mutate')
    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as {
      status?: string
      assignedTo?: string
      resolutionNotes?: string
      escalate?: boolean
      author?: string
    }
    const result = await updateIncident(id, {
      status: body.status as IncidentStatus | undefined,
      assignedTo: body.assignedTo,
      resolutionNotes: body.resolutionNotes,
      escalate: body.escalate,
      author: body.author,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    const detail = await getIncidentDetail(id)
    return NextResponse.json(detail)
  } catch (err) {
    if (err instanceof RoleError) {
      return NextResponse.json({ error: err.message, requiredRole: err.required }, { status: err.status })
    }
    console.error('[api/incidents PATCH] failed:', err)
    return NextResponse.json({ error: 'Failed to update incident' }, { status: 500 })
  }
}
