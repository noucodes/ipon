// Local-first changes: a new, edited or deleted transaction, account or bill is applied to the
// data already on the phone (balances, Home summary, today's budget, lists) straight away.
// The change waits in the outbox and syncs in the background; the server's answer then
// replaces these estimates.
//
// A change is { entity, before, after }: entity is 'tx' (default), 'account' or 'recurring';
// before is the row as it was (null for a new one) and after is the row as it is now (null when
// deleted). Rows use the same shape the API returns.
import {
  ACCOUNT_TYPES, SPENDABLE_TYPES, addDays, balanceEffects, buildMoneyPlan,
  monthlyEquivalentCents, nextCustomDate, todayInManila,
} from '@ft/shared';
import { queryClient } from './queryClient';

let currentUser = null;
/** Who is signed in, for "logged by" on rows created on the phone. */
export function setLocalUser(user) {
  currentUser = user;
}

const LOCAL_PREFIX = 'local-';
export const isLocalId = (id) => typeof id === 'string' && id.startsWith(LOCAL_PREFIX);
export const localId = (clientId) => LOCAL_PREFIX + clientId;

/** Reload everything money-related from the server (in the background). */
export const refreshMoney = () =>
  Promise.all(['summary', 'accounts', 'transactions', 'transaction', 'recurring', 'categories', 'feeSuggest']
    .map((k) => queryClient.invalidateQueries({ queryKey: [k] })));

const entityOf = (change) => change.entity ?? 'tx';
const byIdOrNull = (list, id) => (id ? list.find((x) => x.id === id) ?? null : null);

export function cachedAccounts({ includeArchived = false } = {}) {
  let best = null;
  for (const [key, data] of queryClient.getQueriesData({ queryKey: ['accounts'] })) {
    if (!Array.isArray(data?.accounts)) continue;
    if (key[1] === true && includeArchived) return data.accounts;
    if (!best || key[1] === true) best = data.accounts;
  }
  return best ?? queryClient.getQueryData(['summary'])?.balances?.accounts ?? [];
}

const cachedCategories = () => queryClient.getQueryData(['categories'])?.categories ?? [];

// ---------------------------------------------------------------- rows built on the phone

/** Build a transaction row (same shape as GET /transactions) from a request body. */
export function toRow(body, base = null) {
  const accounts = cachedAccounts({ includeArchived: true });
  const a = byIdOrNull(accounts, body.account_id);
  const ta = byIdOrNull(accounts, body.to_account_id);
  const c = byIdOrNull(cachedCategories(), body.category_id);
  const now = new Date().toISOString();
  return {
    created_at: now,
    created_by: currentUser?.id ?? null,
    created_by_name: currentUser?.display_name ?? null,
    can_edit: true,
    ...base,
    ...body,
    id: base?.id ?? localId(body.client_id),
    fee_cents: body.fee_cents ?? 0,
    account_name: a?.name ?? base?.account_name ?? '?',
    account_type: a?.type ?? base?.account_type ?? null,
    to_account_name: body.to_account_id ? ta?.name ?? base?.to_account_name ?? '?' : null,
    to_account_type: body.to_account_id ? ta?.type ?? base?.to_account_type ?? null : null,
    category_name: c?.name ?? (body.category_id && body.category_id === base?.category_id ? base.category_name : null),
    category_icon: c?.icon ?? (body.category_id && body.category_id === base?.category_id ? base.category_icon : null),
    updated_at: now,
    pending: true,
  };
}

/** Build an account row (same shape as GET /accounts) from a create body or an edit. */
export function toAccountRow(body, base = null) {
  const now = new Date().toISOString();
  const row = {
    is_private: false,
    archived: false,
    sort_order: 0,
    due_date: null,
    note: null,
    opening_balance_cents: 0,
    loan_total_cents: null,
    loan_installment_cents: null,
    loan_months: null,
    loan_first_due: null,
    created_at: now,
    can_edit: true,
    ...base,
    ...body,
    updated_at: now,
    pending: true,
  };
  // Balance = what it was, moved by however much the starting balance changed
  row.balance_cents = base ? base.balance_cents + (row.opening_balance_cents - base.opening_balance_cents) : row.opening_balance_cents;
  return row;
}

