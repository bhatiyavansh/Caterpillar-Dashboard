"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const axis = {
  stroke: "rgba(255,255,255,0.25)",
  tick: { fill: "#9aa3ad", fontSize: 11 },
  tickLine: false,
};

const tooltipStyle = {
  contentStyle: {
    background: "#14171c",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 6,
    fontSize: 12,
  },
  labelStyle: { color: "#9aa3ad", fontSize: 11 },
  itemStyle: { color: "#e9edf2" },
};

export const CHART_COLORS = {
  cat: "#ffcd11",
  ok: "#3ddc84",
  warn: "#ffb020",
  crit: "#ff4d4f",
  info: "#4aa8ff",
  muted: "#6b7280",
};

function Grid() {
  return <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />;
}

export function TrendAreaChart({
  data,
  dataKey,
  xKey = "t",
  color = CHART_COLORS.cat,
  unit = "",
  height = 200,
  domain,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  xKey?: string;
  color?: string;
  unit?: string;
  height?: number;
  domain?: [number | "auto", number | "auto"];
}) {
  const gid = `grad-${dataKey}-${color.replace("#", "")}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.45} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <Grid />
        <XAxis dataKey={xKey} {...axis} minTickGap={24} />
        <YAxis {...axis} width={46} domain={domain ?? ["auto", "auto"]} unit={unit} />
        <Tooltip {...tooltipStyle} />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gid})`}
          isAnimationActive={false}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MultiBarChart({
  data,
  xKey,
  bars,
  height = 220,
  stacked,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  bars: { key: string; name: string; color: string }[];
  height?: number;
  stacked?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
        <Grid />
        <XAxis dataKey={xKey} {...axis} />
        <YAxis {...axis} width={46} />
        <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
        <Legend wrapperStyle={{ fontSize: 11, color: "#9aa3ad" }} />
        {bars.map((b) => (
          <Bar
            key={b.key}
            dataKey={b.key}
            name={b.name}
            fill={b.color}
            stackId={stacked ? "a" : undefined}
            radius={stacked ? 0 : [3, 3, 0, 0]}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MultiLineChart({
  data,
  xKey,
  lines,
  height = 220,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  lines: { key: string; name: string; color: string }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
        <Grid />
        <XAxis dataKey={xKey} {...axis} />
        <YAxis {...axis} width={46} />
        <Tooltip {...tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11, color: "#9aa3ad" }} />
        {lines.map((l) => (
          <Line
            key={l.key}
            type="monotone"
            dataKey={l.key}
            name={l.name}
            stroke={l.color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function HealthDonut({
  data,
  height = 220,
}: {
  data: { name: string; value: number; color: string }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="58%"
          outerRadius="82%"
          paddingAngle={2}
          stroke="none"
          isAnimationActive={false}
        >
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Pie>
        <Tooltip {...tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11, color: "#9aa3ad" }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Tiny inline trend line used inside stat tiles. */
export function Sparkline({ data, color = CHART_COLORS.cat }: { data: number[]; color?: string }) {
  const points = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={points} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={color} fillOpacity={0.12} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
