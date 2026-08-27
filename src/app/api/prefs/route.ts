import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isRole, ROLE_PREF_KEY } from '@/lib/esg/roles'

export const dynamic = 'force-dynamic'

// =====================================================================
// /api/prefs — server-side operator preference store (UserPreference).
// The production stand-in for per-user profile storage: alert
// subscription matrices and other operator prefs survive browser
// changes instead of living only in localStorage.
//
//   GET  /api/prefs?key=alert.subscriptions  → { key, value | null }
//   PUT  /api/prefs  { key, value }          → upsert (value: any JSON)
//
// Keys: alert.subscriptions (per-type/severity mute matrix) and
// operator.role (VIEWER | L1 | L2 — the RBAC source of truth enforced
// by every mutating route via roles-server.assertRole).
// =====================================================================

const USER_KEY = 'local-operator'
const ALLOWED_KEYS = new Set(['alert.subscriptions', ROLE_PREF_KEY])
const MAX_VALUE_BYTES = 16 * 1024 // generous guard for a pref blob

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key') ?? ''
  if (!ALLOWED_KEYS.has(key)) {
    return NextResponse.json({ error: `Unknown preference key "${key}"` }, { status: 400 })
  }
  try {
    const row = await db.userPreference.findUnique({
      where: { userKey_prefKey: { userKey: USER_KEY, prefKey: key } },
    })
    let value: unknown = null
    if (row) {
      try {
        value = JSON.parse(row.prefValue)
      } catch {
        value = null
      }
    }
    return NextResponse.json({
      key,
      value,
      updatedAt: row?.updatedAt ?? null,
    })
  } catch (err) {
    console.error('[api/prefs] GET failed:', err)
    return NextResponse.json({ error: 'Failed to load preferences' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  let body: { key?: unknown; value?: unknown }
  try {
    body = (await req.json()) as { key?: unknown; value?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const key = typeof body.key === 'string' ? body.key : ''
  if (!ALLOWED_KEYS.has(key)) {
    return NextResponse.json({ error: `Unknown preference key "${String(body.key)}"` }, { status: 400 })
  }
  if (body.value === undefined) {
    return NextResponse.json({ error: 'Missing "value"' }, { status: 400 })
  }
  const serialized = JSON.stringify(body.value)
  if (serialized.length > MAX_VALUE_BYTES) {
    return NextResponse.json({ error: 'Preference value too large' }, { status: 413 })
  }
  if (key === ROLE_PREF_KEY && !isRole(body.value)) {
    return NextResponse.json(
      { error: 'operator.role must be one of VIEWER | L1 | L2' },
      { status: 400 },
    )
  }
  try {
    const row = await db.userPreference.upsert({
      where: { userKey_prefKey: { userKey: USER_KEY, prefKey: key } },
      create: { userKey: USER_KEY, prefKey: key, prefValue: serialized },
      update: { prefValue: serialized },
    })
    return NextResponse.json({ key, updatedAt: row.updatedAt })
  } catch (err) {
    console.error('[api/prefs] PUT failed:', err)
    return NextResponse.json({ error: 'Failed to save preferences' }, { status: 500 })
  }
}
