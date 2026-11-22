// Recognise money movements in e-wallet / bank notifications and SMS alerts.
// Runs on the phone only; the raw text is never sent anywhere.
// The Kotlin listener (mobile/modules/wallet-shortcuts) mirrors these rules.

export const KNOWN_SOURCES = [
  { label: 'GCash', match: /\bg-?cash\b/i, packages: ['com.globe.gcash.android'] },
  { label: 'Maya', match: /\b(pay)?maya\b/i, packages: ['com.paymaya'] },
  { label: 'BDO', match: /\bbdo\b/i },
  { label: 'BPI', match: /\bbpi\b/i },
  { label: 'UnionBank', match: /\bunion ?bank\b/i },
  { label: 'Metrobank', match: /\bmetro ?bank\b/i },
  { label: 'Security Bank', match: /\bsecurity ?bank\b/i },
  { label: 'Landbank', match: /\bland ?bank\b/i },
  { label: 'PNB', match: /\bpnb\b/i },
  { label: 'RCBC', match: /\brcbc\b/i },
  { label: 'China Bank', match: /\bchina ?bank\b/i },
  { label: 'SeaBank', match: /\bsea ?bank\b/i },
  { label: 'GoTyme', match: /\bgo ?tyme\b/i },
  { label: 'CIMB', match: /\bcimb\b/i },
  { label: 'Tonik', match: /\btonik\b/i },
  { label: 'ShopeePay', match: /\bshopee ?pay\b/i },
  { label: 'GrabPay', match: /\bgrab ?pay\b/i },
];

const AMOUNT = /(?:₱|\bPHP|\bPhp|\bP)\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)/;
const SKIP = /\b(otp|one[- ]time|verification code|passcode|do not share|promo|win |raffle|available balance is|your balance is)\b/i;
const INCOME = /\b(received|receive|sent you|credited|cash[- ]?in|deposited|deposit|refund(ed)?|incoming|added to your)\b/i;
const EXPENSE = /\b(sent|paid|payment|purchase[d]?|debited|transferred|withdr[ae]w[nl]?|withdrawal|cash[- ]?out|charged|spent|bought|bills? pay)\b/i;

/** Which wallet/bank a notification is from, by app package or by name in the text. */
export function detectSource(packageName, text) {
  const byPkg = KNOWN_SOURCES.find((s) => s.packages?.includes(packageName));
  if (byPkg) return byPkg.label;
  return KNOWN_SOURCES.find((s) => s.match.test(text))?.label ?? null;
}

/**
 * Parse one notification. Returns { source, type: 'expense'|'income', amount_cents } or null.
 * `text` = title + body.
 */
export function parseMoneyNotification(packageName, text) {
  if (!text || SKIP.test(text)) return null;
  const source = detectSource(packageName, text);
  if (!source) return null;
  const m = text.match(AMOUNT);
  if (!m) return null;
  const amount = Math.round(Number(m[1].replace(/,/g, '')) * 100);
  if (!amount) return null;
  // "sent you" / "received" wins over a bare "sent"
  const type = INCOME.test(text) ? 'income' : EXPENSE.test(text) ? 'expense' : null;
  if (!type) return null;
  return { source, type, amount_cents: amount };
}
