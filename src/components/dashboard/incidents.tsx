'use client'

// =====================================================================
// Tab + Dialog: Incidents — ServiceNow-style incident management console
// Lifecycle OPEN -> IN_PROGRESS -> RESOLVED -> CLOSED, work notes,
// evidence packages, escalation and operational triage.
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight,
  Bot,
  ClipboardList,
  Download,
  Eye,
  FileText,
  Loader2,
  MessageSquarePlus,
  PlayCircle,
  CheckCheck,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { DashboardState } from '@/lib/esg/dashboard'
import {
  Chip,
  EmptyState,
  IncidentStatusChip,
  MetricCard,
  Mono,
  SectionHeader,
  SeverityChip,
  TableShell,
  fmtAge,
  fmtTime,
} from './shared'
import { downloadIncidentHandover } from './handover'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { isTypingTarget } from './shortcuts'

// ---------------------------------------------------------------------
// Escalation SLA countdown — how long until the daily escalation sweep
// hands this incident to Data Engineering L2 (config/settings.yaml
// escalation_threshold_minutes, default 240). The clock an L1 on-call
// engineer actually watches.
// ---------------------------------------------------------------------
export function EscalationCountdownChip({
  status,
  ageMinutes,
  thresholdMinutes,
  escalated = false,
  size = 'sm',
}: {
  status: string
  ageMinutes: number
  thresholdMinutes: number
  /** Already handed to L2 — the ESCALATED chip tells the story; no countdown. */
  escalated?: boolean
  size?: 'sm' | 'xs'
}) {
  if (escalated) return null
  if (status !== 'OPEN' && status !== 'IN_PROGRESS') return null
  const remaining = thresholdMinutes - ageMinutes
  const cls = size === 'xs' ? 'text-[9px] px-1.5' : ''
  if (remaining > 0) {
    return (
      <Chip
        tone="amber"
        className={cls}
        title={`Auto-escalates to L2 after ${thresholdMinutes}m (settings.yaml) — ${fmtAge(remaining)} remaining`}
      >
        esc in {fmtAge(remaining)}
      </Chip>
    )
  }
  return (
    <Chip
      tone="red"
      className={cls}
      title={`Past the ${thresholdMinutes}m auto-escalation threshold — the next escalation sweep hands this to L2`}
    >
      past esc SLA
    </Chip>
  )
}

// ---------------------------------------------------------------------
// Incident detail dialog (ServiceNow console)
// ---------------------------------------------------------------------
interface IncidentDetail {
  incident: {
    incidentId: string
    createdAt: string
    updatedAt: string
    batchId: string | null
    runId: string | null
    pipelineName: string
    incidentType: string
    severity: string
    status: string
    shortDescription: string
    detailedDescription: string
    errorMessage: string | null
    affectedFile: string | null
    affectedTable: string | null
    affectedCheck: string | null
    evidencePath: string | null
    runbookLink: string | null
    assignedTo: string | null
    assignmentGroup: string
    affectedService: string
    escalatedFlag: boolean
    resolutionNotes: string | null
  }
  workNotes: { id: number; note: string; author: string; createdAt: string }[]
  evidence: {
    evidenceId: string
    evidenceType: string
    evidencePath: string
    evidenceSummary: string
  }[]
}

