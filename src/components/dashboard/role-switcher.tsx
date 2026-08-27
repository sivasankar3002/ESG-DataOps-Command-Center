'use client'

// =====================================================================
// Role switcher — the header operator profile menu (RBAC, round 10).
//
// The active role (VIEWER | L1 | L2) is persisted server-side in the
// UserPreference store and enforced by every mutating API route, so it
// survives browser changes just like an IdP-backed profile. Switching
// is intentionally open in this local simulation (a reviewer must be
// able to try each persona); production would derive the role from the
// SSO session and only admins could change it.
// =====================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Eye, Headset, ShieldCheck, UserCog } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { DEFAULT_ROLE, ROLES, ROLE_ORDER, type Role } from '@/lib/esg/roles'

const ROLE_ICON: Record<Role, typeof Eye> = {
  VIEWER: Eye,
  L1: Headset,
  L2: ShieldCheck,
}

const ROLE_CHIP: Record<Role, string> = {
  VIEWER:
    'bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-600',
  L1: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-700',
  L2: 'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950/80 dark:text-violet-300 dark:border-violet-700',
}

export function RoleSwitcher({
  role,
  onChangeRole,
}: {
  role: Role
  onChangeRole: (role: Role) => void
}) {
  const [open, setOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // close on outside click / Escape
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const select = useCallback(
    async (next: Role) => {
      setOpen(false)
      if (next === role) return
      onChangeRole(next)
      setSyncing(true)
      try {
        const res = await fetch('/api/prefs', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'operator.role', value: next }),
        })
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string }
          toast.error(json.error ?? 'Failed to persist role — change is session-only')
        } else {
          toast.success(`Operator role switched to ${ROLES[next].label}`, {
            description: ROLES[next].description,
            duration: 4500,
          })
        }
      } catch {
        toast.error('Failed to persist role — change is session-only')
      } finally {
        setSyncing(false)
      }
    },
    [role, onChangeRole],
  )

  const def = ROLES[role]
  const ActiveIcon = ROLE_ICON[role]

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Operator role: ${def.label}. Open role menu`}
        title={`Operator profile — role ${def.label} (persisted server-side, enforced by every mutating API)`}
        className={cn(
          'inline-flex items-center gap-1.5 h-7 rounded-md border px-2 text-[11px] font-semibold transition-colors',
          ROLE_CHIP[role],
          'hover:brightness-95 dark:hover:brightness-110',
        )}
      >
        <ActiveIcon className="h-3 w-3" />
        <span className="hidden sm:inline">{syncing ? '…' : def.label}</span>
        <span className="sm:hidden">{syncing ? '…' : def.short}</span>
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Switch operator role"
          className="absolute right-0 top-9 z-50 w-72 rounded-lg border bg-card shadow-lg p-1.5"
        >
          <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Operator profile — local-operator
          </p>
          {ROLE_ORDER.map((id) => {
            const r = ROLES[id]
            const Icon = ROLE_ICON[id]
            const active = id === role
            return (
              <button
                key={id}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => void select(id)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors',
                  active ? 'bg-muted' : 'hover:bg-muted/60',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 rounded p-1 shrink-0',
                    ROLE_CHIP[id],
                  )}
                >
                  <Icon className="h-3 w-3" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold">{r.label}</span>
                    {active ? (
                      <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                    ) : null}
                  </span>
                  <span className="block text-[11px] text-muted-foreground leading-snug">
                    {r.description}
                  </span>
                  <span className="block text-[10px] text-muted-foreground/70 leading-snug mt-0.5">
                    {r.models}
                  </span>
                </span>
              </button>
            )
          })}
          <p className="px-2 pb-1 pt-2 text-[10px] text-muted-foreground/70 leading-snug border-t mt-1">
            Role is enforced server-side on every mutating API route (403 below the required
            role). In production this maps to the SSO session claim.
          </p>
        </div>
      ) : null}
    </div>
  )
}

/** Hydrate the persisted role once per session (server is the source of truth). */
export async function fetchPersistedRole(): Promise<Role> {
  try {
    const res = await fetch('/api/prefs?key=operator.role', { cache: 'no-store' })
    if (res.ok) {
      const json = (await res.json()) as { value?: unknown }
      if (json.value === 'VIEWER' || json.value === 'L1' || json.value === 'L2') {
        return json.value
      }
    }
  } catch {
    // offline → default
  }
  return DEFAULT_ROLE
}
