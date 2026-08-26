// =====================================================================
// ESG DataOps Command Center — file-system zone utilities + CSV toolkit
// The data/ directory simulates the SFTP/S3 drop zones:
//   data/incoming   -> landing zone (simulated s3://esg-incoming)
//   data/quarantine -> failed files (simulated s3://esg-quarantine)
//   data/processed  -> archived after success (simulated s3://esg-processed)
// =====================================================================

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { resolvePath, type LoadedConfig } from './config'

export interface ScannedFile {
  fileName: string
  absPath: string
  sizeBytes: number
  receivedAt: Date // mtime simulates the arrival timestamp
}

export function ensureZones(config: LoadedConfig): void {
  for (const dir of [
    config.settings.incomingDir,
    config.settings.quarantineDir,
    config.settings.processedDir,
    config.settings.evidenceDir,
    config.settings.logsDir,
    config.settings.reportsDir,
  ]) {
    fs.mkdirSync(resolvePath(dir), { recursive: true })
  }
}

export function scanZone(dirRel: string): ScannedFile[] {
  const dir = resolvePath(dirRel)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.csv') || f.endsWith('.json'))
    .map((f) => {
      const absPath = path.join(dir, f)
      const stat = fs.statSync(absPath)
      return { fileName: f, absPath, sizeBytes: stat.size, receivedAt: stat.mtime }
    })
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
}

export function readFileText(absPath: string): string {
  return fs.readFileSync(absPath, 'utf-8')
}

export function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex')
}

/** Move a file between zones (incoming -> quarantine / processed). */
export function moveFile(absPath: string, targetDirRel: string): string {
  const targetDir = resolvePath(targetDirRel)
  fs.mkdirSync(targetDir, { recursive: true })
  const target = path.join(targetDir, path.basename(absPath))
  fs.renameSync(absPath, target)
  return target
}

/** Move a file plus its manifest sidecar (kept in the same zone). */
export function moveFileWithSidecar(
  absPath: string,
  manifestPath: string | null,
  targetDirRel: string,
): { filePath: string; manifestTarget: string | null } {
  const filePath = moveFile(absPath, targetDirRel)
  let manifestTarget: string | null = null
  if (manifestPath && fs.existsSync(manifestPath)) {
    manifestTarget = moveFile(manifestPath, targetDirRel)
  }
  return { filePath, manifestTarget }
}

/** Write a file and optionally backdate/forward-date its mtime (simulated arrival). */
export function writeFileWithTime(
  dirRel: string,
  fileName: string,
  content: string,
  receivedAt?: Date,
): string {
  const dir = resolvePath(dirRel)
  fs.mkdirSync(dir, { recursive: true })
  const abs = path.join(dir, fileName)
  fs.writeFileSync(abs, content, 'utf-8')
  if (receivedAt) {
    const t = receivedAt.getTime() / 1000
    fs.utimesSync(abs, t, t)
  }
  return abs
}

export function fileExists(dirRel: string, fileName: string): boolean {
  return fs.existsSync(path.join(resolvePath(dirRel), fileName))
}

// ---------------------------------------------------------------------
// Minimal, defensive CSV toolkit (RFC-4180 subset: comma delimiter,
// double-quote escaping). Deliberately dependency-free.
// ---------------------------------------------------------------------

export interface ParsedCsv {
  header: string[]
  rows: string[][]
  dataRowCount: number
}

export class CsvFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CsvFormatError'
  }
}

/** Parse CSV text; throws CsvFormatError on structurally corrupted rows. */
export function parseCsv(content: string): ParsedCsv {
  const lines = splitCsvLines(content)
  if (lines.length === 0) return { header: [], rows: [], dataRowCount: 0 }
  const header = parseCsvLine(lines[0])
  const rows: string[][] = []
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue
    const fields = parseCsvLine(lines[i])
    if (fields.length > header.length) {
      throw new CsvFormatError(
        `Row ${i + 1} has ${fields.length} fields but header declares ${header.length} ` +
          `(structurally corrupted record — bulk load aborted)`,
      )
    }
    rows.push(fields)
  }
  return { header, rows, dataRowCount: rows.length }
}

function splitCsvLines(content: string): string[] {
  const lines: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      current += ch
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && content[i + 1] === '\n') i++
      lines.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current !== '') lines.push(current)
  return lines
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current.trim())
  return fields
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined): string => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
}

// ---------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Strict YYYY-MM-DD validation (rejects 2025-13-45, 15/2025/06, ...). */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false
  const d = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return false
  return (
    d.getUTCFullYear() === parseInt(value.slice(0, 4), 10) &&
    d.getUTCMonth() === parseInt(value.slice(5, 7), 10) - 1 &&
    d.getUTCDate() === parseInt(value.slice(8, 10), 10)
  )
}

/** Parse a strict ISO date into a UTC-midnight Date (deterministic). */
export function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d)
  copy.setUTCDate(copy.getUTCDate() + days)
  return copy
}

/** Format a Date for display (local time, e.g. "2025-06-01 06:45:12"). */
export function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return '-'
  const p = (n: number) => n.toString().padStart(2, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  )
}

/** Format a stored UTC-midnight business date (no TZ drift). */
export function fmtUtcDate(d: Date | null | undefined): string {
  if (!d) return '-'
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}
