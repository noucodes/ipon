import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoneyNotification } from './detect.js';
import { occurrences } from './schedule.js';

const p = parseMoneyNotification;

test('GCash sent / received', () => {
  assert.deepEqual(p('com.globe.gcash.android', 'GCash You have sent PHP 500.00 to JU*N D. on 11-22-2026.'), { source: 'GCash', type: 'expense', amount_cents: 50000 });
  assert.deepEqual(p('com.globe.gcash.android', 'You have received PHP 1,250.50 of GCash from MA**A S.'), { source: 'GCash', type: 'income', amount_cents: 125050 });
});

test('Maya and bank SMS', () => {
  assert.deepEqual(p('com.paymaya', 'Payment successful: You paid ₱389.00 to Jollibee'), { source: 'Maya', type: 'expense', amount_cents: 38900 });
  assert.deepEqual(p('com.google.android.apps.messaging', 'BDO: Your account was credited with PHP25,000.00 (payroll).'), { source: 'BDO', type: 'income', amount_cents: 2500000 });
  assert.deepEqual(p('com.transsion.messaging', 'BPI: You transferred P 1,000 to SAVINGS'), { source: 'BPI', type: 'expense', amount_cents: 100000 });
  assert.equal(p('x', 'Juan sent you ₱200 via GCash').type, 'income');
});

test('ignores OTPs, promos, balances, unknown senders', () => {
  assert.equal(p('com.globe.gcash.android', 'Your GCash OTP is 123456. Do not share. PHP 500'), null);
  assert.equal(p('com.paymaya', 'Maya promo! Cash in P500 and win a raffle'), null);
  assert.equal(p('x', 'Your available balance is PHP 9,000.00 BDO'), null);
  assert.equal(p('com.whatsapp', 'Mama: sent ₱500 na'), null);
  assert.equal(p('com.globe.gcash.android', 'Check out new GCash features'), null);
});

test('semi-monthly payday 15th & 30th', () => {
  assert.deepEqual(occurrences('2026-11-15', 'semi_monthly', '2026-11-20', '2027-01-20'), ['2026-11-30', '2026-12-15', '2026-12-30', '2027-01-15']);
});

test('monthly on the 31st caps to month end; weekly; yearly', () => {
  assert.deepEqual(occurrences('2026-01-31', 'monthly', '2026-02-01', '2026-04-30'), ['2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(occurrences('2026-11-02', 'weekly', '2026-11-20', '2026-12-05'), ['2026-11-23', '2026-11-30']);
  assert.deepEqual(occurrences('2025-03-10', 'yearly', '2026-01-01', '2027-12-31'), ['2026-03-10', '2027-03-10']);
  assert.deepEqual(occurrences('2027-05-01', 'monthly', '2026-11-22', '2026-12-31'), []); // starts later
});

test('lender alerts are loan payments, reminders are ignored', () => {
  assert.deepEqual(p('ph.billease', 'BillEase: We have received your payment of PHP 1,100.00. Thank you!'), { source: 'BillEase', type: 'loan_payment', amount_cents: 110000 });
  assert.deepEqual(p('com.globe.gcash.android', 'GGives: You have successfully paid ₱1,250.00 for your installment.'), { source: 'GGives', type: 'loan_payment', amount_cents: 125000 });
  assert.equal(p('com.shopee.ph', 'SPayLater: Your payment of ₱900 is due on Dec 15. Pay now to avoid late fees.'), null);
  assert.equal(p('x', 'Atome reminder: upcoming payment of P500'), null);
});

test('GCash SMS-style messages with the amount before "GCASH" (public samples)', () => {
  assert.deepEqual(
    p('com.globe.gcash.android', 'You have sent 2,950.00 GCASH to Carol Sinel 09178569645 on 11/04/2011 12:31 PM. Your new balance is 2,050.00.'),
    { source: 'GCash', type: 'expense', amount_cents: 295000 },
  );
  assert.deepEqual(
    p('com.globe.gcash.android', 'You have received 2,950.00 GCASH from Carol Sinel 09178569645. Your new balance is 7,950.00.'),
    { source: 'GCash', type: 'income', amount_cents: 295000 },
  );
  assert.equal(p('x', 'BPI: You paid 1,200.00 PHP to MERALCO').amount_cents, 120000);
  // the phone number / reference must not be mistaken for the amount
  assert.equal(p('com.paymaya', 'You sent ₱150.00 to 09171234567 Ref 1234567890').amount_cents, 15000);
});

test('MariBank alerts', () => {
  assert.deepEqual(p('x', 'MariBank: You have received PHP 2,000.00 from JUAN DELA CRUZ'), { source: 'MariBank', type: 'income', amount_cents: 200000 });
  assert.equal(p('x', 'Mari Bank: You sent ₱350.00 via InstaPay').type, 'expense');
});

import { monthlyEquivalentCents } from './index.js';
import { nextCustomDate, describeDays } from './schedule.js';

test('custom days: 13th & 16th, and 15th & 31st (last day in short months)', () => {
  assert.deepEqual(occurrences('2026-11-01', 'custom_days', '2026-11-14', '2026-12-31', [13, 16]), ['2026-11-16', '2026-12-13', '2026-12-16']);
  assert.deepEqual(occurrences('2027-02-01', 'custom_days', '2027-02-01', '2027-03-31', [15, 31]), ['2027-02-15', '2027-02-28', '2027-03-15', '2027-03-31']);
  assert.equal(nextCustomDate([13, 16], '2026-11-14'), '2026-11-16');
  assert.equal(nextCustomDate([13, 16], '2026-11-17'), '2026-12-13');
  assert.equal(monthlyEquivalentCents(800_000, 'custom_days', [13, 16]), 1_600_000);
  assert.equal(describeDays([16, 13]), '13th & 16th');
  assert.equal(describeDays([5, 20, 31]), '5th, 20th & last day');
  assert.equal(describeDays([1, 2, 3, 11, 22]), '1st, 2nd, 3rd, 11th & 22nd');
});

test('MariBank Credit is a lender; plain MariBank stays a bank', () => {
  assert.deepEqual(p('x', 'MariBank Credit: We received your payment of PHP 3,250.00. Thank you!'), { source: 'MariBank Credit', type: 'loan_payment', amount_cents: 325000 });
  assert.equal(p('x', 'Mari Credit payment of ₱1,000 posted').type, 'loan_payment');
  assert.equal(p('x', 'MariBank Credit: Your payment of ₱3,250 is due on Dec 5'), null); // reminder, not a payment
  assert.deepEqual(p('x', 'MariBank: You have received PHP 2,000.00 from JUAN'), { source: 'MariBank', type: 'income', amount_cents: 200000 });
});

test('TikTok PayLater alerts are loan payments', () => {
  assert.deepEqual(p('com.ss.android.ugc.trill', 'TikTok PayLater: Your repayment of ₱1,250.00 was successful.'), { source: 'TikTok PayLater', type: 'loan_payment', amount_cents: 125000 });
  assert.equal(p('x', 'TikTok Shop PayLater payment of PHP 800.00 received').type, 'loan_payment');
  assert.equal(p('x', 'TikTok PayLater: ₱1,250 is due on Dec 10. Pay now to avoid late fees.'), null);
});
