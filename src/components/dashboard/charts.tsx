'use client'

// =====================================================================
// ESG DataOps Command Center — operational charts (recharts)
// Polished: lighter gridlines, area fill on trend lines, donut center
// total, rounded bar caps, rotated recon x-axis labels (VLM-driven).
// =====================================================================

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const EMERALD = '#10b981'
const RED = '#ef4444'
const AMBER = '#f59e0b'
const ORANGE = '#f97316'
const ZINC = '#a1a1aa'
const TEAL = '#14b8a6'
const GRID = 'rgba(113,113,122,0.12)'
const AXIS = '#52525b'

const tooltipStyle = {
  backgroundColor: 'var(--popover, #fff)',
  border: '1px solid rgba(113,113,122,0.3)',
  borderRadius: 8,
  fontSize: 12,
  color: 'inherit',
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
} as const

const tooltipItemStyle = {
  padding: '2px 0',
} as const

/** Jobs per day: success vs failed (stacked, rounded caps). */
export function RunsByDayChart({
  data,
}: {
  data: { date: string; jobsSuccess: number; jobsFailed: number }[]
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 6, right: 12, left: -10, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: AXIS }}
          tickFormatter={(v: string) => v.slice(5)}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis tick={{ fontSize: 10, fill: AXIS }} allowDecimals={false} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} cursor={{ fill: 'rgba(113,113,122,0.06)' }} />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" />
        <Bar dataKey="jobsSuccess" name="Succeeded" stackId="a" fill={EMERALD} radius={[0, 0, 0, 0]} maxBarSize={28} />
        <Bar dataKey="jobsFailed" name="Failed" stackId="a" fill={RED} radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** DQ pass/fail trend per day (with area fill under the passed line).
 *  Dual-axis: passes scale on the left axis; failures (usually 0–4 vs
 *  ~37 passes) get their own right axis so the red line is never
 *  flattened into the floor (VLM-driven readability fix). */
export function DqTrendChart({
  data,
}: {
  data: { date: string; dqPass: number; dqFail: number }[]
}) {
  const maxFail = Math.max(1, ...data.map((d) => d.dqFail))
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 6, right: 4, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="dqPassFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={EMERALD} stopOpacity={0.25} />
            <stop offset="100%" stopColor={EMERALD} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: AXIS }}
          tickFormatter={(v: string) => v.slice(5)}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis yAxisId="pass" tick={{ fontSize: 10, fill: AXIS }} allowDecimals={false} tickLine={false} axisLine={false} />
        <YAxis
          yAxisId="fail"
          orientation="right"
          domain={[0, Math.max(4, Math.ceil(maxFail * 1.3))]}
          allowDecimals={false}
          tick={{ fontSize: 10, fill: RED }}
          tickLine={false}
          axisLine={false}
          width={26}
        />
        <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" />
        <Area
          yAxisId="pass"
          type="monotone"
          dataKey="dqPass"
          name="Checks passed (area)"
          stroke={EMERALD}
          fill="url(#dqPassFill)"
          strokeWidth={0}
          activeDot={false}
        />
        <Line
          yAxisId="pass"
          type="monotone"
          dataKey="dqPass"
          name="Checks passed"
          stroke={EMERALD}
          strokeWidth={2.5}
          dot={{ r: 2, fill: EMERALD, strokeWidth: 0 }}
          activeDot={{ r: 4 }}
        />
        <Line
          yAxisId="fail"
          type="monotone"
          dataKey="dqFail"
          name="Checks failed (right axis)"
          stroke={RED}
          strokeWidth={2.5}
          dot={{ r: 2, fill: RED, strokeWidth: 0 }}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** Open incidents by severity (donut with centered total). */
