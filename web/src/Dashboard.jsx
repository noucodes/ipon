// Read-only overview of the wallet, built for a big screen: where the money is today,
// where it's heading, and what the next payroll has to cover. Entries are made in the phone app.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatPHP, loanProgress, describeDays, todayInManila, addDays, scheduleBetween } from '@ft/shared';
import { api } from './api.js';
import { IponLogo } from './Logo.jsx';
import { CategoryBars, NetWorthChart, Progress } from './charts.jsx';
import { CashFlowChart, DailySpendChart, ForecastChart, PayrollWaterfall, PRIORITY_COLOR, dayLabel } from './insightCharts.jsx';

const TYPE_LABEL = { bank: 'Banks', digital_bank: 'E-wallets & digital banks', cash: 'Cash on hand', credit_card: 'Credit cards', savings: 'Savings & investments' };
const FREQ = { weekly: 'Weekly', fortnightly: 'Every 2 weeks', semi_monthly: 'Twice a month', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
const NAV = [
  { id: 'today', label: 'Today' },
  { id: 'ahead', label: 'Next 45 days' },
  { id: 'payroll', label: 'Next payroll' },
  { id: 'calendar', label: 'Bills calendar' },
  { id: 'trends', label: 'Trends' },
  { id: 'wallet', label: 'Accounts & debts' },
];
const STATUS = {
  ok: { label: 'On track', icon: '✓', cls: 'good' },
  near: { label: 'Almost at your limit', icon: '!', cls: 'warn' },
  over: { label: 'Over budget', icon: '▲', cls: 'bad' },
  way_over: { label: 'Way over budget', icon: '▲▲', cls: 'bad' },
  short: { label: 'Bills need all your money', icon: '!', cls: 'bad' },
};

function friendlyDate(d) {
  const today = todayInManila();
  if (d === today) return 'Today';
  if (d === addDays(today, 1)) return 'Tomorrow';
  if (d === addDays(today, -1)) return 'Yesterday';
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Signed amount with +/− so income vs expense never relies on colour alone. */
function Amount({ cents, kind, big }) {
  const sign = kind === 'income' ? '+' : kind === 'expense' ? '−' : cents < 0 ? '−' : '';
  return <span className={`num ${kind ?? (cents < 0 ? 'expense' : '')} ${big ? 'big' : ''}`}>{sign}{formatPHP(Math.abs(cents))}</span>;
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Manila' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard({ user, onSignOut }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const isOwner = user.role === 'owner';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summary, history, insights, accounts, recurring, household, txs, payslips] = await Promise.all([
        api('/summary'),
        api('/summary/net-worth?months=12'),
        api('/summary/insights?months=6'),
        api('/accounts'),
        api('/recurring'),
        api('/household'),
        api('/transactions?limit=12'),
        isOwner ? api('/payslips/summary').catch(() => null) : Promise.resolve(null),
      ]);
      setData({ summary, history: history.points, insights, accounts: accounts.accounts, recurring: recurring.items, household, txs: txs.transactions, payslips, at: new Date() });
    } catch (err) {
      if (err.status === 401) onSignOut();
      else setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isOwner, onSignOut]);

  useEffect(() => { load(); }, [load]);

  if (!data) {
    return (
      <div className="center column">
        <IponLogo height={40} dark />
        {error ? <><p className="error">{error}</p><button className="btn" onClick={load}>Try again</button></> : <p className="muted">Loading your wallet…</p>}
      </div>
    );
  }

  const { summary: s, history, insights, accounts, recurring, household, txs, payslips } = data;
  const b = s.balances;
  const f = s.month_flow;
  const plan = s.plan;
  const owner = household.members.find((m) => m.role === 'owner');
  const name = isOwner ? (user.display_name ?? '').split(/\s+/)[0] : null;

  return (
    <div className="shell">
      <aside className="side">
        <IponLogo height={30} dark />
        <nav aria-label="Sections">
          {NAV.map((n) => <a key={n.id} href={`#${n.id}`}>{n.label}</a>)}
        </nav>
        <div className="side-foot">
          <p className="muted small">{isOwner ? household.household.name : `${owner?.display_name ?? 'Partner'}'s wallet`}</p>
          <p className="muted small">Updated {data.at.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</p>
          <div className="side-actions">
            <button className="btn ghost" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
            <button className="btn ghost" onClick={onSignOut}>Sign out</button>
          </div>
          <p className="muted tiny">View only. Add entries in the Ipon app.</p>
        </div>
      </aside>

      <main className="main">
        <header className="mainhead">
          <div>
            <p className="eyebrow">{new Date(`${s.today}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}</p>
            <h1>{name ? `${greeting()}, ${name}` : 'Wallet overview'}</h1>
          </div>
          {error && <p className="error">{error}</p>}
        </header>

        <Kpis s={s} plan={plan} />

        {/* ---------- Today */}
        <section id="today" className="band">
          <div className="panel col-8">
            <PanelHead title="Everyday spending this month" sub="Bills you pay are left out, so this shows the day-to-day money." />
            <DailySpendChart days={insights.daily} budget={plan.daily_budget_cents} month={s.month} today={s.today} />
          </div>
          <TodayVerdict plan={plan} avg={insights.average_daily_spend_cents} />
        </section>

        {/* ---------- Ahead */}
        <section id="ahead" className="band">
          <div className="panel col-8">
            <PanelHead title="Money on hand · next 45 days" sub={`Projection: paydays in, bills out, and about ${formatPHP(insights.average_daily_spend_cents)}/day of usual spending (your 30-day average).`} />
            <ForecastChart points={insights.forecast} />
          </div>
          <BeforePayday plan={plan} />
        </section>

        {/* ---------- Payroll */}
        <section id="payroll" className="band">
          <PayrollPanel plan={plan} />
        </section>

        {/* ---------- Calendar */}
        <section id="calendar" className="band">
          <div className="panel col-12">
            <PanelHead title="Bills & paydays · next 5 weeks" sub="Colour shows priority. Paydays are marked with +." />
            <BillsCalendar recurring={recurring} today={s.today} />
          </div>
        </section>

        {/* ---------- Trends */}
        <section id="trends" className="band">
          <div className="panel col-6">
            <PanelHead title="Money in vs out · 6 months" sub="Net shown above each month." />
            <CashFlowChart months={insights.cash_flow} />
          </div>
          <div className="panel col-6">
            <PanelHead title="Where this month's money went" sub={`${formatPHP(f.expense_cents)} out so far, including ${formatPHP(f.transfer_fees_cents)} in transfer fees.`} />
            <CategoryBars rows={f.spending_by_category} total={f.expense_cents} />
          </div>
          <div className="panel col-12">
            <PanelHead title="Net worth · last 12 months" sub={`Assets ${formatPHP(b.assets_cents)} · Debts ${formatPHP(Math.abs(b.liabilities_cents))}`} />
            <NetWorthChart points={history} />
          </div>
        </section>

        {/* ---------- Wallet */}
        <section id="wallet" className="band">
          <AccountsPanel accounts={accounts} />
          <DebtsPanel accounts={accounts} payslips={payslips} />
          <RecurringPanel recurring={recurring} s={s} />
          <div className="panel col-12">
            <PanelHead title="Recent activity" />
            <Activity txs={txs} user={user} />
          </div>
        </section>
      </main>
    </div>
  );
}

function PanelHead({ title, sub, right }) {
  return (
    <div className="panel-head">
      <div>
        <h2>{title}</h2>
        {sub && <p className="muted small">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

function Kpis({ s, plan }) {
  const b = s.balances;
  const d = plan.today;
  const st = STATUS[d.status];
  const net = s.month_flow.net_cents;
  return (
    <section className="kpis" aria-label="Key numbers">
      <div className="kpi">
        <p className="kpi-label">Net worth</p>
        <p className="kpi-value">{formatPHP(b.net_worth_cents)}</p>
        <p className={`kpi-sub ${net >= 0 ? 'income' : 'expense'}`}>{net >= 0 ? '▲ +' : '▼ −'}{formatPHP(Math.abs(net))} this month</p>
      </div>
      <div className="kpi">
        <p className="kpi-label">Money on hand</p>
        <p className="kpi-value">{formatPHP(b.spendable_cents)}</p>
        <p className="kpi-sub muted">Banks, e-wallets & cash{b.savings_cents ? ` · ${formatPHP(b.savings_cents)} in savings` : ''}</p>
      </div>
      <div className={`kpi status-${st.cls}`}>
        <p className="kpi-label">Spent today</p>
        <p className="kpi-value">{formatPHP(d.everyday_cents)} <span className="kpi-of">/ {formatPHP(plan.daily_budget_cents)}</span></p>
        <p className="kpi-sub"><span className={`chip ${st.cls}`}>{st.icon} {st.label}</span></p>
      </div>
      <div className="kpi">
        <p className="kpi-label">Free until {plan.payday ? 'payday' : 'month end'}</p>
        <p className={`kpi-value ${plan.safe_to_spend_cents < 0 ? 'expense' : ''}`}>{plan.safe_to_spend_cents < 0 ? '−' : ''}{formatPHP(Math.abs(plan.safe_to_spend_cents))}</p>
        <p className="kpi-sub muted">{plan.days_left} day{plan.days_left === 1 ? '' : 's'} left{plan.payday ? ` · payday ${friendlyDate(plan.payday)}` : ''}</p>
      </div>
    </section>
  );
}

function TodayVerdict({ plan, avg }) {
  const d = plan.today;
  const st = STATUS[d.status];
  const budget = plan.daily_budget_cents;
  const pct = budget > 0 ? Math.min(1, d.everyday_cents / budget) : d.everyday_cents ? 1 : 0;
  const times = budget > 0 ? d.everyday_cents / budget : 0;
  return (
    <div className={`panel col-4 verdict ${st.cls}`}>
      <PanelHead title="Today's verdict" />
      <p className={`verdict-status ${st.cls}`}><span aria-hidden>{st.icon}</span> {st.label}</p>
      <p className="verdict-big">
        {d.status === 'short'
          ? <>Short <strong>{formatPHP(-plan.safe_to_spend_cents)}</strong> for bills</>
          : d.left_cents >= 0
          ? <><strong>{formatPHP(d.left_cents)}</strong> left to spend today</>
          : <>Over by <strong>{formatPHP(-d.left_cents)}</strong>{times >= 1.5 ? ` (${times.toFixed(1)}× the budget)` : ''}</>}
      </p>
      <div className={`meter ${st.cls}`} role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin="0" aria-valuemax="100">
        <div style={{ width: `${Math.max(2, pct * 100)}%` }} />
      </div>
      <dl className="facts">
        <div><dt>Everyday spending today</dt><dd className="num">{formatPHP(d.everyday_cents)}</dd></div>
        <div><dt>{plan.budget_mode === 'fixed' ? 'Your daily budget (set)' : 'Daily budget (automatic)'}</dt><dd className="num">{formatPHP(budget)}</dd></div>
        {d.bills_paid_cents > 0 && <div><dt>Bills paid today (not counted)</dt><dd className="num">{formatPHP(d.bills_paid_cents)}</dd></div>}
        <div><dt>Your usual day (30-day avg)</dt><dd className="num">{formatPHP(avg)}</dd></div>
      </dl>
      <p className="muted small">
        {plan.budget_mode === 'fixed'
          ? `You set this budget in the app. Automatic would be ${formatPHP(plan.auto_daily_budget_cents)}/day.`
          : `Budget = money on hand ${formatPHP(plan.spendable_cents)} − bills before payday ${formatPHP(plan.bills_before_payday_cents)}, spread over ${plan.days_left} day${plan.days_left === 1 ? '' : 's'}.`}
        {plan.budget_mode === 'fixed' && !plan.budget_fits ? ' Heads up: keeping to it every day until payday would dip into bill money.' : ''}
        {avg > budget && budget > 0 ? ` Your usual day is ${formatPHP(avg - budget)} above this, so ease off a little until payday.` : ''}
      </p>
    </div>
  );
}

function PriorityDot({ k }) {
  return <i className="pdot" style={{ background: PRIORITY_COLOR[k] }} aria-hidden />;
}

function BeforePayday({ plan }) {
  const bills = [...plan.bills_before_payday].sort((a, b) => a.priority_rank - b.priority_rank || a.date.localeCompare(b.date));
  return (
    <div className="panel col-4">
      <PanelHead title={`Pay before ${plan.payday ? 'payday' : 'month end'}`} sub={bills.length ? `${formatPHP(plan.bills_before_payday_cents)} kept aside from your money on hand, most important first.` : 'Nothing due before then.'} />
      <ol className="paylist">
        {bills.map((b) => (
          <li key={b.id}>
            <PriorityDot k={b.priority} />
            <span className="grow">{b.name}<span className="muted small"> · {friendlyDate(b.date)}</span></span>
            <span className="num">{formatPHP(b.amount_cents)}</span>
          </li>
        ))}
      </ol>
      {plan.today.status === 'short' && <p className="error small">Not enough to cover these. Pay from the top and move what you can from the bottom.</p>}
    </div>
  );
}

function PayrollPanel({ plan }) {
  const p = plan.payroll;
  if (!p) {
    return (
      <div className="panel col-12">
        <PanelHead title="Next payroll" />
        <p className="muted">Add your salary in the app (Plan → Income) to see what each payroll should cover.</p>
      </div>
    );
  }
  return (
    <>
      <div className="panel col-7">
        <PanelHead
          title={`Next payroll · ${friendlyDate(p.date)}`}
          sub={`${p.pay.map((x) => x.name).join(' + ')} · covers ${friendlyDate(p.date)} – ${friendlyDate(addDays(p.until, -1))} (${p.cycle_days} days)`}
          right={<span className="badge">{p.days_away === 1 ? 'Tomorrow' : `In ${p.days_away} days`}</span>}
        />
        <PayrollWaterfall payroll={p} />
        <div className="suggest">
          {p.shortfall_cents > 0 ? (
            <>
              <p className="error">Short by {formatPHP(p.shortfall_cents)} this pay period.</p>
              <p className="muted small">Pay loans first, then rent and utilities. {p.can_defer.length ? `Ask to move or pause: ${p.can_defer.map((b) => b.name).join(', ')}.` : 'Consider moving money from savings for the gap.'}</p>
            </>
          ) : (
            <div className="suggest-grid">
              <div><p className="muted small">Left after bills</p><p className="num big">{formatPHP(p.free_cents)}</p></div>
              <div><p className="muted small">Put into savings</p><p className="num big income">{formatPHP(p.suggested_save_cents)}</p></div>
              <div><p className="muted small">Then spend per day</p><p className="num big">{formatPHP(p.suggested_daily_cents)}</p></div>
            </div>
          )}
        </div>
      </div>
      <div className="panel col-5">
        <PanelHead title="Pay in this order" sub="Grouped by what hurts most to miss." />
        {p.groups.length === 0 && <p className="muted">No bills due this pay period.</p>}
        {p.groups.map((g) => (
          <div key={g.key} className="pgroup">
            <div className="pgroup-head">
              <PriorityDot k={g.key} />
              <strong>{g.rank}. {g.label}</strong>
              <span className="num">{formatPHP(g.total_cents)}</span>
            </div>
            <p className="muted tiny">{g.why}</p>
            {g.items.map((b) => (
              <div key={b.id} className={`row ${b.covered ? '' : 'uncovered'}`}>
                <span>{b.covered ? '✓' : '✗'} {b.name} <span className="muted small">· {friendlyDate(b.date)}</span></span>
                <span className="num">{formatPHP(b.amount_cents)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

/** Rolling 5 weeks from this week's Monday, so it always shows what's coming, even late in the month. */
function BillsCalendar({ recurring, today }) {
  const cells = useMemo(() => {
    const start = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
    const end = addDays(start, 34);
    const events = scheduleBetween(recurring, today, end);
    const out = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push({ key: d, date: d, events: events.filter((e) => e.date === d) });
    return out;
  }, [recurring, today]);

  return (
    <div className="cal" role="grid" aria-label="Bills and paydays, next 5 weeks">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="cal-dow" role="columnheader">{d}</div>)}
      {cells.map((c) => c.date ? (
        <div key={c.key} role="gridcell" className={`cal-day ${c.date === today ? 'today' : ''} ${c.date < today ? 'past' : ''}`}>
          <span className="cal-num">{c.date === cells[0].date || c.date.endsWith('-01') ? dayLabel(c.date) : Number(c.date.slice(8))}</span>
          {c.events.map((e) => (
            <span key={e.id} className={`cal-ev ev-${e.kind}`} style={e.kind === 'expense' ? { borderLeftColor: PRIORITY_COLOR[e.priority] } : null} title={`${e.name} · ${formatPHP(e.amount_cents)}`}>
              <span className="cal-name">{e.kind === 'income' ? '+ ' : ''}{e.name.replace(/\s+payment$/i, '')}</span>
              <span className="num">{formatPHP(e.amount_cents).replace(/\.00$/, '')}</span>
            </span>
          ))}
        </div>
      ) : <div key={c.key} className="cal-day pad" aria-hidden />)}
      <div className="legend cal-legend">
        <span><b className="pdot" style={{ background: PRIORITY_COLOR.debt }} /> Loans & debts</span>
        <span><b className="pdot" style={{ background: PRIORITY_COLOR.home }} /> Rent & utilities</span>
        <span><b className="pdot" style={{ background: PRIORITY_COLOR.essential }} /> Internet, load & health</span>
        <span><b className="pdot" style={{ background: PRIORITY_COLOR.flexible }} /> Subscriptions & others</span>
      </div>
    </div>
  );
}

function AccountsPanel({ accounts }) {
  const groups = Object.keys(TYPE_LABEL)
    .map((type) => ({ type, items: accounts.filter((a) => a.type === type && !a.loan_months) }))
    .filter((g) => g.items.length);
  return (
    <div className="panel col-4">
      <PanelHead title="Accounts" />
      {groups.length === 0 && <p className="muted">No accounts yet.</p>}
      {groups.map((g) => (
        <div key={g.type} className="group">
          <div className="row head">
            <span>{TYPE_LABEL[g.type]}</span>
            <span className="num">{formatPHP(g.items.reduce((n, a) => n + a.balance_cents, 0))}</span>
          </div>
          {g.items.map((a) => (
            <div key={a.id} className="row">
              <span>{a.name}{a.is_private ? ' 🔒' : ''}</span>
              <Amount cents={a.balance_cents} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function DebtsPanel({ accounts, payslips }) {
  const people = accounts.filter((a) => a.type === 'person' && a.balance_cents !== 0);
  const loans = accounts.filter((a) => a.loan_months);
  return (
    <div className="panel col-4">
      <PanelHead title="Loans, pay later & utang" />
      {!loans.length && !people.length && <p className="muted">No loans or utang. Nice.</p>}
      {loans.map((a) => {
        const p = loanProgress(a);
        return (
          <div key={a.id} className="loan">
            <div className="row">
              <span>{a.name}</span>
              <span className="num">{p.done ? 'Paid off' : `${formatPHP(p.owed)} left`}</span>
            </div>
            <Progress value={p.pct} />
            <p className="muted small">{p.paidCount} of {p.months} paid{p.nextDue ? ` · next ${formatPHP(Math.min(a.loan_installment_cents, p.owed))} due ${friendlyDate(p.nextDue)}` : ''}</p>
          </div>
        );
      })}
      {people.length > 0 && <div className="row head top-gap"><span>Utang</span></div>}
      {people.map((p) => (
        <div key={p.id} className="row">
          <span>{p.name} <span className="muted small">· {p.balance_cents > 0 ? 'owes you' : 'you owe'}{p.due_date ? ` · due ${friendlyDate(p.due_date)}` : ''}</span></span>
          <span className={`num ${p.balance_cents > 0 ? 'income' : 'expense'}`}>{formatPHP(Math.abs(p.balance_cents))}</span>
        </div>
      ))}
      {payslips?.totals?.count > 0 && (
        <>
          <div className="row head top-gap"><span>Payslips · {payslips.year}</span></div>
          <div className="row"><span>Take-home</span><span className="num">{formatPHP(payslips.totals.net)}</span></div>
          <div className="row"><span>Gov’t contributions</span><span className="num">{formatPHP(payslips.totals.contribution)}</span></div>
          <div className="row"><span>Tax</span><span className="num">{formatPHP(payslips.totals.tax)}</span></div>
          {payslips.totals.lost_pay > 0 && <div className="row"><span>Lates & absences</span><span className="num expense">−{formatPHP(payslips.totals.lost_pay)}</span></div>}
        </>
      )}
    </div>
  );
}

function RecurringPanel({ recurring, s }) {
  return (
    <div className="panel col-4">
      <PanelHead title="Monthly plan" sub={`Income ${formatPHP(s.recurring.monthly_income_cents)} · bills ${formatPHP(s.recurring.monthly_expenses_cents)} · can save ${formatPHP(s.recurring.monthly_net_cents)}`} />
      {recurring.filter((r) => r.active && !r.paid_off).map((r) => (
        <div key={r.id} className="row">
          <span>{r.name} <span className="muted small">· {r.frequency === 'custom_days' ? `Every ${describeDays(r.days_of_month)}` : FREQ[r.frequency]}</span></span>
          <Amount cents={r.expected_cents ?? r.amount_cents} kind={r.kind} />
        </div>
      ))}
    </div>
  );
}

function Activity({ txs, user }) {
  if (!txs.length) return <p className="muted">No transactions yet.</p>;
  return (
    <table className="activity">
      <tbody>
        {txs.map((t) => (
          <tr key={t.id}>
            <td className="muted">{friendlyDate(t.occurred_on)}</td>
            <td>
              {t.type === 'transfer' ? `${t.account_name} → ${t.to_account_name}` : (t.note || t.category_name || (t.type === 'income' ? 'Income' : 'Expense'))}
              <span className="muted small"> {t.type === 'transfer' ? (t.fee_cents ? `· fee ${formatPHP(t.fee_cents)}` : '') : `· ${t.account_name}`}{t.created_by !== user.id && t.created_by_name ? ` · by ${t.created_by_name}` : ''}</span>
            </td>
            <td className="right"><Amount cents={t.amount_cents} kind={t.type === 'transfer' ? undefined : t.type} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

