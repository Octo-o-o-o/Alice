import { useState } from "react";

export interface BarChartDataPoint {
  label: string;
  value: number;
  secondaryValue?: number;
  color?: string;
}

interface BarChartProps {
  data: BarChartDataPoint[];
  maxValue?: number;
  height?: number;
  showLabels?: boolean;
  labelInterval?: number;
  barColor?: string;
  hoverColor?: string;
  formatValue?: (value: number) => string;
  formatSecondary?: (value: number) => string;
}

export default function BarChart({
  data,
  maxValue: providedMax,
  height = 96,
  showLabels = true,
  labelInterval = 2,
  barColor = "bg-blue-500/50",
  hoverColor = "bg-blue-500",
  formatValue = String,
  formatSecondary,
}: BarChartProps): React.ReactElement {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const maxValue = providedMax ?? Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="relative">
      {hoveredIndex !== null && (
        <div
          className="absolute z-10 bg-gray-900 border border-white/10 rounded-lg px-2 py-1.5 shadow-lg pointer-events-none"
          style={{
            bottom: `${height + 8}px`,
            left: `${(hoveredIndex / data.length) * 100}%`,
            transform: "translateX(-50%)",
          }}
        >
          <div className="text-xs text-gray-200 font-medium whitespace-nowrap">
            {data[hoveredIndex].label}
          </div>
          <div className="text-xs text-blue-400 font-mono">
            {formatValue(data[hoveredIndex].value)}
          </div>
          {data[hoveredIndex].secondaryValue !== undefined &&
            formatSecondary && (
              <div className="text-[10px] text-green-400 font-mono">
                {formatSecondary(data[hoveredIndex].secondaryValue!)}
              </div>
            )}
        </div>
      )}

      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((point, index) => {
          const heightPercent = (point.value / maxValue) * 100;
          return (
            <div
              key={`${index}-${point.label}`}
              className="flex-1 flex flex-col items-center"
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <div
                className={`w-full rounded-t transition-colors cursor-pointer ${
                  hoveredIndex === index ? hoverColor : barColor
                }`}
                style={{
                  height: `${heightPercent}%`,
                  minHeight: point.value > 0 ? "2px" : "0",
                  backgroundColor: point.color,
                }}
              />
              {showLabels && index % labelInterval === 0 && (
                <span className="text-[8px] text-gray-600 mt-1 truncate w-full text-center">
                  {point.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