export function IncidentsDonut({ data }: { data: { name: string; value: number }[] }) {
  const palette: Record<string, string> = { P1: RED, P2: ORANGE, P3: AMBER, P4: ZINC }
  const total = data.reduce((a, d) => a + d.value, 0)
  if (total === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
        No open incidents
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80} paddingAngle={2}>
          {data.map((d) => (
            <Cell key={d.name} fill={palette[d.name] ?? ZINC} stroke="var(--background, #fff)" strokeWidth={2} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" />
        {/* centered total label */}
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: 22, fontWeight: 700, fill: 'var(--foreground, #18181b)' }}
        >
          {total}
        </text>
        <text
          x="50%"
          y="60%"
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: 9, fill: AXIS, letterSpacing: 0.5 }}
        >
          OPEN
        </text>
      </PieChart>
    </ResponsiveContainer>
  )
}

/** Source vs target row counts for the latest batches (grouped bars + rotated labels). */
export function ReconChart({
  data,
}: {
  data: { batchId: string; businessDate: string; sourceCount: number; targetCount: number }[]
}) {
  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={data} margin={{ top: 6, right: 12, left: -10, bottom: 12 }} barGap={2} barCategoryGap="22%">
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="businessDate"
          tick={{ fontSize: 9, fill: AXIS }}
          tickFormatter={(v: string) => (typeof v === 'string' && v.length >= 10 ? v.slice(5) : String(v))}
          angle={-35}
          textAnchor="end"
          height={42}
          interval={0}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis tick={{ fontSize: 10, fill: AXIS }} allowDecimals={false} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={tooltipStyle}
          itemStyle={tooltipItemStyle}
          cursor={{ fill: 'rgba(113,113,122,0.06)' }}
          labelFormatter={(_label: string, payload: { payload?: { batchId?: string } }[]) =>
            payload?.[0]?.payload?.batchId ?? ''
          }
        />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" />
        <Bar dataKey="sourceCount" name="Source (staging)" fill={ZINC} radius={[4, 4, 0, 0]} maxBarSize={18} />
        <Bar dataKey="targetCount" name="Target (warehouse)" fill={EMERALD} radius={[4, 4, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Site-level energy consumption bar chart (Site Analytics tab).
 *  Horizontal bars — gives full room for site names (VLM fix: no more
 *  truncated / overlapping x-axis labels). */
export function SiteEnergyBarChart({
  data,
}: {
  data: { siteName: string; energyKwh: number; emissionsCo2e: number }[]
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(240, data.length * 34 + 24)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 6, right: 16, left: 8, bottom: 6 }}
        barGap={2}
        barCategoryGap="18%"
      >
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 10, fill: AXIS }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis
          type="category"
          dataKey="siteName"
          tick={{ fontSize: 10, fill: AXIS }}
          width={110}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} cursor={{ fill: 'rgba(113,113,122,0.06)' }} />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" />
        <Bar dataKey="energyKwh" name="Energy (kWh)" fill={EMERALD} radius={[0, 4, 4, 0]} maxBarSize={12}>
          <LabelList
            dataKey="energyKwh"
            position="right"
            formatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`)}
            style={{ fontSize: 9, fill: AXIS }}
          />
        </Bar>
        <Bar dataKey="emissionsCo2e" name="Emissions (kg CO₂e)" fill={ORANGE} radius={[0, 4, 4, 0]} maxBarSize={12}>
          <LabelList
            dataKey="emissionsCo2e"
            position="right"
            formatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`)}
            style={{ fontSize: 9, fill: AXIS }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Daily kWh trend across the warehouse (Site Analytics tab).
 *  Days without a batch render as a gap (null + connectNulls=false) —
 *  an honest "no load" signal instead of a misleading dip to zero. */
export function DailyEnergyTrendChart({
  data,
}: {
  data: { date: string; energyKwh: number | null; emissionsCo2e: number | null }[]
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 6, right: 12, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="energyFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={EMERALD} stopOpacity={0.22} />
            <stop offset="100%" stopColor={EMERALD} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: AXIS }}
          tickFormatter={(v: string) => v.slice(5)}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis tick={{ fontSize: 10, fill: AXIS }} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" />
        <Area
          type="monotone"
          dataKey="energyKwh"
          name="Energy (kWh) area"
          stroke={EMERALD}
          fill="url(#energyFill)"
          strokeWidth={0}
          activeDot={false}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="energyKwh"
          name="Energy (kWh)"
          stroke={EMERALD}
          strokeWidth={2.5}
          connectNulls={false}
          dot={{ r: 2.5, fill: EMERALD, strokeWidth: 0 }}
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="emissionsCo2e"
          name="Emissions (kg CO₂e)"
          stroke={ORANGE}
          strokeWidth={2.5}
          connectNulls={false}
          dot={{ r: 2.5, fill: ORANGE, strokeWidth: 0 }}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** Inline SVG sparkline (no recharts overhead) — Sites directory table. */
export function Sparkline({
  values,
  width = 96,
  height = 26,
  stroke = EMERALD,
}: {
  values: number[]
  width?: number
  height?: number
  stroke?: string
}) {
  const pts = values.filter((v) => Number.isFinite(v))
  if (pts.length < 2) {
    return <div className="text-[10px] text-muted-foreground/60" style={{ width }}>—</div>
  }
  const max = Math.max(...pts)
  const min = Math.min(...pts)
  const range = max - min || 1
  const stepX = width / (pts.length - 1)
  const y = (v: number) => height - 3 - ((v - min) / range) * (height - 6)
  const path = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const areaPath = `${path} L${width},${height} L0,${height} Z`
  const lastX = (pts.length - 1) * stepX
  const lastY = y(pts[pts.length - 1])
  const gradId = `spark-grad-${stroke.replace('#', '')}`
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" role="img" aria-label="14-day daily kWh trend">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={2} fill={stroke} />
    </svg>
  )
}

