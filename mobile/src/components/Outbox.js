import { useState } from 'react';
import { View } from 'react-native';
import { Body, Card, IconButton, Ionicons, Label, Money, Button } from './ui';
import { discard, syncOutbox, useOutbox } from '../lib/outbox';
import { friendlyDate } from '../lib/format';
import { useTheme, space } from '../theme';

/** Compact banner: "2 entries waiting to sync". */
export function OutboxBanner() {
  const t = useTheme();
  const items = useOutbox();
  const [busy, setBusy] = useState(false);
  if (!items.length) return null;
  const failed = items.filter((i) => i.error).length;
  const waiting = items.length - failed;

  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: t.primarySoft }}>
      <Ionicons name={failed ? 'alert-circle' : 'cloud-upload-outline'} size={22} color={failed ? t.danger : t.primary} />
      <View style={{ flex: 1 }}>
        {waiting > 0 && <Body style={{ fontWeight: '700' }}>{waiting} {waiting === 1 ? 'entry' : 'entries'} saved offline</Body>}
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

/** Full list of queued entries, shown at the top of Activity. */
export function OutboxList() {
  const t = useTheme();
  const items = useOutbox();
  if (!items.length) return null;
  return (
    <Card style={{ backgroundColor: t.primarySoft }}>
      <Label>Waiting to sync</Label>
      {items.map(({ body, meta, error }) => (
        <View key={body.client_id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6 }}>
          <Ionicons name={error ? 'alert-circle' : 'time-outline'} size={22} color={error ? t.danger : t.muted} />
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: '600' }} numberOfLines={1}>
              {body.type === 'transfer' ? `${meta.account_name} → ${meta.to_account_name}` : body.note || meta.category_name || meta.account_name}
            </Body>
            <Body muted style={{ fontSize: 12, color: error ? t.danger : t.muted }} numberOfLines={2}>
              {error ?? `${friendlyDate(body.occurred_on)} · ${meta.account_name}`}
            </Body>
          </View>
          <Money cents={body.amount_cents} kind={body.type} signed />
          {error && <IconButton icon="trash-outline" label="Discard" color={t.danger} onPress={() => discard(body.client_id)} />}
        </View>
      ))}
    </Card>
  );
}
