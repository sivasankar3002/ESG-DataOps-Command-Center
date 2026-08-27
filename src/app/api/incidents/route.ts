import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createIncident } from '@/lib/esg/incidents'
import { emptyEvidenceContext } from '@/lib/esg/evidence'
import { INCIDENT_TYPES, type IncidentSeverity, type IncidentType } from '@/lib/esg/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/incidents — list incidents (ServiceNow-style query API).
 * Query: status, severity, incidentType, limit
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const severity = searchParams.get('severity')
    const incidentType = searchParams.get('incidentType')
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10) || 100, 300)

    const incidents = await db.incidentLog.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(severity ? { severity } : {}),
        ...(incidentType ? { incidentType } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return NextResponse.json({ count: incidents.length, incidents })
  } catch (err) {
    console.error('[api/incidents GET] failed:', err)
    return NextResponse.json({ error: 'Failed to list incidents' }, { status: 500 })
  }
}

/**
 * POST /api/incidents — manually create an incident (L1 console).
 * Body: { incidentType, severity?, shortDescription, detailedDescription?, affectedFile?, ... }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      incidentType?: string
      severity?: string
      shortDescription?: string
      detailedDescription?: string
      affectedFile?: string
      affectedTable?: string
      batchId?: string
    }
    if (!body.incidentType || !(INCIDENT_TYPES as readonly string[]).includes(body.incidentType)) {
      return NextResponse.json(
        { error: `incidentType must be one of: ${INCIDENT_TYPES.join(', ')}` },
        { status: 400 },
      )
    }
    if (!body.shortDescription) {
      return NextResponse.json({ error: 'shortDescription is required' }, { status: 400 })
    }
    const created = await createIncident({
      incidentType: body.incidentType as IncidentType,
      severity: body.severity as IncidentSeverity | undefined,
      shortDescription: body.shortDescription,
      detailedDescription: body.detailedDescription ?? body.shortDescription,
      affectedFile: body.affectedFile ?? null,
      affectedTable: body.affectedTable ?? null,
      batchId: body.batchId ?? null,
      pipelineName: 'manual-console',
      evidenceCtx: emptyEvidenceContext('manual-console', new Date().toISOString().slice(0, 10)),
    })
    return NextResponse.json(created, { status: 201 })
  } catch (err) {
    console.error('[api/incidents POST] failed:', err)
    return NextResponse.json({ error: 'Failed to create incident' }, { status: 500 })
  }
}
