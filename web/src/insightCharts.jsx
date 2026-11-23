// Charts for the overview site's planning views. Plain SVG, one axis each, recessive grid,
// hover tooltips on every mark and a hidden table for screen readers.
import { useMemo, useRef, useState } from 'react';
import { formatPHP } from '@ft/shared';

// Validated against the dark card surface (#141b18): lightness band, CVD and contrast all pass.
export const SERIES = { in: '#2a9fb0', out: '#e0614f' };
export const PRIORITY_COLOR = { debt: '#e0614f', home: '#4f8ae6', essential: '#b08820', flexible: '#9a7be0' };
const SAVE = 'var(--accent)';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}`;
export const dayLabel = (d) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

/** ₱12.3k, ₱1.2M for axis ticks */
export function shortPHP(cents) {
  const v = cents / 100;
  const abs = Math.abs(v);
  const s = abs >= 1e6 ? `${(abs / 1e6).toFixed(1)}M` : abs >= 1e3 ? `${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k` : abs.toFixed(0);
  return `${v < 0 ? '−' : ''}₱${s}`;
}

/** Round max up to a tidy number so ticks read well. */
function niceMax(v) {
  if (v <= 0) return 100_00;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p / 2) * 2 * p;
}

function Tooltip({ x, W, children }) {
  const f = x / W;
  return (
    <div className="tooltip" style={{ left: `${f * 100}%`, transform: f > 0.8 ? 'translateX(-100%)' : f < 0.2 ? 'translateX(0)' : 'translateX(-50%)' }}>
      {children}
    </div>
  );
}

/** Rounded-top bar path anchored to the baseline (4px data-end radius). */
function barPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/**
 * Everyday spending per day this month against the daily budget.
 * Days over budget turn coral (and are labelled in the tooltip), the rest stay teal.
 */
export function DailySpendChart({ days, budget, month, today }) {
  const W = 760, H = 240;
  const pad = { top: 18, right: 12, bottom: 26, left: 52 };
  const [hover, setHover] = useState(null);

  const all = useMemo(() => {
    // Whole month, so the days still ahead show as empty slots
    const [y, m] = month.split('-').map(Number);
    const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const map = new Map(days.map((d) => [d.date, d]));
    return Array.from({ length: n }, (_, i) => {
      const date = `${month}-${String(i + 1).padStart(2, '0')}`;
      return map.get(date) ?? { date, everyday_cents: 0, bills_cents: 0, income_cents: 0, future: date > today };
    });
  }, [days, month, today]);

  const max = niceMax(Math.max(budget * 1.15, ...all.map((d) => d.everyday_cents)));
  const iw = W - pad.left - pad.right;
  const slot = iw / all.length;
  const bw = Math.max(4, slot - 4); // 2px surface gap each side
  const y = (v) => pad.top + (1 - v / max) * (H - pad.top - pad.bottom);
  const base = y(0);
  const over = all.filter((d) => !d.future && budget > 0 && d.everyday_cents > budget).length;
  const h = hover != null ? all[hover] : null;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Everyday spending per day this month" onPointerLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.left} x2={W - pad.right} y1={y(max * f)} y2={y(max * f)} className="grid" />
            <text x={pad.left - 8} y={y(max * f) + 4} textAnchor="end" className="tick">{shortPHP(max * f)}</text>
          </g>
        ))}
        {all.map((d, i) => {
          const x = pad.left + i * slot + (slot - bw) / 2;
          const isOver = budget > 0 && d.everyday_cents > budget;
          return (
            <g key={d.date}>
              {d.future
                ? <rect x={x} y={base - 2} width={bw} height={2} rx={1} fill="var(--border)" />
                : <path d={barPath(x, y(d.everyday_cents), bw, base - y(d.everyday_cents))} fill={isOver ? SERIES.out : SERIES.in} opacity={hover == null || hover === i ? 1 : 0.55} />}
              {d.date === today && <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="tick strong">Today</text>}
              {(i === 0 || (i + 1) % 5 === 0) && d.date !== today && Math.abs(i - all.findIndex((z) => z.date === today)) > 1 && (
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="tick">{i + 1}</text>
              )}
              {/* Hit target bigger than the mark */}
              <rect x={pad.left + i * slot} y={pad.top} width={slot} height={H - pad.top - pad.bottom} fill="transparent" onPointerEnter={() => setHover(i)} />
            </g>
          );
        })}
        {budget > 0 && (
          <g pointerEvents="none">
            <line x1={pad.left} x2={W - pad.right} y1={y(budget)} y2={y(budget)} className="budget-line" />
            <text x={W - pad.right} y={y(budget) - 6} textAnchor="end" className="tick strong">Daily budget {shortPHP(budget)}</text>
          </g>
        )}
      </svg>
      {h && (
        <Tooltip x={pad.left + hover * slot + slot / 2} W={W}>
          <span className="muted">{dayLabel(h.date)}{h.future ? ' · ahead' : ''}</span>
          {!h.future && <strong>{formatPHP(h.everyday_cents)} everyday</strong>}
          {!h.future && budget > 0 && (
            <span className={h.everyday_cents > budget ? 'expense' : 'income'}>
              {h.everyday_cents > budget ? `▲ ${formatPHP(h.everyday_cents - budget)} over` : `▼ ${formatPHP(budget - h.everyday_cents)} under`}
            </span>
          )}
          {h.bills_cents > 0 && <span className="muted">+ {formatPHP(h.bills_cents)} bills & installments</span>}
        </Tooltip>
      )}
      <div className="legend">
        <span><i style={{ background: SERIES.in }} /> Within budget</span>
        <span><i style={{ background: SERIES.out }} /> Over budget{over ? ` · ${over} day${over === 1 ? '' : 's'}` : ''}</span>
        <span><i className="dash" /> Today's daily budget</span>
      </div>
      <table className="sr-only">
        <caption>Everyday spending per day</caption>
        <tbody>{all.filter((d) => !d.future).map((d) => <tr key={d.date}><th>{d.date}</th><td>{formatPHP(d.everyday_cents)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** Projected money on hand: paydays push it up, bills and usual spending pull it down. */
export function ForecastChart({ points }) {
  const W = 760, H = 250;
  const pad = { top: 20, right: 14, bottom: 26, left: 56 };
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);

  const geo = useMemo(() => {
    if (!points?.length) return null;
    const vals = points.map((p) => p.balance_cents);
    let min = Math.min(0, ...vals);
    let max = Math.max(...vals);
    if (max === min) max += 100_00;
    max = niceMax(max);
    const x = (i) => pad.left + (i / (points.length - 1)) * (W - pad.left - pad.right);
    const y = (v) => pad.top + (1 - (v - min) / (max - min)) * (H - pad.top - pad.bottom);
    // Step line: money changes on the day, not gradually
    let line = `M${x(0)},${y(vals[0])}`;
    for (let i = 1; i < vals.length; i++) line += ` H${x(i)} V${y(vals[i])}`;
    const area = `${line} V${y(min)} H${x(0)} Z`;
    let low = 0;
    vals.forEach((v, i) => { if (v < vals[low]) low = i; });
    return { x, y, line, area, min, max, low, zero: y(0) };
  }, [points]);

  if (!geo) return <p className="muted">No forecast yet.</p>;

  function onMove(e) {
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - pad.left) / (W - pad.left - pad.right)) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }

  const h = hover != null ? points[hover] : null;
  const low = points[geo.low];
  const goesNegative = low.balance_cents < 0;

  return (
    <div className="chart">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Projected money on hand, next 45 days" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="fcfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={SERIES.in} stopOpacity="0.25" />
            <stop offset="1" stopColor={SERIES.in} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => {
          const v = geo.min + f * (geo.max - geo.min);
          return (
            <g key={f}>
              <line x1={pad.left} x2={W - pad.right} y1={geo.y(v)} y2={geo.y(v)} className="grid" />
              <text x={pad.left - 8} y={geo.y(v) + 4} textAnchor="end" className="tick">{shortPHP(v)}</text>
            </g>
          );
        })}
        {geo.min < 0 && <line x1={pad.left} x2={W - pad.right} y1={geo.zero} y2={geo.zero} className="zero" />}
        <path d={geo.area} fill="url(#fcfill)" />
        <path d={geo.line} fill="none" stroke={SERIES.in} strokeWidth="2" strokeLinejoin="round" />
        {/* Event markers: paydays above the line, bills below */}
        {points.map((p, i) => p.events.length > 0 && (
          <g key={p.date}>
            {p.events.some((e) => e.kind === 'income') && <path d={`M${geo.x(i)},${geo.y(p.balance_cents) - 14} l5,8 h-10 Z`} fill="var(--income)" />}
            {p.events.some((e) => e.kind === 'expense') && <path d={`M${geo.x(i)},${geo.y(p.balance_cents) + 14} l5,-8 h-10 Z`} fill={SERIES.out} />}
          </g>
        ))}
        <circle cx={geo.x(geo.low)} cy={geo.y(low.balance_cents)} r="5" fill={goesNegative ? SERIES.out : 'var(--gold)'} stroke="var(--card)" strokeWidth="2" />
        <text x={geo.x(geo.low)} y={geo.y(low.balance_cents) + (geo.y(low.balance_cents) > H - 50 ? -12 : 22)} textAnchor={geo.low > points.length * 0.8 ? 'end' : geo.low < points.length * 0.2 ? 'start' : 'middle'} className="tick strong">
          Lowest {shortPHP(low.balance_cents)} · {dayLabel(low.date)}
        </text>
        {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((i) => (
          <text key={i} x={geo.x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} className="tick">{i === 0 ? 'Today' : dayLabel(points[i].date)}</text>
        ))}
        {h && (
          <g pointerEvents="none">
            <line x1={geo.x(hover)} x2={geo.x(hover)} y1={pad.top} y2={H - pad.bottom} className="crosshair" />
            <circle cx={geo.x(hover)} cy={geo.y(h.balance_cents)} r="5" fill={SERIES.in} stroke="var(--card)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && (
        <Tooltip x={geo.x(hover)} W={W}>
          <span className="muted">{hover === 0 ? 'Today' : dayLabel(h.date)}</span>
          <strong>{formatPHP(h.balance_cents)}</strong>
          {h.events.map((e, k) => (
            <span key={k} className={e.kind === 'income' ? 'income' : 'expense'}>{e.kind === 'income' ? '+' : '−'}{formatPHP(e.amount_cents)} {e.name}</span>
          ))}
        </Tooltip>
      )}
      <div className="legend">
        <span><i style={{ background: SERIES.in }} /> Money on hand (projected)</span>
        <span><b className="tri up" /> Payday</span>
        <span><b className="tri down" /> Bill due</span>
      </div>
      <table className="sr-only">
        <caption>Projected money on hand</caption>
        <tbody>{points.map((p) => <tr key={p.date}><th>{p.date}</th><td>{formatPHP(p.balance_cents)}</td><td>{p.events.map((e) => e.name).join(', ')}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** Money in vs out per month: paired bars, net written above each pair. */
export function CashFlowChart({ months: all }) {
  // Months before tracking began aren't "₱0", they're unknown: start at the first month with data
  const first = all?.findIndex((m) => m.income_cents || m.expense_cents) ?? -1;
  const months = first > 0 ? all.slice(first) : all;
  const W = 520, H = 240;
  const pad = { top: 26, right: 8, bottom: 26, left: 48 };
  const [hover, setHover] = useState(null);
  if (!months?.length) return <p className="muted">No history yet.</p>;
  const max = niceMax(Math.max(...months.flatMap((m) => [m.income_cents, m.expense_cents])));
  const slot = (W - pad.left - pad.right) / months.length;
  const bw = Math.min(26, (slot - 14) / 2);
  const y = (v) => pad.top + (1 - v / max) * (H - pad.top - pad.bottom);
  const base = y(0);
  const h = hover != null ? months[hover] : null;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Money in and out by month" onPointerLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.left} x2={W - pad.right} y1={y(max * f)} y2={y(max * f)} className="grid" />
            <text x={pad.left - 8} y={y(max * f) + 4} textAnchor="end" className="tick">{shortPHP(max * f)}</text>
          </g>
        ))}
        {months.map((m, i) => {
          const cx = pad.left + i * slot + slot / 2;
          const net = m.income_cents - m.expense_cents;
          const top = Math.min(y(m.income_cents), y(m.expense_cents));
          return (
            <g key={m.month} opacity={hover == null || hover === i ? 1 : 0.55}>
              <path d={barPath(cx - bw - 1, y(m.income_cents), bw, base - y(m.income_cents))} fill={SERIES.in} />
              <path d={barPath(cx + 1, y(m.expense_cents), bw, base - y(m.expense_cents))} fill={SERIES.out} />
              {(m.income_cents || m.expense_cents) ? (
                <text x={cx} y={top - 8} textAnchor="middle" className="tick strong">{net >= 0 ? '+' : '−'}{shortPHP(Math.abs(net)).replace('−', '')}</text>
              ) : null}
              <text x={cx} y={H - 8} textAnchor="middle" className="tick">{monthLabel(m.month)}</text>
              <rect x={pad.left + i * slot} y={pad.top} width={slot} height={H - pad.top - pad.bottom} fill="transparent" onPointerEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {h && (
        <Tooltip x={pad.left + hover * slot + slot / 2} W={W}>
          <span className="muted">{monthLabel(h.month)} {h.month.slice(0, 4)}</span>
          <span>In <strong>{formatPHP(h.income_cents)}</strong></span>
          <span>Out <strong>{formatPHP(h.expense_cents)}</strong></span>
          <span className={h.income_cents >= h.expense_cents ? 'income' : 'expense'}>
            {h.income_cents >= h.expense_cents ? 'Saved ' : 'Overspent '}{formatPHP(Math.abs(h.income_cents - h.expense_cents))}
          </span>
        </Tooltip>
      )}
      <div className="legend">
        <span><i style={{ background: SERIES.in }} /> Money in</span>
        <span><i style={{ background: SERIES.out }} /> Money out</span>
      </div>
      <table className="sr-only">
        <caption>Money in and out by month</caption>
        <tbody>{months.map((m) => <tr key={m.month}><th>{m.month}</th><td>{formatPHP(m.income_cents)}</td><td>{formatPHP(m.expense_cents)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/**
 * Where the next payroll goes, as a horizontal waterfall:
 * pay, then each priority group in the order to pay, then savings and what's left.
 */
export function PayrollWaterfall({ payroll }) {
  const [hover, setHover] = useState(null);
  const steps = [];
  let level = payroll.pay_cents;
  steps.push({ key: 'pay', label: 'Pay', from: 0, to: level, color: 'var(--income)', amount: payroll.pay_cents });
  for (const g of payroll.groups) {
    steps.push({ key: g.key, label: `${g.rank}. ${g.label}`, from: level - g.total_cents, to: level, color: PRIORITY_COLOR[g.key], amount: -g.total_cents, items: g.items });
    level -= g.total_cents;
  }
  if (payroll.suggested_save_cents > 0) {
    steps.push({ key: 'save', label: `Savings (${payroll.save_rate_pct}%)`, from: level - payroll.suggested_save_cents, to: level, color: SAVE, amount: -payroll.suggested_save_cents });
    level -= payroll.suggested_save_cents;
  }
  steps.push({ key: 'left', label: level >= 0 ? 'Left to spend' : 'Short', from: Math.min(0, level), to: Math.max(0, level), color: level >= 0 ? 'var(--muted)' : SERIES.out, amount: level, total: true });

  const lo = Math.min(0, ...steps.map((s) => s.from));
  const hi = Math.max(...steps.map((s) => s.to), 1);
  const pct = (v) => ((v - lo) / (hi - lo)) * 100;

  return (
    <div className="waterfall" role="list" aria-label="Where your next payroll goes">
      {steps.map((s, i) => (
        <div key={s.key} className={`wf-row ${hover === i ? 'on' : ''}`} role="listitem" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
          <span className="wf-label">{s.label}</span>
          <div className="wf-track">
            {lo < 0 && <span className="wf-zero" style={{ left: `${pct(0)}%` }} />}
            <div className="wf-bar" style={{ left: `${pct(s.from)}%`, width: `${Math.max(0.6, pct(s.to) - pct(s.from))}%`, background: s.color }} />
            {hover === i && s.items && (
              <div className="tooltip wf-tip">
                {s.items.map((b) => <span key={b.id}>{b.name} · {dayLabel(b.date)} <strong>{formatPHP(b.amount_cents)}</strong></span>)}
              </div>
            )}
          </div>
          <span className={`num wf-amt ${s.amount < 0 && !s.total ? '' : s.total && s.amount < 0 ? 'expense' : ''}`}>
            {s.key === 'pay' || s.total ? formatPHP(s.amount) : `−${formatPHP(-s.amount)}`}
          </span>
        </div>
      ))}
    </div>
  );
}
