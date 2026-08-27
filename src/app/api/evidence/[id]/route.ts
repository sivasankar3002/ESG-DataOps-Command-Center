import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

/** GET /api/evidence/[id] — fetch an evidence artefact (content + metadata). */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params
    const evidence = await db.incidentEvidence.findUnique({ where: { evidenceId: id } })
    if (!evidence) return NextResponse.json({ error: `Evidence ${id} not found` }, { status: 404 })
    return NextResponse.json({
      evidenceId: evidence.evidenceId,
      incidentId: evidence.incidentId,
      evidenceType: evidence.evidenceType,
      evidencePath: evidence.evidencePath,
      evidenceSummary: evidence.evidenceSummary,
      content: evidence.content,
      createdAt: evidence.createdAt.toISOString(),
    })
  } catch (err) {
    console.error('[api/evidence] failed:', err)
    return NextResponse.json({ error: 'Failed to fetch evidence' }, { status: 500 })
  }
}
