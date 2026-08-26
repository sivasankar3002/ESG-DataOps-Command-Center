import { db } from '@/lib/db'
import { isRole, can, ROLES, type Capability, type Role, OPERATOR_USER_KEY, ROLE_PREF_KEY, DEFAULT_ROLE } from './roles'

// =====================================================================
// Server-side RBAC enforcement for mutating API routes.
//
// The operator's active role lives in the UserPreference store (the
// single source of truth — the header role chip merely reflects it).
// Every mutating route calls assertRole(capability) before touching
// data; a 403 with the required role is returned when the persisted
// role lacks the capability. This mirrors production middleware that
// verifies the caller's role claim from the IdP session, not from
// anything the client sends.
// =====================================================================

export async function getActiveRole(): Promise<string> {
  try {
    const row = await db.userPreference.findUnique({
      where: { userKey_prefKey: { userKey: OPERATOR_USER_KEY, prefKey: ROLE_PREF_KEY } },
    })
    if (row) {
      try {
        const parsed = JSON.parse(row.prefValue) as unknown
        if (isRole(parsed)) return parsed
      } catch {
        // fall through to default
      }
    }
  } catch {
    // preference store unavailable → default (never lock the operator out)
  }
  return DEFAULT_ROLE
}

export class RoleError extends Error {
  readonly status = 403
  readonly required: string
  constructor(capability: Capability, role: string) {
    const required = requiredLabel(capability)
    super(
      `Forbidden — the active operator role (${role}) may not perform "${capability}". ` +
        `Requires ${required} or higher. Switch the role from the header profile menu.`,
    )
    this.required = required
  }
}

function requiredLabel(capability: Capability): string {
  if (!ROLES.L1.capabilities.includes(capability)) return ROLES.L2.label
  return ROLES.L1.label
}

/** Throws RoleError (403) when the persisted operator role lacks the capability. */
export async function assertRole(capability: Capability): Promise<void> {
  const role = await getActiveRole()
  if (!isRole(role) || !can(role, capability)) throw new RoleError(capability, role)
}
