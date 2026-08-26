// =====================================================================
// ESG DataOps Command Center — MODULE 3: synthetic data generator
// Generates realistic ESG feeds (energy / carbon / site master) into
// data/incoming, including deliberate failure scenarios for testing.
//
// Emissions are correlated with energy via country grid emission
// factors — the same modelling approach a real ESG platform uses.
// =====================================================================

import { loadConfig, type DatasetManifest } from './config'
import { writeFileWithTime, toCsv, sha256 } from './fsx'
import type { Scenario } from './types'
import { SCENARIO_LABELS } from './types'

// ---------------------------------------------------------------------
// Deterministic RNG so the site pool is stable across regenerations
// ---------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SiteDef {
  siteId: string
  siteName: string
  country: string
  region: string
  siteType: string
  effectiveFromDate: string
}

// kgCO2e per kWh — synthetic but plausible grid intensity factors
const EMISSION_FACTORS: Record<string, number> = {
  Germany: 0.34,
  France: 0.06,
  'United Kingdom': 0.21,
  Netherlands: 0.33,
  Spain: 0.19,
  Poland: 0.78,
  'United States': 0.37,
  Canada: 0.13,
  Mexico: 0.44,
  India: 0.71,
  Singapore: 0.42,
  Japan: 0.47,
  Australia: 0.66,
  Brazil: 0.09,
  Chile: 0.31,
}

const GEO: { region: string; country: string; cities: string[] }[] = [
  { region: 'EMEA', country: 'Germany', cities: ['Frankfurt', 'Munich', 'Hamburg'] },
  { region: 'EMEA', country: 'France', cities: ['Paris', 'Lyon'] },
  { region: 'EMEA', country: 'United Kingdom', cities: ['London', 'Manchester'] },
  { region: 'EMEA', country: 'Netherlands', cities: ['Amsterdam'] },
  { region: 'EMEA', country: 'Spain', cities: ['Madrid'] },
  { region: 'EMEA', country: 'Poland', cities: ['Warsaw'] },
  { region: 'AMER', country: 'United States', cities: ['New York', 'Austin', 'Denver'] },
  { region: 'AMER', country: 'Canada', cities: ['Toronto'] },
  { region: 'AMER', country: 'Mexico', cities: ['Mexico City'] },
  { region: 'APAC', country: 'India', cities: ['Pune', 'Bengaluru', 'Hyderabad'] },
  { region: 'APAC', country: 'Singapore', cities: ['Singapore'] },
  { region: 'APAC', country: 'Japan', cities: ['Osaka'] },
  { region: 'APAC', country: 'Australia', cities: ['Sydney'] },
  { region: 'LATAM', country: 'Brazil', cities: ['Sao Paulo'] },
  { region: 'LATAM', country: 'Chile', cities: ['Santiago'] },
]

const SITE_TYPES: { type: string; minKwh: number; maxKwh: number }[] = [
  { type: 'Manufacturing Plant', minKwh: 5000, maxKwh: 12000 },
  { type: 'Data Center', minKwh: 8000, maxKwh: 15000 },
  { type: 'Warehouse', minKwh: 800, maxKwh: 2000 },
  { type: 'Office', minKwh: 600, maxKwh: 1800 },
  { type: 'Retail Store', minKwh: 900, maxKwh: 2500 },
  { type: 'R&D Lab', minKwh: 1500, maxKwh: 4000 },
]

/** Build a deterministic pool of up to 50 sites (stable across runs). */
export function buildSitePool(maxSites = 50): SiteDef[] {
  const rng = mulberry32(20250101)
  const pool: SiteDef[] = []
  let n = 1
  outer: for (let round = 0; round < 6; round++) {
    for (const geo of GEO) {
      for (const city of geo.cities) {
        if (pool.length >= maxSites) break outer
        const typeIdx = Math.floor(rng() * SITE_TYPES.length)
        const siteType = SITE_TYPES[typeIdx].type
        const siteId = `SITE-${n.toString().padStart(3, '0')}`
        pool.push({
          siteId,
          siteName: `${city} ${siteType}`,
          country: geo.country,
          region: geo.region,
          siteType,
          effectiveFromDate: '2023-01-01',
        })
        n++
      }
    }
  }
  return pool
}

function dailyKwhRange(siteType: string): { min: number; max: number } {
  const t = SITE_TYPES.find((s) => s.type === siteType) ?? SITE_TYPES[3]
  return { min: t.minKwh, max: t.maxKwh }
}

function round(v: number, digits: number): number {
  const f = Math.pow(10, digits)
  return Math.round(v * f) / f
}

// ---------------------------------------------------------------------
// File content builders
// ---------------------------------------------------------------------

interface EnergyRow {
  recordId: string
  siteId: string
  readingDate: string
  energyKwh: number
  emissionsCo2e: number
}

