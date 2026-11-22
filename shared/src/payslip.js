// Payslip maths and Philippine presets, shared by server and app.

export const INCOME_TYPES = ['salary', 'part_time', 'project'];

/** addition adds to pay; every other kind is deducted. */
export const LINE_KINDS = {
  addition: { label: 'Additions', sign: 1 },
  contribution: { label: 'Gov’t contributions', sign: -1 }, // SSS, PhilHealth, Pag-IBIG
  tax: { label: 'Tax', sign: -1 },
  lost_pay: { label: 'Lates & absences', sign: -1 },
  fee: { label: 'Fees', sign: -1 }, // platform / transfer fees (projects)
  other: { label: 'Other deductions', sign: -1 }, // cash advance, loans, uniform, fines
};

export const PRESET_LINES = {
  salary: [
    { label: 'SSS', kind: 'contribution' },
    { label: 'PhilHealth', kind: 'contribution' },
    { label: 'Pag-IBIG', kind: 'contribution' },
    { label: 'Withholding tax', kind: 'tax' },
    { label: 'Lates / undertime', kind: 'lost_pay' },
    { label: 'Absences', kind: 'lost_pay' },
    { label: 'Overtime', kind: 'addition' },
    { label: 'Night differential', kind: 'addition' },
    { label: 'Holiday pay', kind: 'addition' },
    { label: 'Allowance', kind: 'addition' },
    { label: 'Incentive / commission', kind: 'addition' },
    { label: 'Cash advance', kind: 'other' },
    { label: 'SSS / Pag-IBIG loan', kind: 'other' },
    { label: 'Fines / penalties', kind: 'other' },
  ],
  part_time: [
    { label: 'Allowance', kind: 'addition' },
    { label: 'Tips', kind: 'addition' },
    { label: 'Overtime', kind: 'addition' },
    { label: 'Withholding tax', kind: 'tax' },
    { label: 'SSS', kind: 'contribution' },
    { label: 'Lates / undertime', kind: 'lost_pay' },
    { label: 'Fines / penalties', kind: 'other' },
  ],
  project: [
    { label: 'Platform fee', kind: 'fee' },
    { label: 'Withholding tax', kind: 'tax' },
    { label: 'PayPal / Wise fee', kind: 'fee' },
    { label: 'Transfer fee', kind: 'fee' },
    { label: 'Bonus / tip', kind: 'addition' },
  ],
};

/** Net pay = gross + additions − deductions (centavos). */
export function computeNet(grossCents, lines = []) {
  return lines.reduce((net, l) => net + (LINE_KINDS[l.kind]?.sign ?? -1) * (l.amount_cents || 0), grossCents || 0);
}

/** Totals per kind for a set of payslips: { gross, net, addition, contribution, ... , byLabel } */
export function payslipTotals(payslips) {
  const totals = { gross: 0, net: 0, count: payslips.length, byLabel: {} };
  for (const k of Object.keys(LINE_KINDS)) totals[k] = 0;
  for (const p of payslips) {
    totals.gross += p.gross_cents;
    totals.net += p.net_cents;
    for (const l of p.lines ?? []) {
      const kind = LINE_KINDS[l.kind] ? l.kind : 'other';
      totals[kind] += l.amount_cents || 0;
      const key = `${kind}:${l.label}`;
      totals.byLabel[key] = (totals.byLabel[key] ?? { label: l.label, kind, amount_cents: 0 });
      totals.byLabel[key].amount_cents += l.amount_cents || 0;
    }
  }
  return totals;
}

/** 1 for pay dated the 1st–15th, 2 for the 16th onward. */
export const cutoffOf = (dateStr) => (Number(dateStr.slice(8, 10)) <= 15 ? 1 : 2);
