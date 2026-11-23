// "Money plan": how much you really have, what you can spend today, and what your
// next payroll should cover. Pure functions so the server, web and phone agree.
// Dates are 'YYYY-MM-DD' strings; money is integer centavos.
import { occurrences } from './schedule.js';
import { addDays } from './index.js';

/** Accounts you can spend from right now. Savings are set aside; cards and people are debts/IOUs. */
export const SPENDABLE_TYPES = ['bank', 'digital_bank', 'cash'];

/** Bill priority, most important first. */
export const BILL_PRIORITIES = [
  { key: 'debt', rank: 1, label: 'Loans & debts', why: 'Missing these costs late fees and hurts your credit' },
  { key: 'home', rank: 2, label: 'Rent & utilities', why: 'Keeps a roof over you and the lights on' },
  { key: 'essential', rank: 3, label: 'Internet, load & health', why: 'Needed for work and wellbeing' },
  { key: 'flexible', rank: 4, label: 'Subscriptions & others', why: 'Can be paused or moved if money is short' },
];
const PRIORITY = Object.fromEntries(BILL_PRIORITIES.map((p) => [p.key, p]));

const DEBT_RE = /loan|billease|spaylater|paylater|ggives|gloan|atome|home ?credit|credit ?card|\bcard\b|amorti[sz]ation|sss|pag-?ibig|hdmf|utang|install?ment|cashalo|tala|juanhand|maya ?credit|tonik/i;
const HOME_RE = /rent|upa|meralco|electric|kuryente|water|tubig|maynilad|manila water|condo|dues|association|hoa|gas|lpg|mortgage/i;
const ESSENTIAL_RE = /internet|wifi|wi-fi|pldt|globe|smart|converge|sky ?cable|dito|load|postpaid|insurance|philhealth|medicine|gamot|hmo|tuition|school|baon|daycare|grocer/i;

/** Which priority bucket a recurring bill falls in. */
export function billPriority(item) {
  const name = `${item.name ?? ''} ${item.category_name ?? ''}`;
  if (item.loan_account_id || item.category_name === 'Interest & fees' || DEBT_RE.test(name)) return PRIORITY.debt;
  if (item.category_name === 'Rent' || item.category_name === 'Bills & Utilities' || HOME_RE.test(name)) return PRIORITY.home;
  if (item.category_name === 'Load & Internet' || item.category_name === 'Health' || ESSENTIAL_RE.test(name)) return PRIORITY.essential;
  return PRIORITY.flexible;
}

