// Quick add, inspired by "send money" flows:
//   Log mode      : pick account → type amount → swipe LEFT = expense, RIGHT = income
//   Transfer mode : pick From / To like recipients → amount → slide to transfer
// Then a full-colour confirmation where you can tag a category.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { toCents, todayInManila, formatPHP } from '@ft/shared';
import { Body, Button, Chip, ChipRow, Empty, Field, IconButton, Ionicons, Label, Loading, Segmented } from './ui';
import { Keypad, useAmountInput } from './Keypad';
import { SwipeTrack } from './SwipeTrack';
import { SwipeCard } from './SwipeCard';
import { BigAmount } from './BigAmount';
import { TYPE_COLORS } from './AccountAvatar';
import { useAccounts, useCategories, useFeePresets, useFeeSuggestion, refreshMoney, api } from '../lib/queries';
import { enqueue, isRetryable, updateQueued } from '../lib/outbox';
import { centsToInput, friendlyDate, ACCOUNT_TYPE_ICONS } from '../lib/format';
import { matchAccount } from '../lib/detections';
import { useAuth } from '../lib/auth';
import { useRouter } from 'expo-router';
import { detection as detectionStore } from '../../modules/wallet-shortcuts';
import { useTheme, space, radius } from '../theme';

const LAST_ACCOUNT_KEY = 'last_account_id';

