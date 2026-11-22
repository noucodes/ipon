import { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Card, IconButton, Ionicons, Money } from './ui';
import { detectionHref, useDetections } from '../lib/detections';
import { useTheme, space, radius } from '../theme';

/** "Detected from your notifications" card on Home: one tap to log, or dismiss. */
export function DetectedList() {
  const t = useTheme();
  const router = useRouter();
  const { items, dismiss, refresh } = useDetections();
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  if (!items.length) return null;

  return (
    <Card style={{ backgroundColor: t.primarySoft }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name="sparkles" size={16} color={t.text} />
        <Text style={{ fontWeight: '800', color: t.text, flex: 1 }}>Detected payments</Text>
        <Text style={{ color: t.muted, fontSize: 12 }}>tap to log</Text>
      </View>
      {items.slice(0, 5).map((d) => (
        <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Pressable
            onPress={() => router.push(detectionHref(d))}
            style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: t.card, borderRadius: radius.md, padding: space.md, opacity: pressed ? 0.7 : 1 })}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: t.text }}>{d.source} · {d.type === 'income' ? 'received' : d.type === 'loan_payment' ? 'loan payment' : 'sent / paid'}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }} numberOfLines={1}>{d.text}</Text>
            </View>
            <Money cents={d.amount_cents} kind={d.type === 'loan_payment' ? 'transfer' : d.type} signed={d.type !== 'loan_payment'} />
          </Pressable>
          <IconButton icon="close-circle-outline" label="Dismiss" color={t.muted} onPress={() => dismiss(d.id)} />
        </View>
      ))}
    </Card>
  );
}