export function IncidentDialog({
  incidentId,
  escalationThresholdMinutes = 240,
  onClose,
  onChanged,
  onViewRunbook,
  can,
}: {
  incidentId: string | null
  /** Auto-escalation threshold from config/settings.yaml — powers the SLA countdown chip. */
  escalationThresholdMinutes?: number
  onClose: () => void
  onChanged: () => void
  onViewRunbook: (runbookFile: string) => void
  /** RBAC capability check — mutating actions are L1+ only. */
  can: (capability: import('@/lib/esg/roles').Capability) => boolean
}) {
  const [detail, setDetail] = useState<IncidentDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [workNote, setWorkNote] = useState('')
  const [resolution, setResolution] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  const [evidence, setEvidence] = useState<{ name: string; type: string; content: string } | null>(null)
  const canMutate = can('incidents.mutate')

  const load = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/incidents/${id}`)
      if (res.ok) setDetail((await res.json()) as IncidentDetail)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (incidentId) {
      setAiSummary(null)
      setEvidence(null)
      setWorkNote('')
      setResolution('')
      void load(incidentId)
    } else {
      setDetail(null)
    }
  }, [incidentId, load])

  const patch = async (body: Record<string, unknown>, action: string) => {
    if (!incidentId) return
    setBusy(action)
    try {
      const res = await fetch(`/api/incidents/${incidentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Update failed')
        return
      }
      toast.success('Incident updated')
      setDetail(json as IncidentDetail)
      onChanged()
    } catch {
      toast.error('Update failed')
    } finally {
      setBusy(null)
    }
  }

  const addNote = async () => {
    if (!incidentId || workNote.trim() === '') return
    setBusy('note')
    try {
      const res = await fetch(`/api/incidents/${incidentId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: workNote.trim() }),
      })
      if (!res.ok) {
        const json = await res.json()
        toast.error(json.error ?? 'Failed to add note')
        return
      }
      setWorkNote('')
      toast.success('Work note added')
      await load(incidentId)
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  const runAiAssist = async () => {
    if (!incidentId) return
    setBusy('ai')
    try {
      const res = await fetch(`/api/incidents/${incidentId}/assist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attachAsWorkNote: false }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'AI assist failed')
        return
      }
      setAiSummary(json.summary as string)
    } catch {
      toast.error('AI assist failed')
    } finally {
      setBusy(null)
    }
  }

  const openEvidence = async (evidenceId: string, name: string, type: string) => {
    setBusy(`ev-${evidenceId}`)
    try {
      const res = await fetch(`/api/evidence/${evidenceId}`)
      if (!res.ok) {
        toast.error('Failed to load evidence')
        return
      }
      const json = await res.json()
      setEvidence({ name, type, content: json.content as string })
    } finally {
      setBusy(null)
    }
  }

  const inc = detail?.incident

  return (
    <Dialog open={incidentId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-5xl w-[95vw] max-h-[90vh] overflow-hidden flex flex-col p-0">
        {loading || !inc ? (
          <div className="flex flex-col items-center justify-center py-20">
            <DialogTitle className="sr-only">Loading incident</DialogTitle>
            <DialogDescription className="sr-only">Fetching incident record, work notes and evidence.</DialogDescription>
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <DialogHeader className="px-5 pt-4 pb-3 border-b">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="font-mono text-base">{inc.incidentId}</DialogTitle>
                <SeverityChip severity={inc.severity} />
                <IncidentStatusChip status={inc.status} />
                <Chip tone="zinc">{inc.incidentType.replace(/_/g, ' ')}</Chip>
                {inc.escalatedFlag ? <Chip tone="violet">ESCALATED</Chip> : null}
                <EscalationCountdownChip
                  status={inc.status}
                  escalated={inc.escalatedFlag}
                  ageMinutes={Math.max(0, Math.floor((Date.now() - new Date(inc.createdAt).getTime()) / 60000))}
                  thresholdMinutes={escalationThresholdMinutes}
                  size="xs"
                />
                <span className="ml-auto text-xs text-muted-foreground hidden sm:block">
                  opened {fmtTime(inc.createdAt)} · updated {fmtTime(inc.updatedAt)}
                </span>
              </div>
              <DialogDescription className="text-xs">{inc.shortDescription}</DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-0 flex-1 overflow-hidden">
              {/* ---- left: details + actions ---- */}
              <div className="lg:col-span-3 overflow-y-auto px-5 py-4 space-y-4">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <Field label="Assignment group" value={inc.assignmentGroup} />
                  <Field label="Assigned to" value={inc.assignedTo ?? 'unassigned'} />
                  <Field label="Pipeline" value={inc.pipelineName} mono />
                  <Field label="Affected service" value={inc.affectedService} />
                  <Field label="Batch" value={inc.batchId ?? 'n/a'} mono />
                  <Field label="Affected check" value={inc.affectedCheck ?? 'n/a'} mono />
                  <Field label="Run" value={inc.runId ?? 'n/a'} mono full />
                  <Field label="Affected file" value={inc.affectedFile ?? 'n/a'} mono full />
                  <Field label="Affected table" value={inc.affectedTable ?? 'n/a'} mono full />
                  <Field label="Evidence path" value={inc.evidencePath ?? 'n/a'} mono full />
                </div>

                <div>
                  <p className="text-[10px] uppercase text-muted-foreground mb-1">Detailed description</p>
                  <pre className="whitespace-pre-wrap break-words text-xs rounded border bg-muted/40 p-2 font-sans">
                    {inc.detailedDescription}
                  </pre>
                </div>

                {inc.errorMessage ? (
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground mb-1">Error message</p>
                    <pre className="whitespace-pre-wrap break-words text-[11px] rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-2 font-mono">
                      {inc.errorMessage}
                    </pre>
                  </div>
                ) : null}

                {inc.resolutionNotes ? (
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground mb-1">Resolution notes</p>
                    <pre className="whitespace-pre-wrap break-words text-xs rounded border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 p-2 font-sans">
                      {inc.resolutionNotes}
                    </pre>
                  </div>
                ) : null}

                {/* ---- actions ---- */}
                <Separator />
                {!canMutate ? (
                  <p className="text-[11px] text-muted-foreground -mt-1 flex items-center gap-1.5">
                    <Eye className="h-3 w-3 shrink-0" />
                    Read-only role — lifecycle actions and work notes require the L1 Operator role
                    (switch from the header profile menu). Support summary and evidence stay available.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {inc.status === 'OPEN' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null || !canMutate}
                      title={canMutate ? undefined : 'Requires L1 Operator role or higher'}
                      onClick={() => patch({ status: 'IN_PROGRESS' }, 'progress')}
                    >
                      <PlayCircle className="h-3.5 w-3.5" /> Start work
                    </Button>
                  ) : null}
                  {inc.status === 'OPEN' || inc.status === 'IN_PROGRESS' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null || !canMutate}
                      title={canMutate ? undefined : 'Requires L1 Operator role or higher'}
                      onClick={() => {
                        if (resolution.trim() === '') {
                          toast.error('Enter resolution notes before resolving')
                          return
                        }
                        void patch({ status: 'RESOLVED', resolutionNotes: resolution.trim() }, 'resolve')
                      }}
                    >
                      <CheckCheck className="h-3.5 w-3.5" /> Resolve
                    </Button>
                  ) : null}
                  {inc.status === 'RESOLVED' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null || !canMutate}
                      title={canMutate ? undefined : 'Requires L1 Operator role or higher'}
                      onClick={() => patch({ status: 'CLOSED' }, 'close')}
                    >
                      <XCircle className="h-3.5 w-3.5" /> Close
                    </Button>
                  ) : null}
                  {!inc.escalatedFlag ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-800 hover:bg-violet-50 dark:hover:bg-violet-950"
                      disabled={busy !== null || !canMutate}
                      title={canMutate ? undefined : 'Requires L1 Operator role or higher'}
                      onClick={() => patch({ escalate: true }, 'escalate')}
                    >
                      <ArrowUpRight className="h-3.5 w-3.5" /> Escalate to L2
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={runAiAssist}>
                    {busy === 'ai' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Bot className="h-3.5 w-3.5" />
                    )}
                    Triage summary
                  </Button>
                  {inc.runbookLink ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onViewRunbook(inc.runbookLink ?? '')}
                    >
                      <ClipboardList className="h-3.5 w-3.5" /> Open runbook
                    </Button>
                  ) : null}
                </div>

                {(inc.status === 'OPEN' || inc.status === 'IN_PROGRESS') && (
                  <Textarea
                    placeholder={
                      canMutate
                        ? 'Resolution notes (required to resolve) — what was the root cause and the fix?'
                        : 'Resolution notes — read-only role cannot resolve incidents'
                    }
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    disabled={!canMutate}
                    className="text-xs min-h-16"
                  />
                )}

                {/* ---- AI summary ---- */}
                {aiSummary ? (
                  <div className="rounded-lg border border-violet-200 dark:border-violet-900 bg-violet-50/60 dark:bg-violet-950/30 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Bot className="h-4 w-4 text-violet-600" />
                      <p className="text-xs font-semibold">Support summary</p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto h-6 px-2 text-[10px]"
                        disabled={busy !== null || !canMutate}
                        title={canMutate ? undefined : 'Requires L1 Operator role or higher'}
                        onClick={async () => {
                          setBusy('note')
                          try {
                            await fetch(`/api/incidents/${inc.incidentId}/notes`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ note: `AI-assisted triage summary:\n\n${aiSummary}`, author: 'l1-copilot' }),
                            })
                            toast.success('Attached as work note')
                            await load(inc.incidentId)
                            onChanged()
                          } finally {
                            setBusy(null)
                          }
                        }}
                      >
                        Attach as work note
                      </Button>
                    </div>
                    <div className="text-xs prose prose-sm max-w-none dark:prose-invert prose-headings:text-xs prose-p:my-1 prose-li:my-0">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{aiSummary}</ReactMarkdown>
                    </div>
                  </div>
                ) : null}

                {/* ---- evidence viewer ---- */}
                {evidence ? (
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      <p className="text-xs font-semibold font-mono">{evidence.name}</p>
                      <Chip tone="teal">{evidence.type}</Chip>
                      <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-[10px]" onClick={() => setEvidence(null)}>
                        Close
                      </Button>
                    </div>
                    <pre className="whitespace-pre-wrap break-words text-[10px] rounded border bg-muted/40 p-2 font-mono max-h-72 overflow-y-auto">
                      {evidence.content}
                    </pre>
                  </div>
                ) : null}
              </div>

              {/* ---- right: work notes + evidence ---- */}
              <div className="lg:col-span-2 border-l overflow-y-auto px-5 py-4 space-y-4 bg-muted/20">
                <div>
                  <p className="text-xs font-semibold mb-2">
                    Work notes <span className="text-muted-foreground font-normal">({detail.workNotes.length})</span>
                  </p>
                  <ScrollArea className="max-h-64 pr-2">
                    <ul className="space-y-2">
                      {detail.workNotes.map((n) => (
                        <li key={n.id} className="rounded border bg-card p-2">
                          <div className="flex items-center gap-2">
                            <Chip tone="teal">{n.author}</Chip>
                            <span className="text-[10px] text-muted-foreground">{fmtTime(n.createdAt)}</span>
                          </div>
                          <p className="text-[11px] mt-1 whitespace-pre-wrap leading-snug">{n.note}</p>
                        </li>
                      ))}
                      {detail.workNotes.length === 0 ? (
                        <li className="text-xs text-muted-foreground">No work notes yet.</li>
                      ) : null}
                    </ul>
                  </ScrollArea>
                  <Textarea
                    placeholder={canMutate ? 'Add work note…' : 'Work notes — read-only role'}
                    value={workNote}
                    onChange={(e) => setWorkNote(e.target.value)}
                    disabled={!canMutate}
                    className="text-xs mt-2 min-h-16"
                  />
                  <Button
                    size="sm"
                    className="mt-1.5 w-full"
                    variant="outline"
                    disabled={busy !== null || workNote.trim() === '' || !canMutate}
                    title={canMutate ? undefined : 'Requires L1 Operator role or higher'}
                    onClick={addNote}
                  >
                    {busy === 'note' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquarePlus className="h-3.5 w-3.5" />}
                    Add work note
                  </Button>
                </div>

                <Separator />

                <div>
                  <p className="text-xs font-semibold mb-2">
                    Evidence package <span className="text-muted-foreground font-normal">({detail.evidence.length})</span>
                  </p>
                  <ul className="space-y-1.5">
                    {detail.evidence.map((e) => (
                      <li key={e.evidenceId}>
                        <button
                          className="w-full text-left rounded border bg-card px-2 py-1.5 hover:border-emerald-400/60 transition-colors"
                          onClick={() => openEvidence(e.evidenceId, e.evidencePath.split('/').pop() ?? e.evidenceId, e.evidenceType)}
                          disabled={busy !== null}
                        >
                          <div className="flex items-center gap-2">
                            <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                            <Mono className="truncate">{e.evidencePath.split('/').pop()}</Mono>
                            {busy === `ev-${e.evidenceId}` ? (
                              <Loader2 className="h-3 w-3 animate-spin ml-auto" />
                            ) : (
                              <Chip tone="zinc" className="ml-auto shrink-0 text-[9px]">
                                {e.evidenceType.replace(/_/g, ' ')}
                              </Chip>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{e.evidenceSummary}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  value,
  mono,
  full,
}: {
  label: string
  value: string
  mono?: boolean
  full?: boolean
}) {
  return (
    <div className={cn('min-w-0', full && 'col-span-2')}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">{label}</p>
      <p
        className={cn(
          'break-words leading-snug',
          mono ? 'font-mono text-[11px]' : 'text-xs',
        )}
        title={`${value} — click to copy`}
        role="button"
        tabIndex={0}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            toast.success(`${label} copied to clipboard`)
          })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            void navigator.clipboard?.writeText(value).then(() => {
              toast.success(`${label} copied to clipboard`)
            })
          }
        }}
      >
        {value}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------