/** Build a bill / income row (same shape as GET /recurring) from a create body or an edit. */
export function toRecurringRow(body, base = null) {
  const now = new Date().toISOString();
  const row = {
    account_id: null,
    category_id: null,
    next_date: null,
    active: true,
    days_of_month: null,
    loan_account_id: null,
    loan_account_name: null,
    loan_balance_cents: null,
    loan_installment_cents: null,
    loan_months: null,
    loan_total_cents: null,
    average_net_cents: null,
    paid_off: false,
    created_at: now,
    can_edit: true,
    ...base,
    ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)),
    updated_at: now,
    pending: true,
  };
  if (row.frequency === 'custom_days') {
    row.days_of_month = [...new Set(row.days_of_month ?? [])].sort((a, b) => a - b);
    if (!row.next_date && row.days_of_month.length) row.next_date = nextCustomDate(row.days_of_month, todayInManila());
  } else {
    row.days_of_month = null;
  }
  if (base && body.kind && body.kind !== base.kind && body.category_id === undefined) row.category_id = null;
  row.account_name = byIdOrNull(cachedAccounts({ includeArchived: true }), row.account_id)?.name ?? (row.account_id === base?.account_id ? base?.account_name : null) ?? null;
  row.category_name = byIdOrNull(cachedCategories(), row.category_id)?.name ?? (row.category_id === base?.category_id ? base?.category_name : null) ?? null;
  row.expected_cents = row.average_net_cents ?? row.amount_cents;
  row.monthly_equivalent_cents = monthlyEquivalentCents(row.expected_cents, row.frequency, row.days_of_month ?? []);
  return row;
}

// ---------------------------------------------------------------- transactions

/** Balance change per account id for a transaction change. */
function effects({ before, after }) {
  const out = {};
  const add = (tx, sign) => {
    if (!tx?.account_id) return;
    for (const [id, d] of Object.entries(balanceEffects(tx))) if (id && id !== 'null') out[id] = (out[id] ?? 0) + sign * d;
  };
  add(before, -1);
  add(after, 1);
  return out;
}

const sameTx = (row, tx) => tx && (row.id === tx.id || (row.client_id && row.client_id === tx.client_id));

/** Sort like the server: newest date first, then newest created. */
const newerFirst = (a, b) => (a.occurred_on === b.occurred_on
  ? String(b.created_at).localeCompare(String(a.created_at))
  : String(b.occurred_on).localeCompare(String(a.occurred_on)));

/** Replace / remove the transaction in a list of rows. Safe to run twice. */
function patchList(list, { before, after }, matches = () => true, { keepOlder = true } = {}) {
  let out = list.filter((r) => !sameTx(r, before) && !sameTx(r, after));
  if (after && matches(after)) {
    const last = out[out.length - 1];
    if (keepOlder || !last || newerFirst(after, last) <= 0) {
      out = [...out, after].sort(newerFirst);
    }
  }
  return out;
}

/** Does this transaction belong in an activity list with these filters? */
function matchesFilters(f = {}) {
  return (tx) => {
    if (f.type && tx.type !== f.type) return false;
    if (f.category_id && tx.category_id !== f.category_id) return false;
    if (f.created_by && tx.created_by !== f.created_by) return false;
    if (f.account_id && tx.account_id !== f.account_id && tx.to_account_id !== f.account_id) return false;
    if (f.from && tx.occurred_on < f.from) return false;
    if (f.to && tx.occurred_on > f.to) return false;
    if (f.q && !(tx.note ?? '').toLowerCase().includes(String(f.q).toLowerCase())) return false;
    return true;
  };
}

function patchTransactions(data, change, filters) {
  if (!data?.pages?.length) return data;
  const matches = matchesFilters(filters);
  const pages = data.pages.map((p, i) => {
    const isLast = i === data.pages.length - 1;
    // Only add to the last loaded page if nothing older is waiting on the server
    const next = patchList(p.transactions, change, (tx) => i === 0 && matches(tx), { keepOlder: isLast && !p.has_more });
    return next === p.transactions ? p : { ...p, transactions: next };
  });
  return { ...data, pages };
}

// ---------------------------------------------------------------- accounts

/** Accounts sort like the server: open first, then sort order, then oldest first. */
const accountOrder = (a, b) => (Number(a.archived) - Number(b.archived))
  || ((a.sort_order ?? 0) - (b.sort_order ?? 0))
  || String(a.created_at).localeCompare(String(b.created_at));

/**
 * Apply an account change to a list. Balances move by the change in starting balance rather
 * than being overwritten, so transactions still waiting to sync stay counted.
 */
