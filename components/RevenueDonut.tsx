// The dashboard's "Revenue Mix" donut, in its own chunk. It was the only chart
// in App.tsx, so every worker tablet and wall TV downloaded and parsed the
// charts library (~110 KB gzipped) at startup just for this one donut.
import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

export interface RevenueSlice { revenue: number; fullName: string; color: string }

export default function RevenueDonut({ data, isMobile, hoveredIdx, onHover }: {
  data: RevenueSlice[];
  isMobile: boolean;
  hoveredIdx: number | null;
  onHover: (i: number) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height={isMobile ? 220 : 260}>
      <PieChart>
        <defs>
          {data.map((d, i) => (
            <linearGradient key={`gradPie-${i}`} id={`gradPie-${i}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={d.color} stopOpacity={1} />
              <stop offset="100%" stopColor={d.color} stopOpacity={0.6} />
            </linearGradient>
          ))}
        </defs>
        <Pie
          data={data}
          cx="50%" cy="50%"
          innerRadius={isMobile ? 62 : 76}
          outerRadius={isMobile ? 96 : 116}
          paddingAngle={3}
          dataKey="revenue"
          nameKey="fullName"
          stroke="rgba(9,9,11,0.9)"
          strokeWidth={2}
          isAnimationActive
          animationDuration={900}
          animationEasing="ease-out"
          cornerRadius={6}
          onMouseEnter={(_, i) => onHover(i)}
        >
          {data.map((_, i) => (
            <Cell
              key={i}
              fill={`url(#gradPie-${i})`}
              style={{
                filter: hoveredIdx !== null && hoveredIdx !== i ? 'opacity(0.35)' : 'none',
                transition: 'filter 0.25s ease',
              }}
            />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}
