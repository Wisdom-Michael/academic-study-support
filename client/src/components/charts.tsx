import { useState } from 'react';

// Chart colours come from CSS custom properties in styles.css, so charts and
// the rest of the interface share one palette. Risk colours were checked for
// colour-blind separation; every chart also has a text table for screen readers.

/** Linear meter: a filled bar on a lighter track of the same hue. */
export function MeterBar({ value, label, tone = 'teal' }: { value: number; label: string; tone?: 'teal' | 'critical' | 'gold' }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={`meter meter-${tone}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <span className="meter-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Circular meter with the value in the middle. */
export function RingMeter({ value, label, size = 88, stroke = 8, caption }: {
  value: number | null;
  label: string;
  size?: number;
  stroke?: number;
  caption?: string;
}) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, Math.round(value)));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <figure className="ring" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${value === null ? 'no data' : `${pct}%`}`}>
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        {pct > 0 && (
          <circle
            className="ring-fill"
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <span className="ring-value" aria-hidden="true">{value === null ? '–' : `${pct}%`}</span>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  color: string; // CSS colour, e.g. 'var(--risk-high)'
}

/** Part-to-whole donut (≤ 6 segments) with a legend; hovering a segment or legend row shows its value. */
export function Donut({ segments, totalLabel }: { segments: DonutSegment[]; totalLabel: string }) {
  const [active, setActive] = useState<string | null>(null);
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const size = 148;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const gap = segments.filter((s) => s.value > 0).length > 1 ? 3 : 0; // surface gap between segments

  let offset = 0;
  const arcs = segments.map((s) => {
    const length = total ? (s.value / total) * circumference : 0;
    const arc = { ...s, dash: Math.max(0, length - gap), offset };
    offset += length;
    return arc;
  });
  const shown = segments.find((s) => s.key === active);

  return (
    <div className="donut">
      <div className="donut-figure">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
          {arcs.filter((a) => a.value > 0).map((a) => (
            <circle
              key={a.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={active === a.key ? stroke + 4 : stroke}
              strokeDasharray={`${a.dash} ${circumference - a.dash}`}
              strokeDashoffset={-a.offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              className="donut-arc"
              onMouseEnter={() => setActive(a.key)}
              onMouseLeave={() => setActive(null)}
            />
          ))}
        </svg>
        <div className="donut-center" aria-hidden="true">
          <span className="donut-value">{shown ? shown.value : total}</span>
          <span className="donut-label">{shown ? shown.label : totalLabel}</span>
        </div>
      </div>
      <ul className="legend">
        {segments.map((s) => (
          <li
            key={s.key}
            tabIndex={0}
            onMouseEnter={() => setActive(s.key)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(s.key)}
            onBlur={() => setActive(null)}
          >
            <span className="swatch" style={{ background: s.color }} aria-hidden="true" />
            <span className="legend-label">{s.label}</span>
            <span className="legend-value">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Round a maximum up to a clean, even axis value (so the halfway tick is a whole number). */
function niceMax(value: number): number {
  if (value <= 0) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((m) => m * magnitude >= value) ?? 10;
  const max = step * magnitude;
  return max % 2 === 0 ? max : max + 1;
}

export interface Column {
  key: string;
  label: string;      // short axis label
  fullLabel: string;  // used in the tooltip and table
  value: number;
  highlight?: boolean; // e.g. the current day, drawn in the accent colour
}

/** Single-series column chart with hover/focus tooltips and a hidden table view. */
export function ColumnChart({ columns, unit, unitOne, caption, height = 180 }: {
  columns: Column[];
  unit: string;      // e.g. "logins"
  unitOne: string;   // e.g. "login"
  caption: string;
  height?: number;
}) {
  const [active, setActive] = useState<string | null>(null);
  const max = niceMax(Math.max(...columns.map((c) => c.value), 0));
  const ticks = [max, max / 2, 0];
  const unitFor = (value: number) => (value === 1 ? unitOne : unit);
  const tooltipClass = (index: number) =>
    index < 2 ? 'tooltip tooltip-start' : index >= columns.length - 2 ? 'tooltip tooltip-end' : 'tooltip';

  return (
    <figure className="columns">
      <div className="columns-plot" style={{ height }}>
        <div className="columns-ticks" aria-hidden="true">
          {ticks.map((t) => <span key={t}>{t}</span>)}
        </div>
        <div className="columns-area">
          {ticks.map((t) => (
            <span key={t} className="gridline" style={{ bottom: `${(t / max) * 100}%` }} aria-hidden="true" />
          ))}
          {columns.map((c, index) => (
            <div
              key={c.key}
              className="column-slot"
              tabIndex={0}
              aria-label={`${c.fullLabel}: ${c.value} ${unitFor(c.value)}`}
              onMouseEnter={() => setActive(c.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(c.key)}
              onBlur={() => setActive(null)}
            >
              <span
                className={`column${c.highlight ? ' column-highlight' : ''}${active === c.key ? ' column-active' : ''}`}
                style={{ height: `${(c.value / max) * 100}%` }}
              >
                {active === c.key && (
                  <span className={tooltipClass(index)} role="tooltip">
                    <strong>{c.value}</strong> {unitFor(c.value)}
                    <span>{c.fullLabel}</span>
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="columns-axis" aria-hidden="true">
        <span />
        {columns.map((c) => <span key={c.key}>{c.label}</span>)}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {columns.map((c) => (
            <tr key={c.key}><th scope="row">{c.fullLabel}</th><td>{c.value} {unitFor(c.value)}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
