'use client'

// =====================================================================
// ESG DataOps Command Center — shared UI primitives
// Status chips, severity badges, metric cards, section headers.
// =====================================================================

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { ReactNode } from 'react'

// ----- status color mapping (no blue/indigo anywhere) ----------------
const TONES = {
  green: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800',
  red: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-950/80 dark:text-red-300 dark:border-red-800',
  amber: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-800',
  orange: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/80 dark:text-orange-300 dark:border-orange-800',
  zinc: 'bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',
  teal: 'bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-950/80 dark:text-teal-300 dark:border-teal-800',
  violet: 'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950/80 dark:text-violet-300 dark:border-violet-800',
} as const

// Border-left accent color for MetricCard (4px left border) - replaces floating icons
const ACCENT: Record<string, string> = {
  green: 'border-l-emerald-500',
  red: 'border-l-red-500',
  amber: 'border-l-amber-500',
  orange: 'border-l-orange-500',
  zinc: 'border-l-zinc-400',
  teal: 'border-l-teal-500',
  violet: 'border-l-violet-500',
}

export type Tone = keyof typeof TONES

export function Chip({
  tone = 'zinc',
  children,
  className,
  title,
}: {
  tone?: Tone
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <Badge
      variant="outline"
      title={title}
      className={cn(
        'font-medium border whitespace-nowrap transition-colors',
        TONES[tone],
        'hover:brightness-95 dark:hover:brightness-110',
        className,
      )}
    >
      {children}
    </Badge>
  )
}

// ---- job status -------------------------------------------------------
export function JobStatusChip({ status }: { status: string }) {
  const map: Record<string, Tone> = {
    SUCCESS: 'green',
    RUNNING: 'teal',
    FAILED: 'red',
    SKIPPED: 'zinc',
  }
  return <Chip tone={map[status] ?? 'zinc'}>{status}</Chip>
}

// ---- file status --------------------------------------------------------
export function FileStatusChip({ status }: { status: string }) {
  const map: Record<string, Tone> = {
    RECEIVED: 'teal',
    VALIDATING: 'teal',
    VALIDATED: 'green',
    QUARANTINED: 'red',
    PROCESSING: 'amber',
    PROCESSED: 'green',
    FAILED: 'red',
  }
  return <Chip tone={map[status] ?? 'zinc'}>{status}</Chip>
}

// ---- dq check status ------------------------------------------------------
export function CheckStatusChip({ status }: { status: string }) {
  const map: Record<string, Tone> = { PASS: 'green', FAIL: 'red', WARN: 'amber' }
  return <Chip tone={map[status] ?? 'zinc'}>{status}</Chip>
}

// ---- incident severity / status ---------------------------------------------
export function SeverityChip({ severity }: { severity: string }) {
  const map: Record<string, Tone> = { P1: 'red', P2: 'orange', P3: 'amber', P4: 'zinc' }
  return <Chip tone={map[severity] ?? 'zinc'}>{severity}</Chip>
}

export function IncidentStatusChip({ status }: { status: string }) {
  const map: Record<string, Tone> = {
    OPEN: 'red',
    IN_PROGRESS: 'amber',
    RESOLVED: 'green',
    CLOSED: 'zinc',
  }
  return <Chip tone={map[status] ?? 'zinc'}>{status.replace('_', ' ')}</Chip>
}

export function HealthChip({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  const map: Record<string, Tone> = { GREEN: 'green', AMBER: 'amber', RED: 'red', NO_DATA: 'zinc' }
  return <Chip tone={map[status] ?? 'zinc'} className={className}>{status.replace('_', ' ')}</Chip>
}

export function DqSeverityChip({ severity }: { severity: string }) {
  const map: Record<string, Tone> = {
    CRITICAL: 'red',
    HIGH: 'orange',
    MEDIUM: 'amber',
    LOW: 'teal',
    INFO: 'zinc',
  }
  return <Chip tone={map[severity] ?? 'zinc'}>{severity}</Chip>
}

// ---- day-over-day delta chip (Overview metric cards) -------------------
export interface MetricDelta {
  /** Change vs the previous day (positive = increase). */
  value: number
  /**
   * Lower-is-better metrics (incidents, failures, quarantined files) render
   * a decrease as emerald; set goodWhenDown to invert the coloring.
   */
  goodWhenDown?: boolean
  label?: string
}

function DeltaChip({ delta }: { delta: MetricDelta }) {
  const { value, goodWhenDown, label = 'vs yesterday' } = delta
  if (value === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground dark:text-muted-foreground/80 mt-0.5 whitespace-nowrap">
        <span aria-hidden>▬</span> unchanged {label}
      </span>
    )
  }
  const up = value > 0
  const good = goodWhenDown ? !up : up
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[10px] font-semibold mt-0.5 whitespace-nowrap',
        good
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-red-600 dark:text-red-400',
      )}
      title={`${up ? '+' : ''}${value} ${label}`}
    >
      <span aria-hidden>{up ? '▲' : '▼'}</span>
      {up ? '+' : '−'}
      {Math.abs(value)} {label}
    </span>
  )
}

