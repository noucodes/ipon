// Upcoming dates of recurring income / bills, from an anchor date (the item's next_date).
// Dates are 'YYYY-MM-DD' strings.

const toDate = (s) => new Date(`${s}T00:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // m: 0-based

function onDay(y, m, day) {
  // normalise month overflow, cap day to month length (e.g. the 31st -> 30th)
  const date = new Date(Date.UTC(y, m, 1));
  const yy = date.getUTCFullYear();
  const mm = date.getUTCMonth();
  return new Date(Date.UTC(yy, mm, Math.min(day, daysInMonth(yy, mm))));
}

/**
 * All occurrences between `from` and `until` (inclusive).
 * semi_monthly = twice a month, the anchor day and 15 days apart (e.g. 15th & 30th, 5th & 20th).
 */
export function occurrences(anchor, frequency, from, until, daysOfMonth = []) {
  const a = toDate(anchor);
  const start = toDate(from);
  const end = toDate(until);
  const out = [];
  const push = (d) => { if (d >= start && d <= end && d >= a) out.push(fmt(d)); };

  if (frequency === 'weekly' || frequency === 'fortnightly') {
    const step = frequency === 'weekly' ? 7 : 14;
    const d = new Date(a);
    while (d < start) d.setUTCDate(d.getUTCDate() + step);
    while (d <= end) { push(new Date(d)); d.setUTCDate(d.getUTCDate() + step); }
    return out;
  }

  const day = a.getUTCDate();
  const everyMonths = { monthly: 1, semi_monthly: 1, quarterly: 3, yearly: 12, custom_days: 1 }[frequency];
  if (!everyMonths) throw new Error(`Unknown frequency: ${frequency}`);
  const days = frequency === 'custom_days'
    ? [...new Set(daysOfMonth)].filter((d) => d >= 1 && d <= 31)
    : frequency === 'semi_monthly'
    ? (day <= 15 ? [day, day + 15] : [day - 15, day])
    : [day];

  for (let i = 0; ; i += everyMonths) {
    const first = onDay(a.getUTCFullYear(), a.getUTCMonth() + i, 1);
    if (frequency === 'custom_days' && !days.length) break;
    if (first > end) break;
    for (const dd of days) push(onDay(first.getUTCFullYear(), first.getUTCMonth(), dd));
  }
  return out.sort();
}

/** Next date on one of the given days of the month, on or after `from` ('YYYY-MM-DD'). */
export function nextCustomDate(daysOfMonth, from) {
  const until = new Date(`${from}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + 62);
  return occurrences(from, 'custom_days', from, until.toISOString().slice(0, 10), daysOfMonth)[0] ?? null;
}

const ordinal = (n) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
  return `${n}${s}`;
};

/** [13, 16] -> "13th & 16th", [5, 20, 31] -> "5th, 20th & last day" */
export function describeDays(daysOfMonth = []) {
  const parts = [...new Set(daysOfMonth)].sort((a, b) => a - b).map((d) => (d === 31 ? 'last day' : ordinal(d)));
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} & ${parts.at(-1)}`;
}
