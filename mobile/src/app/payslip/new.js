// Log pay: salary (with SSS / PhilHealth / Pag-IBIG / tax / lates), part-time, or a project.
// Only the NET pay goes into your account; the breakdown feeds the deductions report.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Crypto from 'expo-crypto';
import { PRESET_LINES, LINE_KINDS, computeNet, cutoffOf, toCents, todayInManila } from '@ft/shared';
import { RequireAuth } from '../../components/RequireAuth';
import { Body, Button, Card, Chip, ChipRow, ErrorText, Field, IconButton, Label, Segmented, ToggleRow } from '../../components/ui';
import { BigAmount } from '../../components/BigAmount';
import { useAccounts, useRecurring, refreshMoney, refreshPayslips, api } from '../../lib/queries';
import { centsToInput, friendlyDate } from '../../lib/format';
import { useTheme, space, radius } from '../../theme';

const clean = (v) => v.replace(/[^0-9.,]/g, '');
let lineKey = 0;
const toLine = (l) => ({ key: ++lineKey, label: l.label, kind: l.kind, amount: l.amount_cents ? centsToInput(l.amount_cents) : '' });

export default function LogPay() {
  return (
    <RequireAuth>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 48, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <PayForm />
      </ScrollView>
    </RequireAuth>
  );
}