export function QuickAdd({ initialType = 'expense', initialAmountCents = 0, source = null, detectionId = null, initialFrom = null, initialTo = null, recurringId = null, onClose }) {
  const router = useRouter();
  const t = useTheme();
  const { isOwner } = useAuth();
  const accountsQ = useAccounts();
  // Real accounts first, then people (utang) — people only make sense for transfers.
  const accounts = useMemo(() => {
    const all = accountsQ.data ?? [];
    return [...all.filter((a) => a.type !== 'person'), ...all.filter((a) => a.type === 'person')];
  }, [accountsQ.data]);
  const moneyAccounts = useMemo(() => accounts.filter((a) => a.type !== 'person'), [accounts]);
  const presets = useFeePresets().data ?? [];

  const [mode, setMode] = useState(initialType === 'transfer' ? 'transfer' : 'log');
  const amount = useAmountInput(initialAmountCents);
  const [detected, setDetected] = useState(source ? { source, type: initialType, id: detectionId } : null);
  const [accountId, setAccountId] = useState(initialFrom);
  const [toAccountId, setToAccountId] = useState(initialTo);
  const [fee, setFee] = useState(null); // null = use suggestion; otherwise { cents, paidBy }
  const [note, setNote] = useState('');
  const [editingNote, setEditingNote] = useState(false);
  const [date, setDate] = useState(todayInManila());
  const [showDate, setShowDate] = useState(false);
  const [sheet, setSheet] = useState(null); // 'log' | 'from' | 'to' account picker
  const [feeSheet, setFeeSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const resultRef = useRef(null);
  const pickedCategory = useRef(null);
  const showResult = (r) => {
    resultRef.current = r;
    setResult(r);
  };

  // Pre-select: the account matching a detected alert (e.g. "GCash"), else the one used last time
  useEffect(() => {
    if (accountId || !accounts.length) return;
    const fromSource = matchAccount(accounts, source);
    // Loan payment alert (e.g. BillEase): the loan is where the money goes; pay from your usual account.
    if (fromSource && initialType === 'transfer') {
      if (!toAccountId) setToAccountId(fromSource.id);
    } else if (fromSource) return setAccountId(fromSource.id);
    SecureStore.getItemAsync(LAST_ACCOUNT_KEY).then((last) => {
      const usable = moneyAccounts.filter((x) => x.id !== fromSource?.id);
      const pool = usable.length ? usable : accounts;
      setAccountId((pool.find((a) => a.id === last) ?? pool[0]).id);
    });
  }, [accounts, moneyAccounts, accountId]);

  // Expense / Income can't be on a person; switch to a real account.
  useEffect(() => {
    if (mode === 'log' && accountId && accounts.find((a) => a.id === accountId)?.type === 'person') {
      setAccountId(moneyAccounts[0]?.id ?? null);
    }
  }, [mode, accountId, accounts, moneyAccounts]);

  const suggestion = useFeeSuggestion(mode === 'transfer' ? accountId : null, toAccountId);
  const effectiveFee = fee ?? {
    cents: suggestion.data?.fee_cents ?? 0,
    paidBy: suggestion.data?.fee_paid_by ?? 'sender',
    remembered: Boolean(suggestion.data),
  };

  const account = accounts.find((a) => a.id === accountId);
  const toAccount = accounts.find((a) => a.id === toAccountId);
  const cents = amount.cents;

  function switchMode(m) {
    setMode(m);
    setError(null);
    if (m === 'log') setToAccountId(null);
  }

  async function save(kind) {
    setError(null);
    if (!cents) return setError('Enter an amount first');
    if (!account) return setError('Choose an account');
    if (kind === 'transfer') {
      if (!toAccount) return setError('Choose where the money goes');
      if (effectiveFee.paidBy === 'receiver' && effectiveFee.cents > cents) return setError('Fee is larger than the amount');
    }
    const body = {
      client_id: Crypto.randomUUID(),
      type: kind,
      amount_cents: cents,
      account_id: account.id,
      to_account_id: kind === 'transfer' ? toAccount.id : null,
      fee_cents: kind === 'transfer' ? effectiveFee.cents : 0,
      fee_paid_by: kind === 'transfer' ? effectiveFee.paidBy : null,
      category_id: null,
      occurred_on: date,
      note: note.trim() || null,
    };
    // Show the confirmation immediately; the save finishes in the background.
    pickedCategory.current = null;
    const shown = { kind, cents, clientId: body.client_id, pending: true };
    showResult(shown);
    setBusy(true);
    try {
      const { transaction } = await api.post('/transactions', body, { timeoutMs: 15_000 });
      showResult({ ...shown, pending: false, id: transaction.id });
      // A category tapped while the save was still in flight
      if (pickedCategory.current) await api.patch(`/transactions/${transaction.id}`, { category_id: pickedCategory.current.id }).catch(() => {});
      refreshMoney();
    } catch (err) {
      if (!isRetryable(err)) {
        // Rejected by the server: take the confirmation away and explain on the card.
        if (resultRef.current?.clientId === body.client_id) showResult(null);
        setError(err.message);
        return;
      }
      const c = pickedCategory.current;
      await enqueue(c ? { ...body, category_id: c.id } : body, { account_name: account.name, to_account_name: toAccount?.name, category_name: c?.name });
      if (resultRef.current?.clientId === body.client_id) showResult({ ...shown, pending: false, queued: true });
    } finally {
      setBusy(false);
    }
    SecureStore.setItemAsync(LAST_ACCOUNT_KEY, account.id);
    if (detected?.id) {
      detectionStore.remove(detected.id); // logged, so drop it from the detected list
      setDetected(null);
    }
  }

  /** Category tapped on the confirmation screen; works before, during or after the save. */
  async function pickCategory(c) {
    pickedCategory.current = c;
    const r = resultRef.current;
    if (!r || r.pending) return; // applied when the save finishes
    if (r.queued) await updateQueued(r.clientId, { category_id: c.id }, { category_name: c.name });
    else {
      await api.patch(`/transactions/${r.id}`, { category_id: c.id });
      refreshMoney();
    }
  }

  /** From the confirmation screen: add a payslip breakdown to the income just saved. */
  function openPayslip(categoryName) {
    const r = resultRef.current;
    if (!r?.id) return;
    const type = categoryName === 'Part-time' ? 'part_time' : categoryName === 'Freelance' ? 'project' : 'salary';
    router.replace(`/payslip/new?transaction=${r.id}&net=${r.cents}&type=${type}${recurringId ? `&recurring=${recurringId}` : ''}`);
  }

  function addAnother() {
    showResult(null);
    amount.reset();
    setNote('');
    setFee(null);
    setDetected(null);
  }

  if (accountsQ.isPending) return <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}><Loading /></SafeAreaView>;
  if (!accounts.length) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, padding: space.lg }}>
        <IconButton icon="close" label="Close" color={t.text} onPress={onClose} />
        <Empty icon="wallet-outline" title="No accounts yet" hint="Add your bank, e-wallet or cash on hand in the Accounts tab first." />
      </SafeAreaView>
    );
  }

  const amountColor = cents ? t.text : t.muted;

  const content = (
    <>
      {/* Who / where */}
      {mode === 'log' ? (
        <Pressable
          onPress={() => setSheet('log')}
          style={({ pressed }) => ({ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: t.chip, opacity: pressed ? 0.7 : 1 })}
          accessibilityLabel={`Account: ${account?.name}. Tap to change`}
        >
          {account && <Ionicons name={ACCOUNT_TYPE_ICONS[account.type]} size={16} color={TYPE_COLORS[account.type]} />}
          <Text style={{ color: t.text, fontWeight: '700' }}>{account?.name ?? 'Choose account'}</Text>
          <Ionicons name="chevron-down" size={16} color={t.muted} />
        </Pressable>
      ) : (
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <AccountPicker label="From" account={account} onPress={() => setSheet('from')} />
            <IconButton
              icon="swap-horizontal"
              label="Swap from and to"
              color={t.text}
              onPress={() => { if (toAccountId) { const f = accountId; setAccountId(toAccountId); setToAccountId(f); setFee(null); } }}
            />
            <AccountPicker label="To" account={toAccount} placeholder="Choose" onPress={() => setSheet('to')} />
          </View>
        </View>
      )}

      {/* Amount */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 110 }}>
        {detected && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.primarySoft, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Ionicons name="sparkles" size={14} color={t.text} />
            <Text style={{ color: t.text, fontWeight: '700', fontSize: 13 }}>
              From your {detected.source} alert · {detected.type === 'transfer' ? 'slide to record the payment' : detected.type === 'income' ? 'swipe right for income' : 'swipe left for expense'}
            </Text>
          </View>
        )}
        {amount.hasOperator && <Text style={{ color: t.muted, fontSize: 18 }}>{amount.expr.replace(/-/g, ' − ').replace(/\+/g, ' + ')}</Text>}
        <BigAmount cents={cents} size={58} color={amountColor} />
        {account && (
          <Text style={{ color: t.muted, fontSize: 13 }}>
            Available in {account.name}: <Text style={{ color: t.text, fontWeight: '700' }}>{formatPHP(account.balance_cents)}</Text>
          </Text>
        )}
        {error && <Text style={{ color: t.danger, fontWeight: '600' }}>{error}</Text>}
      </View>

      {/* Details */}
      {editingNote ? (
        <TextInput
          value={note}
          onChangeText={setNote}
          autoFocus
          placeholder="Note, e.g. Jollibee lunch"
          placeholderTextColor={t.muted}
          onBlur={() => setEditingNote(false)}
          onSubmitEditing={() => setEditingNote(false)}
          maxLength={500}
          style={{ backgroundColor: t.card, color: t.text, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 }}
        />
      ) : (
        <ChipRow>
          <Chip icon="calendar-outline" label={friendlyDate(date)} onPress={() => setShowDate(true)} />
          <Chip icon="create-outline" label={note ? note : 'Add note'} selected={!!note} onPress={() => setEditingNote(true)} />
          {mode === 'transfer' && (
            <Chip
              icon="pricetag-outline"
              label={effectiveFee.cents ? `Fee ${formatPHP(effectiveFee.cents)} · ${effectiveFee.paidBy === 'sender' ? 'you pay' : 'deducted'}` : 'No fee'}
              selected={effectiveFee.cents > 0}
              onPress={() => setFeeSheet(true)}
            />
          )}
        </ChipRow>
      )}

      <Keypad onKey={amount.onKey} />
    </>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <View style={{ flex: 1, paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.md }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <IconButton icon="close" label="Close" color={t.text} onPress={onClose} />
          <View style={{ flex: 1 }}>
            <Segmented
              value={mode}
              onChange={switchMode}
              options={[{ value: 'log', label: 'Expense / Income' }, { value: 'transfer', label: 'Transfer' }]}
            />
          </View>
        </View>

        {mode === 'log' ? (
          <SwipeCard
            canSwipe={Boolean(cents) && !busy}
            onSwipe={(dir) => save(dir === 'left' ? 'expense' : 'income')}
            onBlocked={() => setError(busy ? 'Saving…' : 'Enter an amount first')}
          >
            {content}
          </SwipeCard>
        ) : (
          <>
            {content}
            <SwipeTrack mode="right" rightLabel="Transfer" disabled={busy || !cents || !toAccountId} onComplete={() => save('transfer')} hint={busy ? 'Saving…' : !toAccountId ? 'Choose where the money goes' : null} />
          </>
        )}
      </View>

      {showDate && (
        <DateTimePicker
          value={new Date(`${date}T12:00:00`)}
          mode="date"
          maximumDate={new Date()}
          onChange={(event, picked) => {
            setShowDate(Platform.OS === 'ios');
            if (event.type === 'set' && picked) {
              setDate(`${picked.getFullYear()}-${String(picked.getMonth() + 1).padStart(2, '0')}-${String(picked.getDate()).padStart(2, '0')}`);
            }
          }}
        />
      )}

      <AccountSheet
        visible={!!sheet}
        title={sheet === 'from' ? 'From which account?' : sheet === 'to' ? 'To which account?' : 'Which account?'}
        accounts={sheet === 'log' ? moneyAccounts : accounts}
        selected={sheet === 'to' ? toAccountId : accountId}
        disabledId={sheet === 'to' ? accountId : null}
        onClose={() => setSheet(null)}
        onSelect={(id) => {
          if (sheet === 'to') setToAccountId(id);
          else {
            setAccountId(id);
            if (id === toAccountId) setToAccountId(null);
          }
          setFee(null);
          setSheet(null);
        }}
      />
      <FeeSheet visible={feeSheet} value={effectiveFee} presets={presets} onClose={() => setFeeSheet(false)} onChange={(v) => { setFee(v); setFeeSheet(false); }} />

      {result && <Success result={result} account={account} toAccount={toAccount} fee={effectiveFee} onClose={onClose} onAnother={addAnother} onPickCategory={pickCategory} onPayslip={isOwner ? openPayslip : null} />}
    </SafeAreaView>
  );
}

