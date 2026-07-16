"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { formatMonth, formatMonthShort } from "@/lib/month";
import { CATEGORICAL_SLOTS, CHROME } from "@/lib/palette";
import { ChartTooltip } from "./ChartTooltip";
import { useDarkMode } from "./useThemeMode";

export interface TrendDatum {
  month: string; // YYYY-MM
  incomeCents: number;
  spendingCents: number;
}

// Two series (income, spending) → categorical slots 1 and 2 with a legend.
// Values ride the y-axis, tooltip, and table view — no label on every column.
export function SpendingTrendChart({ data, currency }: { data: TrendDatum[]; currency: string }) {
  const dark = useDarkMode();
  const mode = dark ? "dark" : "light";
  const incomeColor = CATEGORICAL_SLOTS[0]![mode];
  const spendingColor = CATEGORICAL_SLOTS[1]![mode];

  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }} barGap={2}>
          <CartesianGrid
            vertical={false}
            stroke={CHROME.gridline[mode]}
            strokeWidth={1}
          />
          <XAxis
            dataKey="month"
            tickFormatter={formatMonthShort}
            tick={{ fill: CHROME.inkMuted[mode], fontSize: 11 }}
            axisLine={{ stroke: CHROME.baseline[mode] }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => formatCentsCompact(v, currency)}
            tick={{ fill: CHROME.inkMuted[mode], fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <Tooltip
            cursor={{ fill: CHROME.gridline[mode], fillOpacity: 0.4 }}
            content={({ active, payload, label }) => {
              const datum = payload?.[0]?.payload as TrendDatum | undefined;
              if (!active || !datum) return null;
              return (
                <ChartTooltip
                  title={formatMonth(String(label))}
                  rows={[
                    {
                      key: "income",
                      label: "income",
                      value: formatCents(datum.incomeCents, currency),
                      color: incomeColor,
                    },
                    {
                      key: "spending",
                      label: "spending",
                      value: formatCents(datum.spendingCents, currency),
                      color: spendingColor,
                    },
                  ]}
                />
              );
            }}
          />
          <Legend
            formatter={(value: string) => (
              <span style={{ color: CHROME.inkSecondary[mode], fontSize: 12 }}>{value}</span>
            )}
            iconType="square"
            iconSize={10}
          />
          <Bar dataKey="incomeCents" name="Income" fill={incomeColor} barSize={16} radius={[4, 4, 0, 0]} />
          <Bar dataKey="spendingCents" name="Spending" fill={spendingColor} barSize={16} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-ink-muted">View as table</summary>
        <table className="mt-2 text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted">
              <th className="pr-6 font-normal">Month</th>
              <th className="pr-6 font-normal">Income</th>
              <th className="font-normal">Spending</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.month}>
                <td className="pr-6 text-ink-2">{formatMonth(d.month)}</td>
                <td className="pr-6 tabular-nums">{formatCents(d.incomeCents, currency)}</td>
                <td className="tabular-nums">{formatCents(d.spendingCents, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