/** Pipeline timeline (Gantt-like) — task execution across a batch. */
export function PipelineGanttChart({
  data,
}: {
  data: { taskId: string; startSeconds: number; durationSeconds: number; status: string }[]
}) {
  const statusFill: Record<string, string> = {
    SUCCESS: EMERALD,
    FAILED: RED,
    SKIPPED: ZINC,
    RUNNING: TEAL,
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, data.length * 36 + 20)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 6, right: 24, left: 0, bottom: 6 }}
        barCategoryGap="20%"
      >
        <CartesianGrid stroke={'rgba(113,113,122,0.18)'} horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 10, fill: AXIS }}
          tickFormatter={(v: number) => `${v.toFixed(0)}s`}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis
          type="category"
          dataKey="taskId"
          tick={{ fontSize: 10, fill: AXIS }}
          tickFormatter={(v: string) => v.replace('_task', '')}
          width={168}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          itemStyle={tooltipItemStyle}
          formatter={(value: number, _name: string, props: { payload?: { status?: string; startSeconds?: number } }) => [
            `start=${(props?.payload?.startSeconds ?? 0).toFixed(2)}s · duration=${value.toFixed(2)}s · ${props?.payload?.status ?? ''}`,
            'Task',
          ]}
        />
        {/* invisible "spacer" bar that shifts the colored bar to its true start time */}
        <Bar dataKey="startSeconds" name="Start" stackId="time" fill="transparent" maxBarSize={18} />
        <Bar dataKey="durationSeconds" name="Duration" stackId="time" radius={[0, 4, 4, 0]} maxBarSize={18}>
          {data.map((d) => (
            <Cell key={d.taskId} fill={statusFill[d.status] ?? ZINC} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Compact status color legend strip rendered under the Gantt chart. */
export function GanttLegend() {
  const items = [
    { label: 'Success', fill: EMERALD },
    { label: 'Failed', fill: RED },
    { label: 'Skipped', fill: ZINC },
    { label: 'Running', fill: TEAL },
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: it.fill }}
            aria-hidden
          />
          {it.label}
        </span>
      ))}
    </div>
  )
}

/** Severity donut for incident stats (alias used by Site Analytics when relevant). */
export const IncidentSeverityDonut = IncidentsDonut