// ---- metric card -------------------------------------------------------------
// Polished: 4px colored left border (accent) replaces the floating icon
// square for clearer scan-ability. Number is bolder; sub-text uses reduced
// opacity to create a sharper hierarchy (VLM-recommended).
export function MetricCard({
  label,
  value,
  sub,
  icon,
  tone,
  valueClassName,
  delta,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: ReactNode
  tone?: Tone
  /**
   * Override the default value typography. Use 'text-base font-mono'
   * for long identifier values (e.g. batch ids) so they fit on one line.
   */
  valueClassName?: string
  /** Optional day-over-day trend chip rendered under the value. */
  delta?: MetricDelta
}) {
  const iconTone: Record<Tone, string> = {
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    orange: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
    zinc: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    teal: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  }
  const accent = tone ? ACCENT[tone] : ACCENT.zinc
  return (
    <Card className={cn('gap-1 py-4 border-l-4 hover:shadow-sm transition-shadow', accent)}>
      <CardContent className="px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {/* wrap (never truncate) so mobile single-column cards keep the
                full KPI name — 2 lines max keeps the grid rhythm intact */}
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground leading-snug line-clamp-2 break-words">
              {label}
            </p>
            <p
              className={cn(
                'mt-1 text-[26px] font-bold tabular-nums leading-none tracking-tight break-all',
                valueClassName,
              )}
            >
              {value}
            </p>
            {delta ? <DeltaChip delta={delta} /> : null}
            {sub ? (
              <p className="mt-1.5 text-[11px] text-muted-foreground dark:text-muted-foreground/90 leading-snug line-clamp-2">{sub}</p>
            ) : null}
          </div>
          {icon ? (
            <div className={cn('rounded-md p-1.5 shrink-0 opacity-80', tone ? iconTone[tone] : iconTone.zinc)}>
              {icon}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

// ---- section header ------------------------------------------------------------
export function SectionHeader({
  title,
  description,
  right,
}: {
  title: string
  description?: string
  right?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {description ? <p className="text-xs text-muted-foreground mt-0.5">{description}</p> : null}
      </div>
      {right}
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 px-6 text-center">
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {hint ? <p className="text-xs text-muted-foreground dark:text-muted-foreground/80 mt-1 max-w-md">{hint}</p> : null}
    </div>
  )
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-xs', className)}>{children}</span>
}

// ---- table shell with sticky header + custom scrollbar + zebra rows -----------
// Rows inside this shell automatically get zebra striping and a hover
// highlight for easier scanning across wide tables (VLM-recommended).
export function TableShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-card overflow-auto max-h-[480px]',
        '[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 dark:[&::-webkit-scrollbar-thumb]:bg-zinc-700',
        '[&_table>tbody>tr:nth-child(even)]:bg-muted/40',
        'hover:[&_table>tbody>tr:hover]:bg-emerald-50/60 dark:[&_table>tbody>tr:hover]:bg-emerald-950/30',
        className,
      )}
    >
      {children}
    </div>
  )
}

// ---- formatting helpers --------------------------------------------------------------
export function fmtAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  if (h < 24) return `${h}h ${minutes % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return '-'
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function fmtDateOnly(iso: string | null | undefined): string {
  if (!iso) return '-'
  return iso.slice(0, 10)
}

export function truncateMiddle(s: string, max = 42): string {
  if (s.length <= max) return s
  const half = Math.floor((max - 1) / 2)
  return `${s.slice(0, half)}…${s.slice(-half)}`
}
