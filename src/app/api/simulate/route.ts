import { NextResponse } from 'next/server'
import { runSimulation, SIMULATION_KEYS, type SimulationKey } from '@/lib/esg/simulate'
import { assertRole, RoleError } from '@/lib/esg/roles-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/simulate — run a failure simulation end-to-end
 * (create the condition, run the DAG, verify the incident).
 * Body: { scenario: SimulationKey }
 */
export async function POST(request: Request) {
  try {
    await assertRole('simulate.run')
    const body = (await request.json().catch(() => ({}))) as { scenario?: string }
    const scenario = body.scenario as SimulationKey | undefined
    if (!scenario || !(SIMULATION_KEYS as readonly string[]).includes(scenario)) {
      return NextResponse.json(
        { error: `scenario must be one of: ${SIMULATION_KEYS.join(', ')}` },
        { status: 400 },
      )
    }
    const result = await runSimulation(scenario)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof RoleError) {
      return NextResponse.json({ error: err.message, requiredRole: err.required }, { status: err.status })
    }
    console.error('[api/simulate] failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Simulation failed' },
      { status: 500 },
    )
  }
}
