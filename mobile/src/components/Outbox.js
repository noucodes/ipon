import { useState } from 'react';
import { View } from 'react-native';
import { Body, Card, IconButton, Ionicons, Label, Money, Button } from './ui';
import { discard, syncOutbox, useOutbox, useSyncStatus } from '../lib/outbox';
import { friendlyDate } from '../lib/format';
import { useTheme, space } from '../theme';

const keyOf = (i) => i.body?.client_id ?? `${i.op}-${i.id}`;

/**
 * Compact banner on Home. Entries waiting to sync already show in your balances and lists,
 * so this only appears when you're offline or something couldn't be saved.
 */
export function OutboxBanner() {
  const t = useTheme();
  const items = useOutbox();
  const { online } = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const failed = items.filter((i) => i.error).length;
  const waiting = items.length - failed;
  if (!failed && (online || !waiting)) return null;

  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: t.primarySoft }}>
      <Ionicons name={failed ? 'alert-circle' : 'cloud-offline-outline'} size={22} color={failed ? t.danger : t.primary} />
      <View style={{ flex: 1 }}>
        {waiting > 0 && <Body style={{ fontWeight: '700' }}>{waiting} {waiting === 1 ? 'change' : 'changes'} saved on your phone</Body>}
        {failed > 0 && <Body style={{ fontWeight: '700', color: t.danger }}>{failed} couldn't be saved. See Activity.</Body>}
        <Body muted style={{ fontSize: 13 }}>{waiting ? 'They sync automatically when you are online.' : 'Open Activity to review them.'}</Body>
      </View>
      {waiting > 0 && (
        <Button
          title="Sync"
          variant="secondary"
          loading={busy}
          style={{ minHeight: 38, paddingVertical: 8 }}
          onPress={async () => { setBusy(true); await syncOutbox(); setBusy(false); }}
        />
      )}
    </Card>
  );
}

/** Entries the server turned down, shown at the top of Activity so you can discard them. */
export function OutboxList() {
  const t = useTheme();
  const items = useOutbox().filter((i) => i.error || !i.change); // the rest are already in the list
  if (!items.length) return null;
  return (
    <Card style={{ backgroundColor: t.primarySoft }}>
      <Label>Waiting to sync</Label>
      {items.map((item) => {
        const { meta = {}, error } = item;
        const body = { ...item.change?.before, ...item.change?.after, ...item.body };
        const verb = item.op === 'delete' ? 'Delete: ' : item.op === 'update' ? 'Change: ' : item.entity && item.entity !== 'tx' ? 'New: ' : '';
        if (item.entity === 'account' || item.entity === 'recurring') {
          const what = item.entity === 'account' ? (body.type === 'person' ? 'person' : 'account') : body.kind === 'income' ? 'income' : 'bill';
          return (
            <View key={keyOf(item)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6 }}>
              <Ionicons name={error ? 'alert-circle' : 'time-outline'} size={22} color={error ? t.danger : t.muted} />
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: '600' }} numberOfLines={1}>{verb}{body.name} ({what})</Body>
                {!!error && <Body muted style={{ fontSize: 12, color: t.danger }} numberOfLines={2}>{error}</Body>}
              </View>
              {error && <IconButton icon="trash-outline" label="Discard" color={t.danger} onPress={() => discard(item.id)} />}
            </View>
          );
        }
        return (
          <View key={keyOf(item)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6 }}>
            <Ionicons name={error ? 'alert-circle' : 'time-outline'} size={22} color={error ? t.danger : t.muted} />
            <View style={{ flex: 1 }}>
              <Body style={{ fontWeight: '600' }} numberOfLines={1}>
                {verb}
                {body.type === 'transfer'
                  ? `${body.account_name ?? meta.account_name} → ${body.to_account_name ?? meta.to_account_name}`
                  : body.note || body.category_name || meta.category_name || body.account_name || meta.account_name}
              </Body>
              <Body muted style={{ fontSize: 12, color: error ? t.danger : t.muted }} numberOfLines={2}>
                {error ?? `${friendlyDate(body.occurred_on)} · ${body.account_name ?? meta.account_name}`}
              </Body>
            </View>
            {body.amount_cents != null && <Money cents={body.amount_cents} kind={body.type} signed />}
            {error && <IconButton icon="trash-outline" label="Discard" color={t.danger} onPress={() => discard(item.body?.client_id ?? item.id)} />}
          </View>
        );
      })}
    </Card>
  );
}
