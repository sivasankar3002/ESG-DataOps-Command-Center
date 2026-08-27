'use client'

// =====================================================================
// ESG DataOps Command Center — keyboard shortcuts
// Power-user navigation modeled on ops tooling (Grafana / Linear):
//   ?      → toggle this help dialog
//   r      → refresh operational state
//   1..9   → switch tabs (1=Control Room … 9=Sites)
//   0      → Runbooks · d → Daily Report (11 tabs total)
//   j / k  → next / previous incident (Incidents tab)
//   Enter  → open the highlighted incident (Incidents tab)
//   e      → export the filtered incident queue to CSV (Incidents tab)
// All shortcuts are suppressed while typing in inputs/textareas.
// =====================================================================

import { useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** True when the current keydown happened inside a text-entry control. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

export interface ShortcutEntry {
  keys: string
  action: string
  context: string
}

export const SHORTCUTS: ShortcutEntry[] = [
  { keys: 'Ctrl/⌘ K', action: 'Open the command palette (search everything)', context: 'Anywhere' },
  { keys: '?', action: 'Toggle this shortcut help', context: 'Anywhere' },
  { keys: 'r', action: 'Refresh operational state', context: 'Anywhere' },
  { keys: '1 … 9', action: 'Switch to tab 1–9 (Control Room … Sites)', context: 'Anywhere' },
  { keys: '0', action: 'Switch to Runbooks', context: 'Anywhere' },
  { keys: 'd', action: 'Switch to Daily Report', context: 'Anywhere' },
  { keys: 'j / k', action: 'Highlight next / previous incident', context: 'Incidents tab' },
  { keys: 'Enter', action: 'Open the highlighted incident console', context: 'Incidents tab' },
  { keys: 'e', action: 'Export the filtered incident queue to CSV', context: 'Incidents tab' },
  { keys: 'Esc', action: 'Close dialogs / clear highlight', context: 'Anywhere' },
]

/** The help dialog listing every shortcut (toggled with `?`). */
export function ShortcutsHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="text-xs">
            Shortcuts are disabled while typing in inputs.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-border rounded-lg border">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center gap-3 px-3 py-2">
              <kbd className="inline-flex items-center rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold min-w-[3.5rem] justify-center shadow-[0_1px_0_rgba(0,0,0,0.06)]">
                {s.keys}
              </kbd>
              <div className="min-w-0 flex-1">
                <p className="text-xs">{s.action}</p>
                <p className="text-[10px] text-muted-foreground">{s.context}</p>
              </div>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Global keyboard handler for page-level shortcuts.
 * Tab-scoped shortcuts (j/k/Enter/e) are wired inside their own tab
 * components so they only respond while that tab is mounted.
 */
export function useGlobalKeyboardShortcuts({
  onHelp,
  onRefresh,
  onTabSelect,
  onPalette,
}: {
  onHelp: () => void
  onRefresh: () => void
  onTabSelect: (index: number) => void
  /** Open the Ctrl/⌘+K command palette. */
  onPalette: () => void
}): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl/⌘ + K opens the command palette — works even while typing
      // in an input (the palette itself is a text box, so it must open
      // from anywhere) and while other dialogs are open.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        onPalette()
        return
      }
      if (isTypingTarget(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault()
        onHelp()
        return
      }
      // Don't hijack other keys while any dialog/sheet is open.
      if (document.querySelector('[role="dialog"]')) return
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        onRefresh()
        return
      }
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        onTabSelect(10)
        return
      }
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault()
        onTabSelect(e.key === '0' ? 9 : parseInt(e.key, 10) - 1)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onHelp, onRefresh, onTabSelect, onPalette])
}
