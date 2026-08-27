'use client'

// =====================================================================
// Tab: File Ingestion — file_ingestion_log + landing-zone inventory
// =====================================================================

import { useMemo, useState } from 'react'
import { FolderInput } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DashboardState } from '@/lib/esg/dashboard'
import {
  Chip,
  EmptyState,
  FileStatusChip,
  MetricCard,
  Mono,
  SectionHeader,
  TableShell,
  fmtBytes,
  fmtTime,
} from './shared'

export function FileIngestionTab({ state }: { state: DashboardState }) {
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [zoneFilter, setZoneFilter] = useState('ALL')

  const filtered = state.files.filter(
    (f) =>
      (statusFilter === 'ALL' || f.fileStatus === statusFilter) &&
      (zoneFilter === 'ALL' || f.zone === zoneFilter),
  )

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const f of state.files) c[f.fileStatus] = (c[f.fileStatus] ?? 0) + 1
    return c
  }, [state.files])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <MetricCard label="Received" value={counts.RECEIVED ?? 0} tone="teal" sub="in log window" />
        <MetricCard label="Validated" value={(counts.VALIDATED ?? 0) + (counts.PROCESSED ?? 0)} tone="green" sub="passed file gate" />
        <MetricCard label="Quarantined" value={counts.QUARANTINED ?? 0} tone="red" sub="moved to data/quarantine" />
        <MetricCard label="Failed" value={counts.FAILED ?? 0} tone="red" sub="load aborted" />
        <MetricCard label="Processed" value={counts.PROCESSED ?? 0} tone="green" sub="archived to data/processed" />
        <MetricCard label="In landing zone" value={state.incoming.length} tone="violet" sub="data/incoming now" />
      </div>

      <div>
        <SectionHeader
          title="File ingestion log (file_ingestion_log)"
          description="Every file arrival with checksum status, SLA window and quarantine reason. Click a row's checksum to copy."
          right={
            <div className="flex flex-wrap gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 w-[150px] text-xs">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All statuses</SelectItem>
                  {['RECEIVED', 'VALIDATING', 'VALIDATED', 'PROCESSING', 'PROCESSED', 'QUARANTINED', 'FAILED'].map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={zoneFilter} onValueChange={setZoneFilter}>
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue placeholder="Zone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All zones</SelectItem>
                  <SelectItem value="INCOMING">INCOMING</SelectItem>
                  <SelectItem value="QUARANTINE">QUARANTINE</SelectItem>
                  <SelectItem value="PROCESSED">PROCESSED</SelectItem>
                </SelectContent>
              </Select>
            </div>
          }
        />
        {filtered.length === 0 ? (
          <EmptyState title="No files match the filters" hint="Generate synthetic feeds from the Control Room and run the DAG." />
        ) : (
          <TableShell>
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">File</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Dataset</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Zone</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Checksum</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Size</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Received</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Reason / error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((f) => (
                  <TableRow key={f.fileId}>
                    <TableCell className="font-mono text-[11px] max-w-[220px] truncate" title={f.fileName}>
                      {f.fileName}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{f.dataset}</TableCell>
                    <TableCell>
                      <Chip tone={f.zone === 'QUARANTINE' ? 'red' : f.zone === 'PROCESSED' ? 'green' : 'teal'}>
                        {f.zone}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <FileStatusChip status={f.fileStatus} />
                    </TableCell>
                    <TableCell>
                      <Chip
                        tone={
                          f.checksumStatus === 'VALID'
                            ? 'green'
                            : f.checksumStatus === 'INVALID'
                              ? 'red'
                              : 'amber'
                        }
                        title={f.checksumValue}
                      >
                        {f.checksumStatus}
                      </Chip>
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{fmtBytes(f.fileSizeBytes)}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmtTime(f.receivedAt)}</TableCell>
                    <TableCell className="text-xs max-w-[260px]">
                      {f.errorMessage ? (
                        <span className="text-red-600 dark:text-red-400" title={f.errorMessage}>
                          {f.errorMessage}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableShell>
        )}
      </div>

      {/* ---- landing zone inventory + feed catalog ---- */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-0 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FolderInput className="h-4 w-4 text-emerald-600" />
              Landing zone right now (data/incoming)
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-2">
            {state.incoming.length === 0 ? (
              <EmptyState title="Landing zone is empty" hint="Generate synthetic feeds from the Control Room to simulate source-system drops." />
            ) : (
              <ul className="divide-y divide-border max-h-56 overflow-y-auto text-xs">
                {state.incoming.map((f) => (
                  <li key={f.fileName} className="py-1.5 flex items-center justify-between gap-2 hover:bg-muted/40 transition-colors">
                    <Mono>{f.fileName}</Mono>
                    <span className="text-muted-foreground whitespace-nowrap tabular-nums">
                      {fmtBytes(f.sizeBytes)} · {fmtTime(f.receivedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-0 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">Expected daily feeds (config/file_manifest.yaml)</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-2">
            <ul className="divide-y divide-border text-xs">
              {state.config.expectedFiles.map((d) => (
                <li key={d.dataset} className="py-2 flex flex-wrap items-center gap-2">
                  <Mono className="font-semibold">{d.pattern.replace('{date}', 'YYYY-MM-DD')}</Mono>
                  <Chip tone="teal">{d.dataset}</Chip>
                  <span className="text-muted-foreground">
                    expected {d.arrival} · SLA {d.slaHours}h
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