function PayForm() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams(); // ?recurring=<id>&type=salary|part_time|project
  // Attach mode: ?transaction=<id>&net=<cents> adds details to an income you already logged
  const attachTx = typeof params.transaction === 'string' ? params.transaction : null;
  const attachNet = Number.parseInt(params.net, 10) || 0;
  const accounts = (useAccounts().data ?? []).filter((a) => !['person', 'credit_card'].includes(a.type) && !a.archived);
  const incomeItems = (useRecurring().data ?? []).filter((i) => i.kind === 'income');

  const [type, setType] = useState(['salary', 'part_time', 'project'].includes(params.type) ? params.type : 'salary');
  const [recurringId, setRecurringId] = useState(typeof params.recurring === 'string' ? params.recurring : null);
  const [sourceName, setSourceName] = useState('');
  const [accountId, setAccountId] = useState(null);
  const [date, setDate] = useState(todayInManila());
  const [picker, setPicker] = useState(false);
  const [gross, setGross] = useState('');
  const [useHours, setUseHours] = useState(false);
  const [hours, setHours] = useState('');
  const [rate, setRate] = useState('');
  const [lines, setLines] = useState([]);
  const [isPrivate, setIsPrivate] = useState(true);
  const [prefilledFrom, setPrefilledFrom] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const prefilledKey = useRef(null);

  const item = incomeItems.find((i) => i.id === recurringId);

  // Defaults from the chosen income source (name + account it's paid into)
  useEffect(() => {
    if (item) {
      setSourceName((s) => s || item.name);
      if (item.account_id) setAccountId((a) => a ?? item.account_id);
    }
  }, [item]);
  useEffect(() => {
    if (!accountId && accounts.length) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  // Pre-fill from the last payslip of this source, same cutoff (15th vs 30th) when possible
  useEffect(() => {
    const key = `${recurringId ?? ''}|${recurringId ? '' : sourceName.trim().toLowerCase()}|${cutoffOf(date)}`;
    if ((!recurringId && sourceName.trim().length < 2) || prefilledKey.current === key) return;
    const timer = setTimeout(async () => {
      prefilledKey.current = key;
      const q = recurringId ? `recurring_item_id=${recurringId}` : `source_name=${encodeURIComponent(sourceName.trim())}`;
      try {
        const { template } = await api.get(`/payslips/template?${q}&date=${date}`);
        if (!template) return;
        setLines(template.lines.map(toLine));
        if (attachTx) { setPrefilledFrom('your last payslip'); return; } // amount received is already known
        setGross(centsToInput(template.gross_cents));
        if (template.hours) { setUseHours(true); setHours(String(template.hours)); setRate(centsToInput(template.rate_cents)); }
        setPrefilledFrom(template.cutoff === cutoffOf(date) ? 'your last payslip for this cutoff' : 'your last payslip');
      } catch {
        // no template; start blank
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [recurringId, sourceName, date]);

  const grossCents = useHours
    ? Math.round((Number(hours) || 0) * (toCents(rate || '0') ?? 0))
    : toCents(gross || '0') ?? 0;
  const lineData = lines.map((l) => ({ label: l.label.trim() || 'Other', kind: l.kind, amount_cents: toCents(l.amount || '0') ?? 0 }));
  const computedNet = computeNet(grossCents, lineData);
  const deductions = lineData.filter((l) => l.kind !== 'addition').reduce((n, l) => n + l.amount_cents, 0);
  const additions = lineData.filter((l) => l.kind === 'addition').reduce((n, l) => n + l.amount_cents, 0);
  // Attach mode works backwards from what arrived
  const net = attachTx ? attachNet : computedNet;
  const shownGross = attachTx ? attachNet + deductions - additions : grossCents;

  const presets = useMemo(() => {
    const used = new Set(lines.map((l) => l.label.toLowerCase()));
    return PRESET_LINES[type].filter((p) => !used.has(p.label.toLowerCase()));
  }, [type, lines]);

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function save() {
    setError(null);
    if (!sourceName.trim()) return setError({ message: type === 'project' ? 'Enter the client or project' : 'Enter where this pay is from' });
    if (attachTx) {
      if (shownGross < 0) return setError({ message: 'Additions are more than the pay' });
      setBusy(true);
      try {
        await api.post('/payslips/attach', {
          transaction_id: attachTx,
          income_type: type,
          source_name: sourceName.trim(),
          recurring_item_id: type === 'project' ? null : recurringId,
          lines: lineData.filter((l) => l.amount_cents > 0),
          is_private: isPrivate,
        });
        await Promise.all([refreshMoney(), refreshPayslips()]);
        router.back();
      } catch (err) {
        setError(err);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!accountId) return setError({ message: 'Choose where the pay arrived' });
    if (!grossCents) return setError({ message: 'Enter the gross pay' });
    if (net <= 0) return setError({ message: 'Deductions are more than the pay' });
    setBusy(true);
    try {
      await api.post('/payslips', {
        client_id: Crypto.randomUUID(),
        income_type: type,
        source_name: sourceName.trim(),
        recurring_item_id: type === 'project' ? null : recurringId,
        account_id: accountId,
        occurred_on: date,
        gross_cents: grossCents,
        lines: lineData.filter((l) => l.amount_cents > 0),
        hours: useHours ? Number(hours) || null : null,
        rate_cents: useHours ? toCents(rate || '0') || null : null,
        is_private: isPrivate,
      });
      await Promise.all([refreshMoney(), refreshPayslips()]);
      router.back();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Segmented
        value={type}
        onChange={(v) => { setType(v); setLines([]); setPrefilledFrom(null); prefilledKey.current = null; if (v === 'project') setRecurringId(null); }}
        options={[{ value: 'salary', label: 'Salary' }, { value: 'part_time', label: 'Part-time' }, { value: 'project', label: 'Project' }]}
      />

      {/* Where it's from */}
      <View style={{ gap: space.sm }}>
        <Label>{type === 'project' ? 'Client / project' : 'From'}</Label>
        {type !== 'project' && incomeItems.length > 0 && (
          <ChipRow>
            {incomeItems.map((i) => (
              <Chip key={i.id} label={i.name} selected={recurringId === i.id} onPress={() => { setRecurringId(i.id); setSourceName(i.name); prefilledKey.current = null; }} />
            ))}
          </ChipRow>
        )}
        <Field
          value={sourceName}
          onChangeText={(v) => { setSourceName(v); if (recurringId && v !== item?.name) setRecurringId(null); }}
          placeholder={type === 'project' ? 'e.g. Logo for ABC Co.' : type === 'part_time' ? 'e.g. Café part-time' : 'e.g. Main job'}
          maxLength={60}
        />
      </View>

      {/* When / where */}
      {!attachTx && (
      <View style={{ gap: space.sm }}>
        <Label>Received in</Label>
        <ChipRow>
          {accounts.map((a) => <Chip key={a.id} label={a.name} selected={accountId === a.id} onPress={() => setAccountId(a.id)} />)}
        </ChipRow>
        <ChipRow>
          <Chip icon="calendar-outline" label={friendlyDate(date)} selected onPress={() => setPicker(true)} />
          {type !== 'project' && <Chip label={cutoffOf(date) === 1 ? '1st cutoff (1–15)' : '2nd cutoff (16–end)'} />}
        </ChipRow>
        {picker && (
          <DateTimePicker
            value={new Date(`${date}T12:00:00`)}
            mode="date"
            maximumDate={new Date()}
            onChange={(event, picked) => {
              setPicker(Platform.OS === 'ios');
              if (event.type === 'set' && picked) {
                setDate(`${picked.getFullYear()}-${String(picked.getMonth() + 1).padStart(2, '0')}-${String(picked.getDate()).padStart(2, '0')}`);
              }
            }}
          />
        )}
      </View>
      )}

      {prefilledFrom && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.primarySoft, borderRadius: radius.md, padding: space.md }}>
          <Text style={{ color: t.text, fontSize: 13, flex: 1 }}>Pre-filled from {prefilledFrom}. Change only what's different (lates, overtime…).</Text>
        </View>
      )}

      {/* Gross */}
      {!attachTx && (
      <Card>
        <Label>{type === 'project' ? 'Project fee (before fees & tax)' : 'Gross pay'}</Label>
        {type === 'part_time' && (
          <ToggleRow label="Calculate from hours" value={useHours} onValueChange={setUseHours} />
        )}
        {useHours ? (
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}><Field value={hours} onChangeText={(v) => setHours(v.replace(/[^0-9.]/g, ''))} placeholder="Hours" keyboardType="decimal-pad" /></View>
            <View style={{ flex: 1 }}><Field value={rate} onChangeText={(v) => setRate(clean(v))} placeholder="₱ per hour" keyboardType="decimal-pad" /></View>
          </View>
        ) : (
          <Field value={gross} onChangeText={(v) => setGross(clean(v))} placeholder="₱0.00" keyboardType="decimal-pad" />
        )}
      </Card>
      )}

      {/* Lines */}
      <Card>
        <Label>Additions & deductions</Label>
        {lines.length === 0 && <Body muted style={{ fontSize: 13 }}>Tap below to add what's on your payslip.</Body>}
        {lines.map((l) => {
          const plus = LINE_KINDS[l.kind]?.sign === 1;
          return (
            <View key={l.key} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Text style={{ width: 16, fontSize: 18, fontWeight: '800', color: plus ? t.income : t.expense }}>{plus ? '+' : '−'}</Text>
              <View style={{ flex: 3 }}><Field value={l.label} onChangeText={(v) => setLine(l.key, { label: v })} placeholder="Label" /></View>
              <View style={{ flex: 2 }}><Field value={l.amount} onChangeText={(v) => setLine(l.key, { amount: clean(v) })} placeholder="₱0" keyboardType="decimal-pad" /></View>
              <IconButton icon="close" label={`Remove ${l.label}`} color={t.muted} onPress={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />
            </View>
          );
        })}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {presets.map((p) => (
            <Chip
              key={p.label}
              icon={p.kind === 'addition' ? 'add' : 'remove'}
              label={p.label}
              onPress={() => setLines((ls) => [...ls, toLine(p)])}
            />
          ))}
          <Chip icon="remove" label="Other deduction" onPress={() => setLines((ls) => [...ls, toLine({ label: '', kind: 'other' })])} />
          <Chip icon="add" label="Other addition" onPress={() => setLines((ls) => [...ls, toLine({ label: '', kind: 'addition' })])} />
        </View>
      </Card>

      {/* Net */}
      <Card style={{ alignItems: 'center', backgroundColor: t.hero }}>
        <Text style={{ color: t.heroText, opacity: 0.6, fontWeight: '700' }}>Net pay (what you received)</Text>
        <BigAmount cents={Math.max(0, net)} size={40} color={net > 0 ? t.heroText : t.danger} />
        <Text style={{ color: t.heroText, opacity: 0.6, fontSize: 12 }}>
          Gross {centsToInput(shownGross) || '0'}{additions ? ` + ${centsToInput(additions)}` : ''} − deductions {centsToInput(deductions) || '0'}
        </Text>
        <Text style={{ color: t.heroText, opacity: 0.6, fontSize: 12 }}>{attachTx ? 'From the income you logged · gross is worked out for you' : 'Should match your bank / GCash deposit'}</Text>
      </Card>

      <ToggleRow label="Keep breakdown private" hint="Your partner sees the net pay but not the deductions" value={isPrivate} onValueChange={setIsPrivate} />
      <ErrorText error={error} />
      <Button title={attachTx ? 'Save payslip details' : 'Save pay'} onPress={save} loading={busy} disabled={net <= 0} />
    </>
  );
}
