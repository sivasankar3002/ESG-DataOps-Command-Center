// =====================================================================
// ESG DataOps Command Center — Site drilldown API
// GET /api/sites/[siteId] — per-site metadata + daily energy/emissions
// trend + recent fact rows. Powers the Site Analytics drilldown modal.
// =====================================================================

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadConfig } from '@/lib/esg/config'
import { addDays, fmtUtcDate, parseIsoDate } from '@/lib/esg/fsx'

export const dynamic = 'force-dynamic'

function localDateStr(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * GET /api/sites/[siteId]
 * Returns:
 *  - site: dim_site metadata + warehouse aggregates (energy, emissions,
 *    records, carbon intensity, first/last reading)
 *  - dailyTrend: per-day energy/emissions for the trend window
 *  - recentRows: the 10 most recent fact rows for this site
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ siteId: string }> },
) {
  try {
    const { siteId } = await params
    const config = loadConfig()
    const trendDays = config.settings.trendDays

    const [site] = await db.dimSite.findMany({ where: { siteId }, take: 1 })
    if (!site) {
      return NextResponse.json({ error: `Site ${siteId} not found in dim_site` }, { status: 404 })
    }

    const facts = await db.factEnergyEmissions.findMany({
      where: { siteId },
      orderBy: { readingDate: 'desc' },
      take: 5000,
    })

    if (facts.length === 0) {
      return NextResponse.json({
        site: {
          siteId: site.siteId,
          siteName: site.siteName,
          country: site.country,
          region: site.region,
          siteType: site.siteType,
          activeFlag: site.activeFlag,
          totalEnergyKwh: 0,
          totalEmissionsCo2e: 0,
          recordCount: 0,
          carbonIntensity: 0,
          firstReading: null,
          latestReading: null,
          batches: 0,
        },
        dailyTrend: [],
        recentRows: [],
      })
    }

    const totalEnergy = facts.reduce((a, f) => a + f.energyKwh, 0)
    const totalEmissions = facts.reduce((a, f) => a + f.emissionsCo2e, 0)
    const readingDates = facts.map((f) => f.readingDate).sort((a, b) => a.getTime() - b.getTime())
    const batches = new Set(facts.map((f) => f.batchId))

    // ---- daily trend over the configured trend window -----------------
    // Days without readings emit null so the drilldown chart renders a gap
    // ("no load") rather than a misleading dip to zero.
    const today = localDateStr(new Date())
    const dailyTrend: { date: string; energyKwh: number | null; emissionsCo2e: number | null; records: number }[] = []
    for (let i = trendDays - 1; i >= 0; i--) {
      const d = addDays(parseIsoDate(today), -i)
      const dateStr = fmtUtcDate(d)
      const dayStart = new Date(`${dateStr}T00:00:00`)
      const dayEnd = new Date(dayStart.getTime() + 86400000)
      const dayFacts = facts.filter((f) => f.readingDate >= dayStart && f.readingDate < dayEnd)
      dailyTrend.push({
        date: dateStr,
        energyKwh: dayFacts.length > 0 ? Math.round(dayFacts.reduce((a, f) => a + f.energyKwh, 0) * 100) / 100 : null,
        emissionsCo2e: dayFacts.length > 0 ? Math.round(dayFacts.reduce((a, f) => a + f.emissionsCo2e, 0) * 100) / 100 : null,
        records: dayFacts.length,
      })
    }

    // ---- recent rows (10 latest readings) -----------------------------
    const recentRows = facts.slice(0, 10).map((f) => ({
      recordId: f.recordId,
      readingDate: f.readingDate.toISOString(),
      energyKwh: f.energyKwh,
      emissionsCo2e: f.emissionsCo2e,
      batchId: f.batchId,
      sourceFileName: f.sourceFileName,
      loadedAt: f.loadedAt.toISOString(),
    }))

    return NextResponse.json({
      site: {
        siteId: site.siteId,
        siteName: site.siteName,
        country: site.country,
        region: site.region,
        siteType: site.siteType,
        activeFlag: site.activeFlag,
        totalEnergyKwh: Math.round(totalEnergy * 100) / 100,
        totalEmissionsCo2e: Math.round(totalEmissions * 100) / 100,
        recordCount: facts.length,
        carbonIntensity: totalEnergy > 0 ? Math.round((totalEmissions / totalEnergy) * 1000) / 1000 : 0,
        firstReading: readingDates[0]?.toISOString() ?? null,
        latestReading: readingDates[readingDates.length - 1]?.toISOString() ?? null,
        batches: batches.size,
      },
      dailyTrend,
      recentRows,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load site detail' },
      { status: 500 },
    )
  }
}
