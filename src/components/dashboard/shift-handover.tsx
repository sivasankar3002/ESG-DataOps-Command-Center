'use client'

// =====================================================================
// ESG DataOps Command Center — shift handover dialog
// (Overview tab). Gathers the live operational state and renders a
// structured markdown handover document for download as
// shift_handover_YYYY-MM-DD.md.
// =====================================================================

import { useCallback, useEffect, useState } from 'react'
import { ClipboardCheck, Download, Loader2, NotebookPen } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function ShiftHandoverDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [summary, setSummary] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)

  const generate = useCallback(async () => {
    setLoading(true)
    setSummary(null)
    try {
      const res = await fetch('/api/shift-handover', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Shift handover generation failed')
        return
      }
      setSummary(json.summary as string)
      setGeneratedAt(json.generatedAt as string)
    } catch {
      toast.error('Shift handover generation failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void generate()
  }, [open, generate])

  const downloadMd = () => {
    if (!summary) return
    const date = new Date().toISOString().slice(0, 10)
    const blob = new Blob([`# ESG DataOps shift handover — ${date}\n\n${summary}\n`], {
      type: 'text/markdown',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `shift_handover_${date}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('Handover markdown downloaded')
  }

  const copyToClipboard = async () => {
    if (!summary) return
    try {
      await navigator.clipboard.writeText(summary)
      toast.success('Handover copied to clipboard')
    } catch {
      toast.error('Clipboard not available — use Download instead')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl w-[95vw] max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-5 pt-4 pb-3 border-b">
          <DialogTitle className="text-sm flex items-center gap-2">
            <NotebookPen className="h-4 w-4 text-emerald-600" />
            Shift handover summary
          </DialogTitle>
          <DialogDescription className="text-xs">
            Generated from the live operational state for the incoming shift.
            {generatedAt ? ` Last generated: ${new Date(generatedAt).toLocaleString()}.` : ''}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
            <p className="text-sm text-muted-foreground">
              Gathering state + asking the LLM to draft the handover…
            </p>
          </div>
        ) : summary ? (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 px-5 py-2 border-b bg-muted/30">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={downloadMd}>
                <Download className="h-3.5 w-3.5" /> Download .md
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={copyToClipboard}>
                <ClipboardCheck className="h-3.5 w-3.5" /> Copy
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs ml-auto"
                onClick={() => void generate()}
              >
                <Loader2 className="h-3.5 w-3.5 hidden" /> Regenerate
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="px-6 py-5">
                <article className="prose prose-sm dark:prose-invert max-w-2xl prose-headings:scroll-m-0 prose-headings:font-semibold prose-h1:text-base prose-h1:mb-2 prose-h1:tracking-tight prose-h2:text-sm prose-h2:mt-4 prose-h2:mb-1.5 prose-h2:pb-1 prose-h2:border-b prose-p:text-xs prose-p:leading-relaxed prose-p:my-1.5 prose-li:text-xs prose-li:my-0 prose-code:text-[11px] prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:text-[11px] prose-pre:bg-muted prose-table:text-[11px] prose-th:py-1 prose-td:py-1 prose-a:text-emerald-700 dark:prose-a:text-emerald-400 prose-strong:font-semibold">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
                </article>
              </div>
            </ScrollArea>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <p className="text-sm text-muted-foreground">No handover generated yet.</p>
            <Button size="sm" onClick={() => void generate()}>
              Generate
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