function buildEnergyRows(sites: SiteDef[], businessDate: string): EnergyRow[] {
  const compact = businessDate.replace(/-/g, '')
  return sites.map((site) => {
    const { min, max } = dailyKwhRange(site.siteType)
    const energy = round(min + Math.random() * (max - min), 2)
    const factor = EMISSION_FACTORS[site.country] ?? 0.4
    const emissions = round(energy * factor * (0.98 + Math.random() * 0.04), 2)
    return {
      recordId: `EN-${compact}-${site.siteId.slice(5)}-${(100 + Math.floor(Math.random() * 900)).toString()}`,
      siteId: site.siteId,
      readingDate: businessDate,
      energyKwh: energy,
      emissionsCo2e: emissions,
    }
  })
}

function buildCarbonRows(sites: SiteDef[], businessDate: string, energy: EnergyRow[]): EnergyRow[] {
  const compact = businessDate.replace(/-/g, '')
  return sites.map((site, i) => {
    const energyRow = energy[i]
    // Cross-dataset consistency: carbon ledger tracks energy-derived
    // emissions within a small variance band.
    const base = energyRow ? energyRow.emissionsCo2e : 100 + Math.random() * 500
    return {
      recordId: `CE-${compact}-${site.siteId.slice(5)}-${(100 + Math.floor(Math.random() * 900)).toString()}`,
      siteId: site.siteId,
      readingDate: businessDate,
      energyKwh: NaN, // not part of the carbon dataset
      emissionsCo2e: round(base * (0.99 + Math.random() * 0.02), 2),
    }
  })
}

function energyCsv(rows: EnergyRow[], dropSiteId = false): string {
  const header = dropSiteId
    ? ['record_id', 'reading_date', 'energy_kwh', 'emissions_co2e']
    : ['record_id', 'site_id', 'reading_date', 'energy_kwh', 'emissions_co2e']
  const body = rows.map((r) => {
    const cells = [
      r.recordId,
      dropSiteId ? null : r.siteId,
      r.readingDate,
      r.energyKwh,
      r.emissionsCo2e,
    ].filter((c) => c !== null)
    return cells as (string | number)[]
  })
  return toCsv(header, body)
}

function carbonCsv(rows: EnergyRow[]): string {
  return toCsv(
    ['record_id', 'site_id', 'reading_date', 'emissions_co2e', 'scope'],
    rows.map((r) => [r.recordId, r.siteId, r.readingDate, r.emissionsCo2e, 'Scope 1+2']),
  )
}

function siteMasterCsv(sites: SiteDef[]): string {
  return toCsv(
    ['site_id', 'site_name', 'country', 'region', 'site_type', 'effective_from_date'],
    sites.map((s) => [
      s.siteId,
      s.siteName,
      s.country,
      s.region,
      s.siteType,
      s.effectiveFromDate,
    ]),
  )
}

// ---------------------------------------------------------------------
// Scenario mutations (applied to the energy dataset unless noted)
// ---------------------------------------------------------------------

