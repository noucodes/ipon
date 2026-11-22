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