function patchAccountList(list, { before, after }, keep = () => true) {
  const id = (after ?? before).id;
  const current = list.find((a) => a.id === id);
  let out = list.filter((a) => a.id !== id);
  if (after) {
    const row = current
      ? { ...current, ...after, balance_cents: current.balance_cents + (after.opening_balance_cents - (before?.opening_balance_cents ?? current.opening_balance_cents ?? after.opening_balance_cents)) }
      : after;
    if (keep(row)) out = [...out, row].sort(accountOrder);
  }
  return out;
}

function patchAccountsQuery(queryKey, data, change) {
  if (entityOf(change) === 'tx') {
    const fx = effects(change);
    const bump = (a) => (fx[a.id] ? { ...a, balance_cents: a.balance_cents + fx[a.id] } : a);
    if (Array.isArray(data?.accounts)) return { ...data, accounts: data.accounts.map(bump) };
    if (data?.account) return { ...data, account: bump(data.account) };
    return data;
  }
  if (entityOf(change) !== 'account') return data;
  if (Array.isArray(data?.accounts)) {
    const includeArchived = queryKey[1] === true;
    return { ...data, accounts: patchAccountList(data.accounts, change, (a) => includeArchived || !a.archived) };
  }
  if (queryKey[1] === 'one' && queryKey[2] === (change.after ?? change.before).id) {
    if (!change.after) return data;
    return { account: patchAccountList(data?.account ? [data.account] : [], change)[0] ?? change.after };
  }
  return data;
}

// ---------------------------------------------------------------- bills & income

/** Server order: income first, active first, soonest date (none last), then name. */
const recurringOrder = (a, b) => b.kind.localeCompare(a.kind)
  || (Number(b.active) - Number(a.active))
  || (a.next_date && b.next_date ? a.next_date.localeCompare(b.next_date) : a.next_date ? -1 : b.next_date ? 1 : 0)
  || a.name.localeCompare(b.name);

function patchRecurringList(list, { before, after }, keep = () => true, order = recurringOrder) {
  const id = (after ?? before).id;
  let out = list.filter((r) => r.id !== id);
  if (after && keep(after)) out = [...out, after].sort(order);
  return out;
}

// ---------------------------------------------------------------- Home summary

const sumBalances = (rows) => rows.reduce((n, a) => n + a.balance_cents, 0);

/** Recompute everything in the summary that follows from the accounts and plan inputs. */
function rebuildSummary(s, accounts, inputs) {
  const byType = Object.fromEntries(ACCOUNT_TYPES.map((t) => [t, 0]));
  for (const a of accounts) byType[a.type] = (byType[a.type] ?? 0) + a.balance_cents;
  const people = accounts.filter((a) => a.type === 'person');
  const youOwe = sumBalances(people.filter((a) => a.balance_cents < 0));
  const netWorth = sumBalances(accounts);
  const liabilities = byType.credit_card + youOwe;
  const open = accounts.filter((a) => !a.archived);
  const balances = {
    ...s.balances,
    accounts,
    by_type: byType,
    net_worth_cents: netWorth,
    assets_cents: netWorth - liabilities,
    liabilities_cents: liabilities,
    owed_to_you_cents: sumBalances(people.filter((a) => a.balance_cents > 0)),
    you_owe_cents: youOwe,
    spendable_cents: sumBalances(open.filter((a) => SPENDABLE_TYPES.includes(a.type))),
    savings_cents: sumBalances(open.filter((a) => a.type === 'savings')),
  };

  let plan = s.plan;
  let recurring = s.recurring;
  if (inputs && s.today) {
    try {
      plan = buildMoneyPlan({
        accounts,
        recurring: inputs.recurring,
        today: s.today,
        todaySpending: inputs.today_spending,
        dailyBudgetCents: inputs.daily_budget_cents,
        saveRatePct: inputs.save_rate_pct,
      });
    } catch (err) {
      console.warn('local plan', err);
    }
    const income = inputs.recurring.filter((r) => r.kind === 'income').reduce((n, r) => n + r.monthly_equivalent_cents, 0);
    const bills = inputs.recurring.filter((r) => r.kind === 'expense').reduce((n, r) => n + r.monthly_equivalent_cents, 0);
    const horizon = addDays(s.today, 30);
    recurring = {
      ...s.recurring,
      monthly_income_cents: income,
      monthly_expenses_cents: bills,
      monthly_net_cents: income - bills,
      upcoming: inputs.recurring.filter((r) => r.next_date && r.next_date >= s.today && r.next_date <= horizon),
    };
  } else if (plan) {
    plan = { ...plan, spendable_cents: balances.spendable_cents, savings_cents: balances.savings_cents };
  }
  return { ...s, balances, plan, plan_inputs: inputs, recurring };
}