function applyScenariosToEnergy(
  rows: EnergyRow[],
  scenarios: Scenario[],
  businessDate: string,
): { rows: EnergyRow[]; dropSiteId: boolean; extraFieldRow: boolean } {
  let out = [...rows]
  let dropSiteId = false
  let extraFieldRow = false

  for (const scenario of scenarios) {
    switch (scenario) {
      case 'empty_file':
        out = []
        break
      case 'missing_column':
        dropSiteId = true
        break
      case 'duplicates':
        if (out.length >= 2) {
          out = [...out, { ...out[0] }, { ...out[1] }] // replay 2 record_ids
        }
        break
      case 'null_values':
        for (let i = 0; i < Math.min(2, out.length); i++) out[i] = { ...out[i], siteId: '' }
        break
      case 'negative_energy':
        for (let i = 0; i < Math.min(2, out.length); i++) {
          out[i] = { ...out[i], energyKwh: -Math.abs(out[i].energyKwh) || -12.5 }
        }
        break
      case 'bad_date':
        for (let i = 0; i < Math.min(2, out.length); i++) {
          out[i] = { ...out[i], readingDate: i === 0 ? `${businessDate.slice(0, 8)}32` : '31-02-2025' }
        }
        break
      case 'load_failure':
        extraFieldRow = true
        break
      default:
        break
    }
  }
  return { rows: out, dropSiteId, extraFieldRow }
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

export interface GeneratedFileInfo {
  fileName: string
  dataset: string
  dataRows: number
  manifestFileName: string
  receivedAt: string
  scenarios: Scenario[]
}

export interface GenerateResult {
  businessDate: string
  siteCount: number
  files: GeneratedFileInfo[]
  skippedDatasets: string[]
  message: string
}

export function generateSyntheticData(opts: {
  businessDate?: string
  scenarios?: Scenario[]
  siteCount?: number
}): GenerateResult {
  const config = loadConfig()
  const businessDate = opts.businessDate ?? new Date().toISOString().slice(0, 10)
  const scenarios = (opts.scenarios ?? []).filter((s) => s !== 'good')
  const siteCount = Math.min(50, Math.max(10, opts.siteCount ?? 24))
  const sites = buildSitePool(50).slice(0, siteCount)

  const energyRows = buildEnergyRows(sites, businessDate)
  const carbonRows = buildCarbonRows(sites, businessDate, energyRows)

  // Scenario effects (energy dataset carries most mutations)
  const mutated = applyScenariosToEnergy(energyRows, scenarios, businessDate)
  const skipCarbon = scenarios.includes('missing_file')

  const files: GeneratedFileInfo[] = []

  // ---- energy_consumption --------------------------------------------
  {
    const ds = config.manifest['energy_consumption']
    let csv = energyCsv(mutated.rows, mutated.dropSiteId)
    if (mutated.extraFieldRow && mutated.rows.length > 0) {
      // Corrupt one row with an extra field — triggers a bulk load failure
      const lines = csv.split('\n')
      const idx = 1 + Math.floor(Math.random() * (lines.length - 1))
      lines[idx] = `${lines[idx]},CORRUPT_EXTRA_FIELD`
      csv = lines.join('\n')
    }
    files.push(
      writeFeedFile(config, ds, businessDate, csv, mutated.rows.length, scenarios, [
        'empty_file',
        'missing_column',
        'duplicates',
        'null_values',
        'negative_energy',
        'bad_date',
        'bad_checksum',
        'row_count_mismatch',
        'sla_breach',
        'load_failure',
      ]),
    )
  }

  // ---- carbon_emissions (skipped when simulating FILE_MISSING) --------
  if (!skipCarbon) {
    const ds = config.manifest['carbon_emissions']
    files.push(writeFeedFile(config, ds, businessDate, carbonCsv(carbonRows), carbonRows.length, scenarios, []))
  }

  // ---- site_master -----------------------------------------------------
  {
    const ds = config.manifest['site_master']
    files.push(writeFeedFile(config, ds, businessDate, siteMasterCsv(sites), sites.length, scenarios, []))
  }

  const skipped = skipCarbon ? ['carbon_emissions'] : []
  const message =
    `Generated ${files.length} file(s) for ${businessDate} (${siteCount} sites)` +
    (skipped.length > 0 ? ` — skipped feed(s): ${skipped.join(', ')} (FILE_MISSING simulation)` : '') +
    (scenarios.length > 0 ? ` — scenarios: ${scenarios.map((s) => SCENARIO_LABELS[s]).join('; ')}` : '')

  return { businessDate, siteCount, files, skippedDatasets: skipped, message }
}

/**
 * Write a feed + its manifest sidecar into data/incoming.
 * The manifest is the control record from the source system: expected
 * row count + SHA256 checksum (used by the validation engine).
 */
function writeFeedFile(
  config: ReturnType<typeof loadConfig>,
  ds: DatasetManifest,
  businessDate: string,
  csv: string,
  actualRows: number,
  scenarios: Scenario[],
  applicable: Scenario[],
): GeneratedFileInfo {
  const fileName = ds.pattern.replace('{date}', businessDate)
  const manifestFileName = `${fileName}.manifest.json`

  // Simulated arrival: expected arrival + small jitter (0-25 min).
  const [h, m] = ds.expectedArrival.split(':').map((x) => parseInt(x, 10))
  const arrival = new Date(`${businessDate}T00:00:00`)
  arrival.setHours(h, m + Math.floor(Math.random() * 25), 0, 0)
  if (scenarios.includes('sla_breach') && applicable.includes('sla_breach')) {
    arrival.setHours(arrival.getHours() + 5) // 5 hours late -> SLA breach
  }

  const checksum = sha256(csv)
  const tamperChecksum = scenarios.includes('bad_checksum') && applicable.includes('bad_checksum')
  const mismatchRowCount = scenarios.includes('row_count_mismatch') && applicable.includes('row_count_mismatch')

  writeFileWithTime(config.settings.incomingDir, fileName, csv, arrival)
  const manifest = {
    file_name: fileName,
    dataset: ds.name,
    business_date: businessDate,
    source_system: ds.sourceSystem,
    generated_at: new Date().toISOString(),
    expected_rows: mismatchRowCount ? actualRows + 5 : actualRows,
    checksum_algorithm: 'SHA256',
    checksum_sha256: tamperChecksum ? checksum.replace(/^[0-9a-f]{6}/, 'deadbe') : checksum,
  }
  writeFileWithTime(
    config.settings.incomingDir,
    manifestFileName,
    JSON.stringify(manifest, null, 2) + '\n',
    arrival,
  )

  return {
    fileName,
    dataset: ds.name,
    dataRows: actualRows,
    manifestFileName,
    receivedAt: arrival.toISOString(),
    scenarios: scenarios.filter((s) => applicable.includes(s)),
  }
}