const live = (r) => r.active !== false && !r.paid_off && r.next_date;
const amountOf = (r) => r.expected_cents ?? r.amount_cents;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Every dated occurrence of the given recurring items between from and until (inclusive). */
export function scheduleBetween(items, from, until) {
  const out = [];
  for (const r of items.filter(live)) {
    // A loan never asks for more than what's still owed
    let owed = r.loan_account_id != null && r.loan_balance_cents != null ? Math.max(0, -r.loan_balance_cents) : Infinity;
    for (const date of occurrences(r.next_date, r.frequency, from, until, r.days_of_month ?? [])) {
      const amount = Math.min(amountOf(r), owed);
      if (amount <= 0) break;
      owed -= amount;
      out.push({
        id: `${r.id}:${date}`,
        item_id: r.id,
        kind: r.kind,
        name: r.name,
        date,
        amount_cents: amount,
        category_id: r.category_id ?? null,
        category_name: r.category_name ?? null,
        ...(r.kind === 'expense' ? { priority: billPriority(r).key, priority_rank: billPriority(r).rank } : {}),
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.priority_rank ?? 0) - (b.priority_rank ?? 0) || b.amount_cents - a.amount_cents);
}

/** Bills sorted by what to pay first: priority, then due date, then biggest. */
export const byPayOrder = (a, b) => a.priority_rank - b.priority_rank || a.date.localeCompare(b.date) || b.amount_cents - a.amount_cents;

/** Group bills into priority buckets (only non-empty ones), each with a total. */
export function groupByPriority(bills) {
  return BILL_PRIORITIES
    .map((p) => {
      const items = bills.filter((b) => b.priority === p.key).sort(byPayOrder);
      return { ...p, items, total_cents: items.reduce((n, b) => n + b.amount_cents, 0) };
    })
    .filter((g) => g.items.length);
}

/** Round down to whole ₱100s — suggestions shouldn't look falsely precise. */
const floor100 = (cents) => Math.max(0, Math.floor(cents / 10_000) * 10_000);

/**
 * Everything the "today" and "next payroll" views need.
 *
 * @param {object} p
 * @param {Array}  p.accounts   visible accounts with type, balance_cents, archived
 * @param {Array}  p.recurring  serialized recurring items (expected_cents, paid_off, ...)
 * @param {string} p.today
 * @param {Array}  p.todaySpending  today's outflows: [{ category_id, spendable, total_cents }]
 *                 (expenses + transfer fees; `spendable` = it came out of a bank / e-wallet / cash)
 * @param {number|null} [p.dailyBudgetCents] a fixed daily budget you set; null/undefined = work it out
 * @param {number} [p.saveRatePct=20] % of what's left after bills to suggest saving
 */
export function buildMoneyPlan({ accounts, recurring, today, todaySpending = [], dailyBudgetCents = null, saveRatePct = 20 }) {
  const saveRate = Math.min(100, Math.max(0, saveRatePct)) / 100;
  const open = accounts.filter((a) => !a.archived);
  const sumType = (types) => open.filter((a) => types.includes(a.type)).reduce((n, a) => n + a.balance_cents, 0);
  const spendable = sumType(SPENDABLE_TYPES);
  const savings = sumType(['savings']);

  // Spending on a bill's category is paying that bill, not everyday spending
  const bills = recurring.filter((r) => live(r) && r.kind === 'expense');
  const billCategories = new Set(bills.map((r) => r.category_id).filter(Boolean));
  const isBill = (row) => row.category_id != null && billCategories.has(row.category_id);
  const spentToday = todaySpending.reduce((n, r) => n + r.total_cents, 0);
  const billsPaidToday = todaySpending.filter(isBill).reduce((n, r) => n + r.total_cents, 0);
  const everydayToday = spentToday - billsPaidToday;
  const everydayFromWallet = todaySpending.filter((r) => r.spendable && !isBill(r)).reduce((n, r) => n + r.total_cents, 0);
  const paidCategoriesToday = new Set(todaySpending.filter(isBill).map((r) => r.category_id));

  // --- Paydays
  const incomeItems = recurring.filter((r) => live(r) && r.kind === 'income');
  const incomeAhead = scheduleBetween(incomeItems, addDays(today, 1), addDays(today, 120));
  const payday = incomeAhead[0]?.date ?? null;
  const cycleEnd = payday ?? (() => { // no salary set up: budget to the end of the month
    const [y, m] = today.split('-').map(Number);
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  })();
  const daysLeft = Math.max(1, daysBetween(today, cycleEnd)); // today counts, payday doesn't

  // --- Bills still to pay before payday (a bill due today whose category was paid today counts as paid)
  const billsBefore = scheduleBetween(bills, today, addDays(cycleEnd, -1))
    .filter((b) => !(b.date === today && b.category_id && paidCategoriesToday.has(b.category_id)));
  const reserved = billsBefore.reduce((n, b) => n + b.amount_cents, 0);

  // --- Today's budget: money at the start of today, minus bills, spread over the days to payday,
  //     unless you've set your own daily amount
  const safeToSpend = spendable + everydayFromWallet - reserved;
  const autoDaily = Math.max(0, Math.floor(safeToSpend / daysLeft));
  const fixed = dailyBudgetCents > 0 ? dailyBudgetCents : null;
  const dailyBudget = fixed ?? autoDaily;
  const leftToday = dailyBudget - everydayToday;
  const ratio = dailyBudget > 0 ? everydayToday / dailyBudget : everydayToday > 0 ? Infinity : 0;
  const status = safeToSpend <= 0 ? 'short'
    : ratio > 1.5 ? 'way_over'
    : ratio > 1 ? 'over'
    : ratio >= 0.8 ? 'near'
    : 'ok';

  // --- Next payroll: the pay landing on the next payday, and the bills it has to cover
  //     (everything due from that payday up to the one after it).
  let payroll = null;
  if (payday) {
    const pay = incomeAhead.filter((i) => i.date === payday);
    const following = incomeAhead.find((i) => i.date > payday)?.date ?? addDays(payday, 30);
    const covers = scheduleBetween(bills, payday, addDays(following, -1)).sort(byPayOrder);
    const payTotal = pay.reduce((n, i) => n + i.amount_cents, 0);
    const billTotal = covers.reduce((n, b) => n + b.amount_cents, 0);
    // Pay bills in priority order; mark what the pay can't reach
    let running = payTotal;
    const ordered = covers.map((b) => {
      running -= b.amount_cents;
      return { ...b, covered: running >= 0, left_after_cents: running };
    });
    const free = payTotal - billTotal;
    const cycleDays = Math.max(1, daysBetween(payday, following));
    const save = free > 0 ? floor100(free * saveRate) : 0;
    payroll = {
      date: payday,
      days_away: daysBetween(today, payday),
      until: following,
      cycle_days: cycleDays,
      pay: pay.map(({ item_id, name, amount_cents }) => ({ item_id, name, amount_cents })),
      pay_cents: payTotal,
      bills: ordered,
      groups: groupByPriority(ordered),
      bills_cents: billTotal,
      free_cents: free,
      suggested_save_cents: save,
      save_rate_pct: Math.round(saveRate * 100),
      suggested_daily_cents: free > 0 ? Math.floor((free - save) / cycleDays) : 0,
      // If short, the flexible bills are the ones to move or pause first
      shortfall_cents: free < 0 ? -free : 0,
      can_defer: free < 0 ? ordered.filter((b) => b.priority === 'flexible') : [],
    };
  }

  return {
    date: today,
    spendable_cents: spendable,
    savings_cents: savings,
    payday,
    budget_until: cycleEnd,
    days_left: daysLeft,
    bills_before_payday: billsBefore,
    bills_before_payday_cents: reserved,
    safe_to_spend_cents: safeToSpend,
    daily_budget_cents: dailyBudget,
    budget_mode: fixed ? 'fixed' : 'auto',
    auto_daily_budget_cents: autoDaily,
    // A set budget you can't keep up until payday without dipping into bill money
    budget_fits: dailyBudget * daysLeft <= Math.max(0, safeToSpend),
    save_rate_pct: Math.round(saveRate * 100),
    today: {
      date: today,
      spent_cents: spentToday,
      everyday_cents: everydayToday,
      bills_paid_cents: billsPaidToday,
      left_cents: leftToday,
      status,
    },
    payroll,
  };
}

/**
 * Projected money on hand for the next `days` days: today's spendable balance,
 * plus paydays, minus bills and your usual everyday spending.
 */
export function forecastBalance({ plan, recurring, days = 45, dailySpend = 0 }) {
  const start = plan.date;
  const events = scheduleBetween(recurring, addDays(start, 1), addDays(start, days));
  // Bills still due today come off straight away
  const dueToday = plan.bills_before_payday.filter((b) => b.date === start);
  let bal = plan.spendable_cents - dueToday.reduce((n, b) => n + b.amount_cents, 0);
  const points = [{ date: start, balance_cents: bal, events: dueToday.map((e) => ({ kind: e.kind, name: e.name, amount_cents: e.amount_cents })) }];
  for (let i = 1; i <= days; i++) {
    const date = addDays(start, i);
    const todays = events.filter((e) => e.date === date);
    bal -= dailySpend;
    for (const e of todays) bal += e.kind === 'income' ? e.amount_cents : -e.amount_cents;
    points.push({ date, balance_cents: bal, events: todays.map((e) => ({ kind: e.kind, name: e.name, amount_cents: e.amount_cents })) });
  }
  return points;
}