function adjustBuckets(list, tx, sign, categories) {
  const key = tx.category_id ?? null;
  const found = list.find((e) => (e.category_id ?? null) === key);
  const c = key ? categories.find((x) => x.id === key) : null;
  const entry = found
    ? { ...found, total_cents: found.total_cents + sign * tx.amount_cents }
    : { category_id: key, name: c?.name ?? tx.category_name ?? 'Uncategorised', icon: c?.icon ?? tx.category_icon ?? null, total_cents: sign * tx.amount_cents };
  return [...list.filter((e) => e !== found), entry].filter((e) => e.total_cents !== 0).sort((a, b) => b.total_cents - a.total_cents);
}

function patchSummaryForTx(s, change) {
  const fx = effects(change);
  const accounts = s.balances.accounts.map((a) => (fx[a.id] ? { ...a, balance_cents: a.balance_cents + fx[a.id] } : a));
  const known = new Set(accounts.map((a) => a.id));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const categories = cachedCategories();
  const feeCategory = categories.find((c) => c.is_system && c.name === 'Transfer fees');
  const feePayer = (tx) => ((tx.fee_paid_by || 'sender') === 'sender' ? tx.account_id : tx.to_account_id);

  // This month's money in / out (only for accounts in this view)
  let flow = s.month_flow;
  const flowFor = (tx, sign) => {
    if (!tx || !flow || !tx.occurred_on?.startsWith(s.month)) return;
    if (tx.type === 'income' && known.has(tx.account_id)) {
      flow = { ...flow, income_cents: flow.income_cents + sign * tx.amount_cents, income_by_category: adjustBuckets(flow.income_by_category, tx, sign, categories) };
    } else if (tx.type === 'expense' && known.has(tx.account_id)) {
      flow = { ...flow, expense_cents: flow.expense_cents + sign * tx.amount_cents, spending_by_category: adjustBuckets(flow.spending_by_category, tx, sign, categories) };
    } else if (tx.type === 'transfer' && tx.fee_cents > 0 && known.has(feePayer(tx))) {
      const fee = { amount_cents: tx.fee_cents, category_id: feeCategory?.id ?? null, category_name: 'Transfer fees' };
      flow = {
        ...flow,
        expense_cents: flow.expense_cents + sign * tx.fee_cents,
        transfer_fees_cents: flow.transfer_fees_cents + sign * tx.fee_cents,
        spending_by_category: adjustBuckets(flow.spending_by_category, fee, sign, categories),
      };
    }
  };
  flowFor(change.before, -1);
  flowFor(change.after, 1);
  if (flow) flow = { ...flow, net_cents: flow.income_cents - flow.expense_cents };

  // Today's spending, which drives today's budget
  let inputs = s.plan_inputs;
  if (inputs) {
    let spending = inputs.today_spending;
    const spendFor = (tx, sign) => {
      if (!tx || tx.occurred_on !== s.today) return;
      const rows = [];
      if (tx.type === 'expense') rows.push({ account_id: tx.account_id, category_id: tx.category_id ?? null, cents: tx.amount_cents });
      if (tx.type === 'transfer' && tx.fee_cents > 0) rows.push({ account_id: feePayer(tx), category_id: feeCategory?.id ?? null, cents: tx.fee_cents });
      for (const r of rows) {
        const a = byId.get(r.account_id);
        if (!a || a.is_loan || a.loan_months) continue;
        const spendable = SPENDABLE_TYPES.includes(a.type);
        const found = spending.find((x) => (x.category_id ?? null) === r.category_id && x.spendable === spendable);
        spending = found
          ? spending.map((x) => (x === found ? { ...x, total_cents: x.total_cents + sign * r.cents } : x))
          : [...spending, { category_id: r.category_id, spendable, total_cents: sign * r.cents }];
      }
    };
    spendFor(change.before, -1);
    spendFor(change.after, 1);
    inputs = { ...inputs, today_spending: spending };
  }

  const inView = (tx) => known.has(tx.account_id) || known.has(tx.to_account_id);
  const recent = s.recent_transactions
    ? patchList(s.recent_transactions, change, inView, { keepOlder: false }).slice(0, 10)
    : s.recent_transactions;
  return { ...rebuildSummary(s, accounts, inputs), month_flow: flow, recent_transactions: recent };
}