// Incidents tab
// ---------------------------------------------------------------------
export function IncidentsTab({
  state,
  onOpenIncident,
}: {
  state: DashboardState
  onOpenIncident: (id: string) => void
}) {
  const [statusFilter, setStatusFilter] = useState('ACTIVE')
  const [severityFilter, setSeverityFilter] = useState('ALL')
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null)

  const filtered = useMemo(
    () =>
      state.incidents.filter((i) => {
        const statusOk =
          statusFilter === 'ALL' ||
          (statusFilter === 'ACTIVE' ? i.status === 'OPEN' || i.status === 'IN_PROGRESS' : i.status === statusFilter)
        const sevOk = severityFilter === 'ALL' || i.severity === severityFilter
        return statusOk && sevOk
      }),
    [state.incidents, statusFilter, severityFilter],
  )

  const active = state.incidents.filter((i) => i.status === 'OPEN' || i.status === 'IN_PROGRESS')
  const escalated = active.filter((i) => i.escalatedFlag).length

  // ---- response metrics (ops maturity signals) -------------------------
  // MTTR proxy: createdAt → updatedAt on RESOLVED/CLOSED records.
  // Avg age: how long the current active queue has been open.
  const resolvedRecords = state.incidents.filter((i) => i.status === 'RESOLVED' || i.status === 'CLOSED')
  const mttrMinutes =
    resolvedRecords.length > 0
      ? Math.round(
          resolvedRecords.reduce(
            (a, i) => a + (new Date(i.updatedAt).getTime() - new Date(i.createdAt).getTime()) / 60000,
            0,
          ) / resolvedRecords.length,
        )
      : null
  const avgAgeMinutes =
    active.length > 0
      ? Math.round(active.reduce((a, i) => a + i.ageMinutes, 0) / active.length)
      : null

  // Clamp the highlight when filters shrink the list (derived, no effect).
  const highlighted =
    highlightedIndex === null
      ? null
      : highlightedIndex < filtered.length
        ? highlightedIndex
        : filtered.length - 1

  // ---- tab-scoped keyboard shortcuts (j/k/Enter/e) --------------------
  // This component is only mounted while the Incidents tab is active
  // (Radix Tabs unmount inactive content), so the listener is naturally
  // scoped. Guarded against typing in inputs, modifier combos and any
  // open dialog (so keys typed into the incident console do nothing).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (document.querySelector('[role="dialog"]')) return
      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault()
        setHighlightedIndex((prev) => {
          if (filtered.length === 0) return null
          if (prev === null) return 0
          return Math.min(filtered.length - 1, prev + 1)
        })
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault()
        setHighlightedIndex((prev) => {
          if (filtered.length === 0) return null
          if (prev === null) return filtered.length - 1
          return Math.max(0, prev - 1)
        })
      } else if (e.key === 'Enter') {
        if (highlighted !== null && filtered[highlighted]) {
          e.preventDefault()
          onOpenIncident(filtered[highlighted].incidentId)
        }
      } else if (e.key === 'e' || e.key === 'E') {
        if (filtered.length > 0) {
          e.preventDefault()
          downloadIncidentsCsv(filtered)
        }
      } else if (e.key === 'Escape') {
        setHighlightedIndex(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [filtered, highlighted, onOpenIncident])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <MetricCard label="Active incidents" value={active.length} sub={avgAgeMinutes !== null ? `avg age ${fmtAge(avgAgeMinutes)}` : 'queue is clear'} tone={active.length > 0 ? 'amber' : 'green'} />
        <MetricCard label="P1 / P2 active" value={state.overview.openBySeverity.P1 + state.overview.openBySeverity.P2} sub="severity gate to RED health" tone="red" />
        <MetricCard label="Escalated" value={escalated} sub="handed to Data Engineering L2" tone="violet" />
        <MetricCard label="Resolved (window)" value={state.incidents.filter((i) => i.status === 'RESOLVED').length} sub="fix verified, monitoring" tone="green" />
        <MetricCard
          label="MTTR (resolved)"
          value={mttrMinutes !== null ? fmtAge(mttrMinutes) : '—'}
          sub="created → last update, resolved/closed"
          tone="teal"
        />
        <MetricCard label="Auto-escalation" value={`${state.config.escalationThresholdMinutes}m`} sub="threshold (settings.yaml)" tone="zinc" />
      </div>

      <SectionHeader
        title="Incident log (incident_log)"
        description="ServiceNow-style incident records raised automatically by pipeline failures — click a row to open the console (j/k to navigate, Enter to open, e to export)"
        right={
          <div className="flex flex-wrap gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Active (open + in progress)</SelectItem>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="OPEN">OPEN</SelectItem>
                <SelectItem value="IN_PROGRESS">IN_PROGRESS</SelectItem>
                <SelectItem value="RESOLVED">RESOLVED</SelectItem>
                <SelectItem value="CLOSED">CLOSED</SelectItem>
              </SelectContent>
            </Select>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="h-8 w-[110px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All severities</SelectItem>
                <SelectItem value="P1">P1</SelectItem>
                <SelectItem value="P2">P2</SelectItem>
                <SelectItem value="P3">P3</SelectItem>
                <SelectItem value="P4">P4</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => downloadIncidentsCsv(filtered)}
              disabled={filtered.length === 0}
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs hover:bg-emerald-50 dark:hover:bg-emerald-950 hover:border-emerald-300 dark:hover:border-emerald-800"
              onClick={() => {
                downloadIncidentHandover(filtered, { status: statusFilter, severity: severityFilter }, state.config)
                toast.success('Incident queue handover exported', {
                  description: 'Markdown artifact with queue summary, active incident detail and a triage checklist.',
                })
              }}
              disabled={filtered.length === 0}
              title="Download a markdown shift-handover artifact of the current filtered queue — queue summary, per-incident detail with runbook + evidence pointers, and a triage checklist for the incoming shift"
            >
              <ClipboardList className="h-3.5 w-3.5" />
              Export handover
            </Button>
          </div>
        }
      />

      {filtered.length === 0 ? (
        <EmptyState
          title="No incidents match the filters"
          hint="Simulate a failure from the Control Room to see the full incident workflow: detection, evidence, runbook, escalation."
        />
      ) : (
        <TableShell>
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow className="hover:bg-transparent border-b-0">
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider pb-2.5">Incident</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider pb-2.5">Sev</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider pb-2.5">Type</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider pb-2.5">Description</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider pb-2.5">Status</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider pb-2.5">Assigned</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider pb-2.5 text-right">Age</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider pb-2.5">Flags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((i, idx) => (
                <TableRow
                  key={i.incidentId}
                  className={cn(
                    'cursor-pointer',
                    highlighted === idx &&
                      'ring-2 ring-inset ring-emerald-400 dark:ring-emerald-700 bg-emerald-50/70 dark:bg-emerald-950/40',
                  )}
                  onClick={() => onOpenIncident(i.incidentId)}
                  onMouseEnter={() => setHighlightedIndex(null)}
                >
                  <TableCell
                    className="font-mono text-[11px] font-semibold"
                    style={{
                      boxShadow: `inset 3px 0 0 ${
                        i.severity === 'P1'
                          ? 'rgb(239 68 68)'
                          : i.severity === 'P2'
                            ? 'rgb(249 115 22)'
                            : i.severity === 'P3'
                              ? 'rgb(245 158 11)'
                              : 'rgb(161 161 170)'
                      }`,
                    }}
                  >
                    {i.incidentId}
                  </TableCell>
                  <TableCell>
                    <SeverityChip severity={i.severity} />
                  </TableCell>
                  <TableCell className="text-[11px]">{i.incidentType.replace(/_/g, ' ')}</TableCell>
                  <TableCell className="text-[11px]">
                    <p className="max-w-[380px] whitespace-normal break-words line-clamp-2 leading-snug" title={i.shortDescription}>
                      {i.shortDescription}
                    </p>
                  </TableCell>
                  <TableCell>
                    <IncidentStatusChip status={i.status} />
                  </TableCell>
                  <TableCell className="text-[11px]">{i.assignedTo ?? '-'}</TableCell>
                  <TableCell className="text-[11px] text-right tabular-nums whitespace-nowrap">{fmtAge(i.ageMinutes)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {i.escalatedFlag ? (
                        <Chip tone="violet">ESCALATED</Chip>
                      ) : (
                        <EscalationCountdownChip
                          status={i.status}
                          ageMinutes={i.ageMinutes}
                          thresholdMinutes={state.config.escalationThresholdMinutes}
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>
      )}
    </div>
  )
}

// ---- CSV export helper (client-side, downloaded as a Blob) --------------------
// Mirrors the columns of the on-screen incident table; ideal for handing the
// current filtered queue over to L2 / management or for offline analysis.
function downloadIncidentsCsv(
  rows: DashboardState['incidents'],
): void {
  const headers = [
    'incident_id',
    'created_at',
    'updated_at',
    'batch_id',
    'incident_type',
    'severity',
    'status',
    'short_description',
    'affected_file',
    'affected_table',
    'affected_check',
    'runbook_link',
    'assigned_to',
    'escalated',
    'age_minutes',
  ]
  const esc = (v: string | number | boolean | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const body = rows
    .map((i) =>
      [
        i.incidentId,
        i.createdAt,
        i.updatedAt,
        i.batchId ?? '',
        i.incidentType,
        i.severity,
        i.status,
        i.shortDescription,
        i.affectedFile ?? '',
        i.affectedTable ?? '',
        i.affectedCheck ?? '',
        i.runbookLink ?? '',
        i.assignedTo ?? '',
        i.escalatedFlag ? 'true' : 'false',
        i.ageMinutes,
      ]
        .map(esc)
        .join(','),
    )
    .join('\n')
  const csv = `${headers.join(',')}\n${body}\n`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `incidents_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}


