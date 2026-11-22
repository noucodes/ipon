import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCents, formatPHP, monthlyEquivalentCents, balanceEffects } from './index.js';

test('toCents parses peso strings and numbers', () => {
  assert.equal(toCents('1,234.50'), 123450);
  assert.equal(toCents('₱15'), 1500);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents('12.345'), null);
  assert.equal(toCents('abc'), null);
});

test('formatPHP formats centavos', () => {
  assert.equal(formatPHP(1234567), '₱12,345.67');
});

test('monthlyEquivalentCents converts frequencies', () => {
  assert.equal(monthlyEquivalentCents(1500000, 'semi_monthly'), 3000000);
  assert.equal(monthlyEquivalentCents(1200000, 'yearly'), 100000);
  assert.equal(monthlyEquivalentCents(1000000, 'fortnightly'), 2166667);
});

test('transfer fee paid by sender', () => {
  const fx = balanceEffects({ type: 'transfer', amount_cents: 100000, fee_cents: 1500, fee_paid_by: 'sender', account_id: 'bdo', to_account_id: 'gcash' });
  assert.deepEqual(fx, { bdo: -101500, gcash: 100000 });
});

test('transfer fee paid by receiver', () => {
  const fx = balanceEffects({ type: 'transfer', amount_cents: 100000, fee_cents: 1500, fee_paid_by: 'receiver', account_id: 'bdo', to_account_id: 'gcash' });
  assert.deepEqual(fx, { bdo: -100000, gcash: 98500 });
});
