import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeNet, payslipTotals, cutoffOf } from './payslip.js';

const lines = [
  { label: 'SSS', kind: 'contribution', amount_cents: 67500 },
  { label: 'PhilHealth', kind: 'contribution', amount_cents: 37500 },
  { label: 'Pag-IBIG', kind: 'contribution', amount_cents: 20000 },
  { label: 'Lates / undertime', kind: 'lost_pay', amount_cents: 25000 },
  { label: 'Overtime', kind: 'addition', amount_cents: 80000 },
];

test('net = gross + additions - deductions', () => {
  assert.equal(computeNet(1500000, lines), 1500000 + 80000 - 67500 - 37500 - 20000 - 25000);
  assert.equal(computeNet(500000, []), 500000);
});

test('totals per kind and per label', () => {
  const t = payslipTotals([
    { gross_cents: 1500000, net_cents: 1430000, lines },
    { gross_cents: 1500000, net_cents: 1475000, lines: [{ label: 'Lates / undertime', kind: 'lost_pay', amount_cents: 25000 }] },
  ]);
  assert.equal(t.gross, 3000000);
  assert.equal(t.contribution, 125000);
  assert.equal(t.lost_pay, 50000);
  assert.equal(t.addition, 80000);
  assert.equal(t.byLabel['lost_pay:Lates / undertime'].amount_cents, 50000);
});

test('cutoff', () => {
  assert.equal(cutoffOf('2026-11-15'), 1);
  assert.equal(cutoffOf('2026-11-30'), 2);
});
