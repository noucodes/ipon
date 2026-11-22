// Transfer fee presets (InstaPay ₱15…), moved out of Settings into their own screen.
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { toCents } from '@ft/shared';
import { RequireAuth } from '../components/RequireAuth';
import { Button, Card, ErrorText, Field, IconButton, Label, Row, Section, Segmented } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useFeePresets, api } from '../lib/queries';
import { queryClient } from '../lib/queryClient';
import { formatPHP } from '../lib/format';
import { useTheme, space } from '../theme';

export default function FeePresetsScreen() {
  const t = useTheme();
  const { isOwner } = useAuth();
  const q = useFeePresets();
  const [name, setName] = useState('');
  const [fee, setFee] = useState('');
  const [paidBy, setPaidBy] = useState('sender');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['feePresets'] });
  const add = useMutation({ mutationFn: (body) => api.post('/fee-presets', body), onSuccess: () => { setName(''); setFee(''); refresh(); } });
  const remove = useMutation({ mutationFn: (id) => api.del(`/fee-presets/${id}`), onSuccess: refresh });

  return (
    <RequireAuth>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 48, gap: space.xl }} keyboardShouldPersistTaps="handled">
        <Section title="Presets" footer="Quick picks when logging a transfer. The app also remembers the last fee you used between two accounts.">
          {(q.data ?? []).map((p) => (
            <Row
              key={p.id}
              icon="pricetag-outline"
              iconColor="#E0533D"
              label={p.name}
              hint={`${formatPHP(p.fee_cents)} · ${p.fee_paid_by === 'sender' ? 'sender pays' : 'receiver pays'}`}
              right={isOwner ? <IconButton icon="trash-outline" label={`Delete ${p.name}`} color={t.danger} onPress={() => remove.mutate(p.id)} /> : null}
            />
          ))}
        </Section>

        {isOwner && (
          <Card>
            <Label>Add a preset</Label>
            <Field value={name} onChangeText={setName} placeholder="Name, e.g. GCash to BPI" maxLength={40} />
            <Field value={fee} onChangeText={(v) => setFee(v.replace(/[^0-9.,]/g, ''))} placeholder="Fee ₱" keyboardType="decimal-pad" />
            <Segmented value={paidBy} onChange={setPaidBy} options={[{ value: 'sender', label: 'Sender pays' }, { value: 'receiver', label: 'Receiver pays' }]} />
          </Card>
        )}
        {isOwner && (
          <>
            <ErrorText error={add.error} />
            <Button
              title="Add preset"
              icon="add"
              loading={add.isPending}
              disabled={!name.trim() || toCents(fee || 'x') === null}
              onPress={() => add.mutate({ name: name.trim(), fee_cents: toCents(fee), fee_paid_by: paidBy })}
            />
          </>
        )}
      </ScrollView>
    </RequireAuth>
  );
}
