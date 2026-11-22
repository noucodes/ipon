import { useMemo, useRef, useState } from 'react';
import { formatPHP } from '@ft/shared';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

/** Compact peso label for axis ticks: ₱12.3k, ₱1.2M */
function shortPHP(cents) {
  const v = cents / 100;
  const abs = Math.abs(v);
  const s = abs >= 1e6 ? `${(abs / 1e6).toFixed(1)}M` : abs >= 1e3 ? `${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k` : abs.toFixed(0);
  return `${v < 0 ? '−' : ''}₱${s}`;
}

/**
 * Net worth over time: single series line + soft area, recessive grid,
 * crosshair + tooltip on hover/touch, and a visually hidden table for screen readers.
 */
export function NetWorthChart({ points }) {
  const W = 1040; // wide and flat so it doesn't tower over the page on desktop
  const H = 260;
  const pad = { top: 16, right: 16, bottom: 28, left: 56 };
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);

  const geo = useMemo(() => {
    if (!points?.length) return null;
    const vals = points.map((p) => p.net_worth_cents);
    let min = Math.min(...vals, 0);
    let max = Math.max(...vals, 0);
    if (min === max) { max += 100_00; min -= 100_00; }
    const span = max - min;
    const x = (i) => pad.left + (points.length === 1 ? (W - pad.left - pad.right) / 2 : (i / (points.length - 1)) * (W - pad.left - pad.right));
    const y = (v) => pad.top + (1 - (v - min) / span) * (H - pad.top - pad.bottom);
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.net_worth_cents).toFixed(1)}`).join(' ');
    const area = `${line} L${x(points.length - 1).toFixed(1)},${y(min)} L${x(0).toFixed(1)},${y(min)} Z`;
    const ticks = [0, 0.5, 1].map((f) => min + f * span);
    return { x, y, line, area, ticks, zeroY: y(0), hasNegative: min < 0 };
  }, [points]);

  if (!geo) return <p className="muted">No history yet.</p>;

  function onMove(e) {
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    points.forEach((_, i) => { if (Math.abs(geo.x(i) - px) < Math.abs(geo.x(best) - px)) best = i; });
    setHover(best);
  }

  const h = hover != null ? points[hover] : null;

  return (
    <div className="chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Net worth by month"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="nwfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {geo.ticks.map((v, i) => (
          <g key={i}>
            <line x1={pad.left} x2={W - pad.right} y1={geo.y(v)} y2={geo.y(v)} className="grid" />
            <text x={pad.left - 8} y={geo.y(v) + 4} textAnchor="end" className="tick">{shortPHP(v)}</text>
          </g>
        ))}
        {geo.hasNegative && <line x1={pad.left} x2={W - pad.right} y1={geo.zeroY} y2={geo.zeroY} className="zero" />}
        <path d={geo.area} fill="url(#nwfill)" />
        <path d={geo.line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          (i === 0 || i === points.length - 1 || points.length <= 6 || i % 2 === 0) && (
            <text key={p.month} x={geo.x(i)} y={H - 8} textAnchor={i === 0 && points.length > 1 ? 'start' : i === points.length - 1 && points.length > 1 ? 'end' : 'middle'} className="tick">{monthLabel(p.month)}</text>
          )
        ))}
        {h && (
          <g>
            <line x1={geo.x(hover)} x2={geo.x(hover)} y1={pad.top} y2={H - pad.bottom} className="crosshair" />
            <circle cx={geo.x(hover)} cy={geo.y(h.net_worth_cents)} r="5" fill="var(--accent)" stroke="var(--card)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && (
        <div
          className="tooltip"
          style={{
            left: `${(geo.x(hover) / W) * 100}%`,
            // keep the tooltip inside the chart near the left/right edges
            transform: geo.x(hover) / W > 0.85 ? 'translateX(-100%)' : geo.x(hover) / W < 0.15 ? 'translateX(0)' : 'translateX(-50%)',
          }}
        >
          <span className="muted">{monthLabel(h.month)}</span>
          <strong>{formatPHP(h.net_worth_cents)}</strong>
        </div>
      )}
      <table className="sr-only">
        <caption>Net worth by month</caption>
        <tbody>{points.map((p) => <tr key={p.month}><th>{monthLabel(p.month)}</th><td>{formatPHP(p.net_worth_cents)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** Horizontal bars, one hue (magnitude), every row labelled with its amount and share. */
export function CategoryBars({ rows, total }) {
  if (!rows?.length) return <p className="muted">Nothing spent this month yet.</p>;
  const max = Math.max(...rows.map((r) => r.total_cents));
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.category_id ?? r.name} title={`${r.name}: ${formatPHP(r.total_cents)}`}>
          <div className="bar-head">
            <span>{r.name}</span>
            <span className="num">{formatPHP(r.total_cents)} <span className="muted">· {total ? Math.round((r.total_cents / total) * 100) : 0}%</span></span>
          </div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(2, (r.total_cents / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export function Progress({ value }) {
  return (
    <div className="bar-track" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin="0" aria-valuemax="100">
      <div className="bar-fill accent" style={{ width: `${Math.max(2, value * 100)}%` }} />
    </div>
  );
}
