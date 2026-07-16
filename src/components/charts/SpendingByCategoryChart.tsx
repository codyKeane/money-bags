"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { CATEGORICAL_SLOTS, CHROME } from "@/lib/palette";
import { ChartTooltip } from "./ChartTooltip";
import { useDarkMode } from "./useThemeMode";

export interface CategorySpendingDatum {
  name: string; // "Uncategorized" for null category
  spentCents: number;
}

// Nominal categories, one series: every bar wears slot-1 blue — identity is
// already on the y-axis labels, so extra hues would just re-encode bar length.
// One series also means no legend; the section title names it.
export function SpendingByCategoryChart({
  data,
  currency,
}: {
  data: CategorySpendingDatum[];
  currency: string;
}) {
  const dark = useDarkMode();
  const mode = dark ? "dark" : "light";
  const series = CATEGORICAL_SLOTS[0]![mode];
  const height = data.length * 32 + 48; // bar band per row + x-axis band

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 56, bottom: 0, left: 8 }}
        >
          <CartesianGrid
            horizontal={false}
            stroke={CHROME.gridline[mode]}
            strokeWidth={1}
          />
          <XAxis
            type="number"
            tickFormatter={(v: number) => formatCentsCompact(v, currency)}
            tick={{ fill: CHROME.inkMuted[mode], fontSize: 11 }}
            axisLine={{ stroke: CHROME.baseline[mode] }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={110}
            tick={{ fill: CHROME.inkSecondary[mode], fontSize: 12 }}
            axisLine={{ stroke: CHROME.baseline[mode] }}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: CHROME.gridline[mode], fillOpacity: 0.4 }}
            content={({ active, payload }) => {
              const datum = payload?.[0]?.payload as CategorySpendingDatum | undefined;
              if (!active || !datum) return null;
              return (
                <ChartTooltip
                  title={datum.name}
                  rows={[
                    {
                      key: "spent",
                      label: "spent",
                      value: formatCents(datum.spentCents, currency),
                      color: series,
                    },
                  ]}
                />
              );
            }}
          />
          <Bar dataKey="spentCents" fill={series} barSize={20} radius={[0, 4, 4, 0]}>
            {/* value at the bar tip, in ink — text never wears the series color */}
            <LabelList
              dataKey="spentCents"
              position="right"
              formatter={(v) => formatCentsCompact(Number(v), currency)}
              style={{ fill: CHROME.inkSecondary[mode], fontSize: 11 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-ink-muted">View as table</summary>
        <table className="mt-2 text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted">
              <th className="pr-6 font-normal">Category</th>
              <th className="font-normal">Spent</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.name}>
                <td className="pr-6 text-ink-2">{d.name}</td>
                <td className="tabular-nums">{formatCents(d.spentCents, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