function patchSummary(s, change) {
  if (!s?.balances) return s;
  switch (entityOf(change)) {
    case 'account': {
      // Archived accounts stay in the summary while they still hold money
      const accounts = patchAccountList(s.balances.accounts, change, (a) => !a.archived || a.balance_cents !== 0);
      return rebuildSummary(s, accounts, s.plan_inputs);
    }
    case 'recurring': {
      if (!s.plan_inputs) return s;
      const byDate = (a, b) => (a.next_date && b.next_date ? a.next_date.localeCompare(b.next_date) : a.next_date ? -1 : b.next_date ? 1 : 0);
      const recurring = patchRecurringList(s.plan_inputs.recurring, change, (r) => r.active && !r.paid_off, byDate);
      return rebuildSummary(s, s.balances.accounts, { ...s.plan_inputs, recurring });
    }
    default:
      return patchSummaryForTx(s, change);
  }
}

// ---------------------------------------------------------------- applying changes

/** Apply one change to one cached query's data. Returns the new data. */
function patchQueryData(queryKey, data, change) {
  if (data === undefined) return data;
  const entity = entityOf(change);
  switch (queryKey[0]) {
    case 'accounts':
      return patchAccountsQuery(queryKey, data, change);
    case 'summary':
      return queryKey.length === 1 ? patchSummary(data, change) : data;
    case 'recurring':
      return entity === 'recurring' && Array.isArray(data?.items)
        ? { ...data, items: patchRecurringList(data.items, change) }
        : data;
    case 'transactions':
      return entity === 'tx' ? patchTransactions(data, change, queryKey[1]) : data;
    case 'transaction':
      if (entity === 'tx' && change.before && queryKey[1] === change.before.id) return change.after ? { transaction: change.after } : data;
      return data;
    default:
      return data;
  }
}

export const MONEY_KEYS = ['accounts', 'summary', 'recurring', 'transactions', 'transaction'];

/** Apply a change to every cached query, right now. */
export function applyChange(change) {
  for (const key of MONEY_KEYS) {
    for (const query of queryClient.getQueryCache().findAll({ queryKey: [key] })) {
      const next = patchQueryData(query.queryKey, query.state.data, change);
      if (next !== query.state.data) queryClient.setQueryData(query.queryKey, next);
    }
  }
}

/**
 * Keep changes that haven't synced yet on top of fresh server data: whenever a money query
 * finishes loading from the server, re-apply what is still waiting in the outbox.
 */
export function keepPendingOnTop(getPendingChanges) {
  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action?.type !== 'success' || event.action.manual) return;
    const { query } = event;
    if (!MONEY_KEYS.includes(query.queryKey[0])) return;
    const changes = getPendingChanges();
    if (!changes.length) return;
    let data = query.state.data;
    for (const change of changes) {
      // The server already has it (synced while this request was in flight)
      if (serverHas(data, change)) continue;
      data = patchQueryData(query.queryKey, data, change);
    }
    if (data !== query.state.data) queryClient.setQueryData(query.queryKey, data);
  });
}

function serverHas(data, change) {
  if (change.before || !change.after) return false;
  if (entityOf(change) === 'account') {
    const rows = data?.accounts ?? data?.balances?.accounts ?? (data?.account ? [data.account] : []);
    return rows.some((a) => !a.pending && a.id === change.after.id);
  }
  if (entityOf(change) === 'recurring') {
    const rows = data?.items ?? data?.plan_inputs?.recurring ?? [];
    return rows.some((r) => !r.pending && r.id === change.after.id);
  }
  const rows = data?.pages?.flatMap((p) => p.transactions) ?? data?.recent_transactions ?? [];
  return rows.some((r) => !r.pending && r.client_id === change.after.client_id);
}

/** Find a cached transaction row by id or client_id (to open or change it without waiting on the server). */
export function findCachedTransaction(id, clientId = null) {
  const hit = (r) => r && (r.id === id || (clientId && r.client_id === clientId));
  const one = queryClient.getQueryData(['transaction', id])?.transaction;
  if (one) return one;
  for (const [, data] of queryClient.getQueriesData({ queryKey: ['transactions'] })) {
    const row = data?.pages?.flatMap((p) => p.transactions).find(hit);
    if (row) return row;
  }
  return queryClient.getQueryData(['summary'])?.recent_transactions?.find(hit) ?? null;
}

/** Find a cached account by id (to open it without waiting on the server). */
export function findCachedAccount(id) {
  return queryClient.getQueryData(['accounts', 'one', id])?.account
    ?? cachedAccounts({ includeArchived: true }).find((a) => a.id === id)
    ?? null;
}
