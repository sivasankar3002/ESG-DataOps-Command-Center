'use client'

// =====================================================================
// Tab: Runbooks — operational documentation rendered from docs/
// (10 runbooks RB001-RB010 + 6 SOPs, served by GET /api/runbooks)
// =====================================================================

import { useEffect, useState } from 'react'
import { BookOpen, ClipboardList, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Chip, EmptyState } from './shared'

interface DocEntry {
  id: string
  title: string
  file: string
  content: string
}

export function RunbooksTab({
  initialDoc,
  onConsumeInitialDoc,
}: {
  initialDoc?: string | null
  onConsumeInitialDoc?: () => void
}) {
  const [docs, setDocs] = useState<{ runbooks: DocEntry[]; sops: DocEntry[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [section, setSection] = useState<'runbooks' | 'sops'>('runbooks')
  const [selected, setSelected] = useState<DocEntry | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/runbooks')
      if (res.ok) setDocs((await res.json()) as { runbooks: DocEntry[]; sops: DocEntry[] })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // Deep link: open a specific runbook file (e.g. docs/runbooks/RB003_...md)
  useEffect(() => {
    if (docs && initialDoc) {
      const fileName = initialDoc.split('/').pop()
      const match =
        docs.runbooks.find((d) => d.id === fileName?.replace('.md', '')) ??
        docs.sops.find((d) => d.id === fileName?.replace('.md', ''))
      if (match) {
        setSelected(match)
        setSection(docs.runbooks.some((d) => d.id === match.id) ? 'runbooks' : 'sops')
      }
      onConsumeInitialDoc?.()
    }
  }, [docs, initialDoc, onConsumeInitialDoc])

  useEffect(() => {
    if (docs && !selected) {
      setSelected(docs.runbooks[0] ?? docs.sops[0] ?? null)
    }
  }, [docs, selected])

  const list = section === 'runbooks' ? (docs?.runbooks ?? []) : (docs?.sops ?? [])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={section} onValueChange={(v) => setSection(v as 'runbooks' | 'sops')}>
          <TabsList className="h-8">
            <TabsTrigger value="runbooks" className="text-xs gap-1.5">
              <BookOpen className="h-3.5 w-3.5" /> Runbooks ({docs?.runbooks.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="sops" className="text-xs gap-1.5">
              <ClipboardList className="h-3.5 w-3.5" /> SOPs ({docs?.sops.length ?? 0})
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Reload docs
        </Button>
      </div>

      {loading && !docs ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !docs || docs.runbooks.length === 0 ? (
        <EmptyState
          title="Documentation not found"
          hint="Runbooks are loaded from docs/runbooks/*.md and SOPs from docs/*.md on the server."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* ---- doc list ---- */}
          <div className="md:col-span-1">
            <ScrollArea className="h-[560px] rounded-lg border bg-card">
              <ul className="p-1.5 space-y-1">
                {list.map((d) => (
                  <li key={d.id}>
                    <button
                      onClick={() => setSelected(d)}
                      className={cn(
                        'w-full text-left rounded-md px-2.5 py-2 text-xs transition-colors border border-transparent',
                        selected?.id === d.id
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 font-semibold border-emerald-300 dark:border-emerald-800'
                          : 'hover:bg-muted hover:border-zinc-300 dark:hover:border-zinc-700',
                      )}
                    >
                      <span className={cn('font-mono text-[10px]', selected?.id === d.id ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground')}>{d.id.slice(0, 5)}</span>
                      <p className="leading-snug mt-0.5">{d.title}</p>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>

          {/* ---- doc content (VLM: more padding, max-width content, line-height) ---- */}
          <div className="md:col-span-3 rounded-lg border bg-card overflow-hidden">
            {selected ? (
              <ScrollArea className="h-[560px]">
                <div className="px-8 py-6">
                  <div className="flex flex-wrap items-center gap-2 mb-4 pb-3 border-b">
                    <Chip tone="teal">{selected.file}</Chip>
                    <span className="text-[11px] text-muted-foreground/80 font-mono">rendered from docs/</span>
                  </div>
                  <article className="prose prose-sm dark:prose-invert max-w-3xl prose-headings:scroll-m-0 prose-headings:font-semibold prose-h1:text-xl prose-h1:mb-3 prose-h1:tracking-tight prose-h2:text-base prose-h2:mt-6 prose-h2:mb-2 prose-h2:pb-1 prose-h2:border-b prose-p:text-sm prose-p:leading-relaxed prose-p:my-2 prose-li:text-sm prose-li:my-0.5 prose-li:leading-relaxed prose-code:text-[11px] prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:text-[11px] prose-pre:bg-muted prose-table:text-xs prose-th:py-1 prose-td:py-1 prose-a:text-emerald-700 dark:prose-a:text-emerald-400 prose-strong:font-semibold">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.content}</ReactMarkdown>
                  </article>
                </div>
              </ScrollArea>
            ) : (
              <EmptyState title="Select a document" />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
