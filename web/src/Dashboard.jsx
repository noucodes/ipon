// Read-only overview of the wallet. Everything is entered in the phone app.
import { useCallback, useEffect, useState } from 'react';
import { formatPHP, loanProgress, describeDays, todayInManila, addDays } from '@ft/shared';
import { api } from './api.js';
import { IponLogo } from './Logo.jsx';
import { CategoryBars, NetWorthChart, Progress } from './charts.jsx';

const TYPE_LABEL = { bank: 'Banks', digital_bank: 'E-wallets & digital banks', cash: 'Cash on hand', credit_card: 'Credit cards', savings: 'Savings & investments' };
const FREQ = { weekly: 'Weekly', fortnightly: 'Every 2 weeks', semi_monthly: 'Twice a month', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

function friendlyDate(d) {
  const today = todayInManila();
  if (d === today) return 'Today';
  if (d === addDays(today, 1)) return 'Tomorrow';
  if (d === addDays(today, -1)) return 'Yesterday';
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Signed amount with +/− so income vs expense never relies on colour alone. */
function Amount({ cents, kind, big }) {
  const sign = kind === 'income' ? '+' : kind === 'expense' ? '−' : cents < 0 ? '−' : '';
  return <span className={`num ${kind ?? (cents < 0 ? 'expense' : '')} ${big ? 'big' : ''}`}>{sign}{formatPHP(Math.abs(cents))}</span>;
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
      const [summary, history, accounts, recurring, household, txs, payslips] = await Promise.all([
        api('/summary'),
        api('/summary/net-worth?months=12'),
        api('/accounts'),
        api('/recurring'),
        api('/household'),
        api('/transactions?limit=15'),
        isOwner ? api('/payslips/summary').catch(() => null) : Promise.resolve(null),
      ]);
      setData({ summary, history: history.points, accounts: accounts.accounts, recurring: recurring.items, household, txs: txs.transactions, payslips });
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

  const { summary: s, history, accounts, recurring, household, txs, payslips } = data;
  const b = s.balances;
  const f = s.month_flow;
  const owner = household.members.find((m) => m.role === 'owner');
  const people = accounts.filter((a) => a.type === 'person' && a.balance_cents !== 0);
  const loans = accounts.filter((a) => a.loan_months);
  const groups = Object.keys(TYPE_LABEL)
    .map((type) => ({ type, items: accounts.filter((a) => a.type === type && !a.loan_months) }))
    .filter((g) => g.items.length);
  const monthName = new Date(`${s.month}-01T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="page">
      <header className="topbar">
        <IponLogo height={34} dark />
        <div className="topbar-right">
          <span className="muted small">{isOwner ? household.household.name : `${owner?.display_name ?? 'Partner'}'s wallet`}</span>
          <button className="btn ghost" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          <button className="btn ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {/* Hero */}
      <section className="hero">
        <div>
          <p className="hero-label">Net worth</p>
          <p className="hero-amount">{formatPHP(b.net_worth_cents)}</p>
          <p className="hero-sub">
            Assets {formatPHP(b.assets_cents)} · Debts {formatPHP(Math.abs(b.liabilities_cents))}
            {b.owed_to_you_cents > 0 && <> · Owed to you {formatPHP(b.owed_to_you_cents)}</>}
          </p>
        </div>
        <span className={`pill ${f.net_cents >= 0 ? 'good' : 'bad'}`}>
          {f.net_cents >= 0 ? '▲ +' : '▼ −'}{formatPHP(Math.abs(f.net_cents))} this month
        </span>
      </section>

      {/* This month */}
      <section className="tiles">
        <Tile label={`In · ${monthName}`} value={<Amount cents={f.income_cents} kind="income" big />} />
        <Tile label="Out" value={<Amount cents={f.expense_cents} kind="expense" big />} />
        <Tile label="Left" value={<Amount cents={f.net_cents} big />} />
        <Tile label="Transfer fees" value={<span className="num big">{formatPHP(f.transfer_fees_cents)}</span>} />
      </section>

      <div className="grid">
        <section className="card span-2">
          <h2>Net worth · last 12 months</h2>
          <NetWorthChart points={history} />
        </section>

        <section className="card">
          <h2>Spending this month</h2>
          <CategoryBars rows={f.spending_by_category} total={f.expense_cents} />
        </section>

        <section className="card">
          <h2>Accounts</h2>
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
        </section>

        <section className="card">
          <h2>Coming up · next 30 days</h2>
          {s.recurring.upcoming.length === 0 && <p className="muted">Nothing scheduled.</p>}
          {s.recurring.upcoming.map((r) => (
            <div key={r.id} className="row">
              <span>{r.name} <span className="muted">· {friendlyDate(r.next_date)}</span></span>
              <Amount cents={r.expected_cents ?? r.amount_cents} kind={r.kind} />
            </div>
          ))}
          <div className="row head top-gap">
            <span>Monthly plan</span>
            <span className="muted small">income {formatPHP(s.recurring.monthly_income_cents)} · bills {formatPHP(s.recurring.monthly_expenses_cents)}</span>
          </div>
          {recurring.filter((r) => r.active && !r.paid_off).map((r) => (
            <div key={r.id} className="row">
              <span>{r.name} <span className="muted">· {r.frequency === 'custom_days' ? `Every ${describeDays(r.days_of_month)}` : FREQ[r.frequency]}</span></span>
              <Amount cents={r.expected_cents ?? r.amount_cents} kind={r.kind} />
            </div>
          ))}
        </section>

        {loans.length > 0 && (
          <section className="card">
            <h2>Loans & pay later</h2>
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
          </section>
        )}

        {people.length > 0 && (
          <section className="card">
            <h2>Utang</h2>
            {people.map((p) => (
              <div key={p.id} className="row">
                <span>{p.name} <span className="muted">· {p.balance_cents > 0 ? 'owes you' : 'you owe'}{p.due_date ? ` · due ${friendlyDate(p.due_date)}` : ''}</span></span>
                <span className={`num ${p.balance_cents > 0 ? 'income' : 'expense'}`}>{formatPHP(Math.abs(p.balance_cents))}</span>
              </div>
            ))}
          </section>
        )}

        {payslips?.totals?.count > 0 && (
          <section className="card">
            <h2>Payslips · {payslips.year}</h2>
            <div className="row"><span>Take-home</span><span className="num">{formatPHP(payslips.totals.net)}</span></div>
            <div className="row"><span>Gov’t contributions</span><span className="num">{formatPHP(payslips.totals.contribution)}</span></div>
            <div className="row"><span>Tax</span><span className="num">{formatPHP(payslips.totals.tax)}</span></div>
            {payslips.totals.lost_pay > 0 && <div className="row"><span>Lates & absences</span><span className="num expense">−{formatPHP(payslips.totals.lost_pay)}</span></div>}
          </section>
        )}

        <section className="card span-2">
          <h2>Recent activity</h2>
          {txs.length === 0 && <p className="muted">No transactions yet.</p>}
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
        </section>
      </div>

      <footer className="muted small center-text">Ipon · view only. Add and edit entries in the phone app.</footer>
    </div>
  );
}

function Tile({ label, value }) {
  return (
    <div className="card tile">
      <p className="muted small">{label}</p>
      {value}
    </div>
  );
}
