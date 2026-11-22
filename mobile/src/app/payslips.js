// Payslips & deductions report for a year.
import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LINE_KINDS, todayInManila } from '@ft/shared';
import { RequireAuth } from '../components/RequireAuth';
import { Body, Button, Card, Chip, ChipRow, Empty, ErrorText, IconButton, Loading, Money, Row, Section } from '../components/ui';
import { BigAmount } from '../components/BigAmount';
import { usePayslipSummary, usePayslips, refreshMoney, refreshPayslips, api } from '../lib/queries';
import { formatPHP, friendlyDate } from '../lib/format';
import { useTheme, space } from '../theme';

const KIND_ICON = { contribution: 'shield-checkmark-outline', tax: 'business-outline', lost_pay: 'time-outline', fee: 'pricetag-outline', other: 'remove-circle-outline', addition: 'add-circle-outline' };
const KIND_COLOR = { contribution: '#4F63E8', tax: '#6E6E78', lost_pay: '#E0533D', fee: '#F59E0B', other: '#A855F7', addition: '#2F9E55' };
const TYPE_LABEL = { salary: 'Salary', part_time: 'Part-time', project: 'Project' };

export default function PayslipsScreen() {
  return (
    <RequireAuth>
      <Report />
    </RequireAuth>
  );
}

function Report() {
  const t = useTheme();
  const router = useRouter();
  const thisYear = Number(todayInManila().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const summary = usePayslipSummary(year);
  const list = usePayslips(year);
  const s = summary.data;
  const tot = s?.totals;
  const deductions = tot ? tot.gross + tot.addition - tot.net : 0;

  const remove = (p) => Alert.alert('Delete this payslip?', `${p.source_name} · ${formatPHP(p.net_cents)}. The income will be removed too.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => { await api.del(`/payslips/${p.id}`); await Promise.all([refreshMoney(), refreshPayslips()]); } },
  ]);

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 48, gap: space.xl }}>
      <ChipRow>
        {[thisYear, thisYear - 1, thisYear - 2].map((y) => <Chip key={y} label={String(y)} selected={year === y} onPress={() => setYear(y)} />)}
      </ChipRow>
      <Button title="Log pay" icon="add" onPress={() => router.push('/payslip/new')} />

      {summary.isPending && <Loading />}
      <ErrorText error={summary.error} />

      {tot && tot.count === 0 && (
        <Empty icon="document-text-outline" title={`No payslips in ${year}`} hint="Log your pay each payday to see your deductions, contributions and lost pay here." />
      )}

      {tot && tot.count > 0 && (
        <>
          <Card style={{ backgroundColor: t.hero, alignItems: 'center', gap: 4 }}>
            <Text style={{ color: t.heroText, opacity: 0.6, fontWeight: '700' }}>Take-home pay in {year}</Text>
            <BigAmount cents={tot.net} size={40} color={t.heroText} />
            <Text style={{ color: t.heroText, opacity: 0.6, fontSize: 13 }}>
              Gross {formatPHP(tot.gross)}{tot.addition ? ` + extras ${formatPHP(tot.addition)}` : ''} − deductions {formatPHP(deductions)}
            </Text>
          </Card>

          {tot.lost_pay > 0 && (
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <IconButton icon="time-outline" label="Lost pay" color={t.expense} />
              <Body style={{ flex: 1 }}>
                Lates & absences cost you <Text style={{ fontWeight: '800', color: t.expense }}>{formatPHP(tot.lost_pay)}</Text> this year.
              </Body>
            </Card>
          )}

          <Section title="Where it went" footer="SSS, PhilHealth and Pag-IBIG go toward your benefits (pension, health, housing), so they're shown apart from tax and lost pay.">
            {['contribution', 'tax', 'lost_pay', 'fee', 'other', 'addition'].filter((k) => tot[k] > 0).map((k) => (
              <Row
                key={k}
                icon={KIND_ICON[k]}
                iconColor={KIND_COLOR[k]}
                label={LINE_KINDS[k].label}
                hint={tot.byLabel.filter((l) => l.kind === k).map((l) => `${l.label} ${formatPHP(l.amount_cents)}`).join(' · ')}
                right={<Money cents={tot[k]} kind={k === 'addition' ? 'income' : undefined} />}
              />
            ))}
          </Section>

          {s.by_source.length > 0 && (
            <Section title="By source">
              {s.by_source.map((src) => (
                <Row
                  key={src.source}
                  icon={src.income_type === 'project' ? 'briefcase-outline' : src.income_type === 'part_time' ? 'time-outline' : 'business-outline'}
                  iconColor="#2F9E55"
                  label={src.source}
                  hint={`${TYPE_LABEL[src.income_type]} · ${src.count} payslip${src.count === 1 ? '' : 's'} · gross ${formatPHP(src.gross)}`}
                  right={<Money cents={src.net} kind="income" />}
                />
              ))}
            </Section>
          )}

          <Section title="Payslips">
            {(list.data ?? []).map((p) => (
              <Row
                key={p.id}
                icon="document-text-outline"
                iconColor="#6E6E78"
                label={`${p.source_name} · ${formatPHP(p.net_cents)}`}
                hint={`${friendlyDate(p.occurred_on)} · ${p.account_name} · gross ${formatPHP(p.gross_cents)}${p.lines.length ? ` · ${p.lines.length} line${p.lines.length === 1 ? '' : 's'}` : ''}`}
                right={<IconButton icon="trash-outline" label="Delete payslip" color={t.danger} onPress={() => remove(p)} />}
              />
            ))}
          </Section>
        </>
      )}
      <View />
    </ScrollView>
  );
}