function Sheet({ visible, onClose, title, children }) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose} />
      <View style={{ backgroundColor: t.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg, paddingBottom: 32, gap: space.md }}>
        <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: t.border }} />
        <Text style={{ fontSize: 18, fontWeight: '800', color: t.text }}>{title}</Text>
        {children}
      </View>
    </Modal>
  );
}

/** Compact "From / To" picker: label, account name and balance in one tappable pill. */
function AccountPicker({ label, account, placeholder = 'Choose', onPress }) {
  const t = useTheme();
  const color = account ? TYPE_COLORS[account.type] ?? t.primary : t.muted;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${account?.name ?? 'not chosen'}. Tap to change`}
      style={({ pressed }) => ({
        flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12,
        borderRadius: radius.md, backgroundColor: t.card, borderWidth: 1, borderColor: account ? t.border : t.primary,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={account ? (account.type === 'person' ? 'person-outline' : ACCOUNT_TYPE_ICONS[account.type]) : 'add'} size={18} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>{label}</Text>
        <Text style={{ color: account ? t.text : t.primary, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>{account?.name ?? placeholder}</Text>
      </View>
      <Ionicons name="chevron-down" size={16} color={t.muted} />
    </Pressable>
  );
}

const SHEET_GROUPS = [
  { title: 'Your money', match: (a) => ['bank', 'digital_bank', 'cash', 'savings'].includes(a.type) },
  { title: 'Cards & loans', match: (a) => a.type === 'credit_card' },
  { title: 'People', match: (a) => a.type === 'person' },
];

/** Account list grouped into Your money / Cards & loans / People. */
function AccountSheet({ visible, title, accounts, selected, disabledId, onSelect, onClose }) {
  const t = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: space.md }}>
        {SHEET_GROUPS.map((g) => {
          const list = accounts.filter(g.match);
          if (!list.length) return null;
          return (
            <View key={g.title} style={{ gap: 4 }}>
              <Label>{g.title}</Label>
              {list.map((a) => {
                const disabled = a.id === disabledId;
                const isSel = a.id === selected;
                return (
                  <Pressable
                    key={a.id}
                    disabled={disabled}
                    onPress={() => onSelect(a.id)}
                    style={({ pressed }) => ({
                      flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 10,
                      borderRadius: radius.md, backgroundColor: isSel ? t.primarySoft : pressed ? t.chip : 'transparent',
                      opacity: disabled ? 0.35 : 1,
                    })}
                  >
                    <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name={a.type === 'person' ? 'person-outline' : ACCOUNT_TYPE_ICONS[a.type]} size={18} color={TYPE_COLORS[a.type] ?? t.primary} />
                    </View>
                    <Text style={{ flex: 1, color: t.text, fontSize: 15, fontWeight: isSel ? '800' : '600' }} numberOfLines={1}>{a.name}</Text>
                    <Text style={{ color: a.balance_cents < 0 ? t.expense : t.muted, fontVariant: ['tabular-nums'] }}>{formatPHP(a.balance_cents)}</Text>
                    {isSel && <Ionicons name="checkmark" size={18} color={t.text} />}
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

function FeeSheet({ visible, value, presets, onChange, onClose }) {
  const [text, setText] = useState('');
  const [paidBy, setPaidBy] = useState('sender');
  useEffect(() => {
    if (visible) {
      setText(value.cents ? centsToInput(value.cents) : '');
      setPaidBy(value.paidBy);
    }
  }, [visible, value.cents, value.paidBy]);
  const cents = toCents(text || '0');

  return (
    <Sheet visible={visible} onClose={onClose} title="Transfer fee">
      {value.remembered && <Body muted style={{ fontSize: 13 }}>Pre-filled with the fee from your last transfer on this route.</Body>}
      <ChipRow>
        <Chip label="No fee" selected={!cents} onPress={() => onChange({ cents: 0, paidBy: 'sender' })} />
        {presets.filter((p) => p.fee_cents > 0).map((p) => (
          <Chip key={p.id} label={`${p.name} ${formatPHP(p.fee_cents)}`} selected={cents === p.fee_cents} onPress={() => onChange({ cents: p.fee_cents, paidBy: p.fee_paid_by })} />
        ))}
      </ChipRow>
      <Field label="Custom fee" value={text} onChangeText={(v) => setText(v.replace(/[^0-9.,]/g, ''))} placeholder="₱0.00" keyboardType="decimal-pad" />
      <Segmented value={paidBy} onChange={setPaidBy} options={[{ value: 'sender', label: 'I pay it (extra)' }, { value: 'receiver', label: 'Deducted from amount' }]} />
      <Button title="Use this fee" disabled={cents === null} onPress={() => onChange({ cents: cents ?? 0, paidBy })} />
    </Sheet>
  );
}

function Success({ result, account, toAccount, fee, onClose, onAnother, onPickCategory, onPayslip }) {
  const t = useTheme();
  const categoriesQ = useCategories();
  const [picked, setPicked] = useState(null);
  // Fade + scale in quickly so it feels instant
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: 140, useNativeDriver: true }).start();
  }, [appear]);
  const color = result.kind === 'income' ? t.income : result.kind === 'expense' ? t.expense : t.transfer;
  const caption = result.kind === 'transfer'
    ? `${account?.name} → ${toAccount?.name}${fee.cents ? ` · fee ${formatPHP(fee.cents)}` : ''}`
    : `${result.kind === 'income' ? 'Income to' : 'Expense from'} ${account?.name}`;
  const categories = (categoriesQ.data ?? []).filter((c) => c.kind === result.kind && !c.archived && !c.is_system);

  async function pick(c) {
    setPicked(c.id);
    try {
      await onPickCategory(c);
    } catch {
      setPicked(null);
    }
  }

  return (
    <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: appear, transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }}>
    <Pressable onPress={onClose} accessibilityLabel="Saved. Tap anywhere to close" style={{ flex: 1, backgroundColor: color, padding: space.xl, justifyContent: 'center', gap: space.md }}>
      <View style={{ alignItems: 'center', gap: space.sm }}>
        <Ionicons name={result.queued ? 'cloud-offline-outline' : 'checkmark'} size={64} color="#fff" />
        <BigAmount cents={result.cents} size={46} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' }}>{caption}</Text>
        {result.queued && <Text style={{ color: '#fff', opacity: 0.9, textAlign: 'center' }}>Saved offline, it will sync when you're back online.</Text>}
      </View>

      {result.kind !== 'transfer' && categories.length > 0 && (
        <View style={{ gap: space.sm, marginTop: space.lg }}>
          <Text style={{ color: '#fff', opacity: 0.85, textAlign: 'center', fontWeight: '600' }}>Add a category (optional)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm }}>
            {categories.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => pick(c)}
                style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: picked === c.id ? '#fff' : 'rgba(255,255,255,0.22)' }}
              >
                <Text style={{ color: picked === c.id ? color : '#fff', fontWeight: '700' }}>{c.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* Salary / part-time / project: add the payslip breakdown to this income */}
      {result.kind === 'income' && onPayslip && !result.queued && (
        <Pressable
          onPress={() => onPayslip(categories.find((c) => c.id === picked)?.name)}
          disabled={!result.id}
          style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space.md, paddingVertical: 12, paddingHorizontal: 18, borderRadius: radius.pill, backgroundColor: '#fff', opacity: result.id ? 1 : 0.6 }}
        >
          <Ionicons name="document-text-outline" size={18} color={color} />
          <Text style={{ color, fontWeight: '800' }}>{result.id ? 'Add payslip details' : 'Saving…'}</Text>
        </Pressable>
      )}
      {result.kind === 'income' && onPayslip && !result.queued && (
        <Text style={{ color: '#fff', opacity: 0.8, fontSize: 12, textAlign: 'center' }}>Salary? Add SSS, PhilHealth, Pag-IBIG, tax or lates</Text>
      )}

      <View style={{ alignItems: 'center', gap: space.md, marginTop: space.lg }}>
        <Pressable onPress={onAnother} style={{ paddingVertical: 10, paddingHorizontal: 20, borderRadius: radius.pill, borderWidth: 1.5, borderColor: '#fff' }}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>+ Add another</Text>
        </Pressable>
        <Text style={{ color: '#fff', opacity: 0.75, fontSize: 12 }}>Tap anywhere to close</Text>
      </View>
    </Pressable>
    </Animated.View>
  );
}
