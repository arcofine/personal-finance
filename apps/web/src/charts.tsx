import type { ReactNode } from "react";

export interface ChartSeries {
  name: string;
  color: string;
  values: (number | null)[];
}

export function ChartLegend({ series }: { series: { name: string; color: string }[] }) {
  return (
    <div className="legend">
      {series.map((item) => (
        <span key={item.name}>
          <i className="swatch" style={{ background: item.color }} />
          {item.name}
        </span>
      ))}
    </div>
  );
}

export function BarChart({
  label,
  labels,
  series,
  format = String,
}: {
  label: string;
  labels: string[];
  series: ChartSeries[];
  format?: (value: number) => string;
}) {
  const nums = series.flatMap((item) => item.values).filter((value): value is number => value != null);
  const max = Math.max(1, ...nums.map((value) => Math.max(0, value)));

  return (
    <div className="chart" role="img" aria-label={label}>
      <div className="chart-plot">
        {labels.map((month, index) => (
          <div className="chart-group" key={month}>
            <div className="chart-bars">
              {series.map((item) => {
                const value = item.values[index];
                if (value == null || value <= 0) {
                  return <span className="chart-gap" key={item.name} />;
                }
                return (
                  <span
                    key={item.name}
                    className="chart-bar"
                    title={`${item.name}, ${month}: ${format(value)}`}
                    style={{
                      height: `${Math.max(2, (value / max) * 100)}%`,
                      background: item.color,
                    }}
                  />
                );
              })}
            </div>
            <div className="chart-label">{month}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LineChart({
  label,
  labels,
  series,
  format = String,
}: {
  label: string;
  labels: string[];
  series: { name: string; color: string; values: number[] }[];
  format?: (value: number) => string;
}) {
  const nums = series.flatMap((item) => item.values);
  const min = Math.min(0, ...nums);
  const max = Math.max(1, ...nums);
  const span = max - min || 1;
  const last = Math.max(1, labels.length - 1);

  const points = series.map((item) =>
    item.values.map((value, index) => ({
      x: labels.length === 1 ? 50 : (index / last) * 100,
      y: ((value - min) / span) * 100,
      value,
    })),
  );

  return (
    <div className="line-chart" role="img" aria-label={label}>
      <div className="line-plot">
        <svg className="line-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {series.map((item, seriesIndex) => (
            <polyline
              key={item.name}
              fill="none"
              stroke={item.color}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              points={points[seriesIndex]?.map((point) => `${point.x},${100 - point.y}`).join(" ")}
            />
          ))}
        </svg>
        {series.map((item, seriesIndex) =>
          points[seriesIndex]?.map((point, index) => (
            <span
              key={`${item.name}-${labels[index] ?? index}`}
              className="line-dot"
              title={`${item.name}, ${labels[index]}: ${format(point.value)}`}
              style={{
                left: `${point.x}%`,
                bottom: `${point.y}%`,
                background: item.color,
              }}
            />
          )),
        )}
      </div>
      <div className="line-labels">
        {labels.map((month) => (
          <span key={month}>{month}</span>
        ))}
      </div>
    </div>
  );
}

export function ChartFrame({
  title,
  legend,
  children,
  note,
}: {
  title: string;
  legend?: ReactNode;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <section className="panel chart-panel">
      <div className="chart-head">
        <h2>{title}</h2>
        {legend}
      </div>
      {children}
      {note ? <p className="tab-note">{note}</p> : null}
    </section>
  );
}
