// =====================================================================
// ESG DataOps Command Center — operator roles & capabilities (RBAC).
//
// The production stand-in for role-based access control: three operator
// roles gate every mutating action in the dashboard AND every mutating
// API route (see src/lib/esg/roles-server.ts). The active role is
// persisted server-side in the UserPreference store (key
// "operator.role") so it survives browser changes, exactly like a
// server-side profile would. In production this module would be backed
// by the IdP (SSO group -> role claim) and enforced by middleware —
// the capability map below is the single source of truth either way.
// =====================================================================

export const OPERATOR_USER_KEY = 'local-operator'

export type Role = 'VIEWER' | 'L1' | 'L2'

export type Capability =
  | 'run.dag' // execute the DAG (pipeline/run, pipeline/replay)
  | 'datagen.generate' // generate synthetic feeds
  | 'simulate.run' // failure simulations
  | 'incidents.mutate' // status transitions + work notes
  | 'alerts.ack' // acknowledge alerts
  | 'prefs.edit' // edit alert subscriptions
  | 'demo.reset' // destructive: seed / reset all data

export interface RoleDef {
  id: Role
  label: string
  short: string
  description: string
  /** Who this role models, for the role switcher UI. */
  models: string
  capabilities: Capability[]
}

export const ROLE_ORDER: Role[] = ['VIEWER', 'L1', 'L2']

export const ROLES: Record<Role, RoleDef> = {
  VIEWER: {
    id: 'VIEWER',
    label: 'Viewer',
    short: 'VIEW',
    description: 'Read-only — every tab, every export, no mutations.',
    models: 'Stakeholders & auditors reviewing pipeline health.',
    capabilities: [],
  },
  L1: {
    id: 'L1',
    label: 'L1 Operator',
    short: 'L1',
    description: 'Full triage — run the DAG, work incidents, ack alerts, simulations.',
    models: 'First-level support on shift (the platform\u2019s primary persona).',
    capabilities: [
      'run.dag',
      'datagen.generate',
      'simulate.run',
      'incidents.mutate',
      'alerts.ack',
      'prefs.edit',
    ],
  },
  L2: {
    id: 'L2',
    label: 'L2 Engineer',
    short: 'L2',
    description: 'Everything an L1 can do plus destructive demo-data controls.',
    models: 'Data platform engineers owning the pipeline (seed/reset).',
    capabilities: [
      'run.dag',
      'datagen.generate',
      'simulate.run',
      'incidents.mutate',
      'alerts.ack',
      'prefs.edit',
      'demo.reset',
    ],
  },
}

export const DEFAULT_ROLE: Role = 'L1'
export const ROLE_PREF_KEY = 'operator.role'

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLE_ORDER as string[]).includes(v)
}

export function can(role: Role, capability: Capability): boolean {
  return ROLES[role].capabilities.includes(capability)
}

/** Human phrase for the minimum role that holds a capability (tooltips). */
export function requiredRoleLabel(capability: Capability): string {
  // L2-only capabilities first, then scan from the weakest role up.
  if (ROLES.L2.capabilities.includes(capability) && !ROLES.L1.capabilities.includes(capability)) {
    return ROLES.L2.label
  }
  for (const id of ROLE_ORDER) {
    if (ROLES[id].capabilities.includes(capability)) return ROLES[id].label
  }
  return ROLES.L2.label
}
