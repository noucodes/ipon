import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { IconButton, Ionicons } from './ui';
import { useAuth } from '../lib/auth';
import { useTheme, space, radius } from '../theme';

/** "Set up your finances" prompt on Home until the guide is finished or skipped (saved on the account). */
export function SetupCard() {
  const t = useTheme();
  const router = useRouter();
  const { user, isOwner, setOnboarded } = useAuth();
  if (!isOwner || !user || user.onboarded) return null;

  return (
    <Pressable
      onPress={() => router.push('/setup')}
      style={({ pressed }) => ({ backgroundColor: t.primary, borderRadius: radius.lg, padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md, opacity: pressed ? 0.85 : 1 })}
    >
      <Ionicons name="rocket-outline" size={26} color={t.primaryText} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.primaryText, fontWeight: '800', fontSize: 16 }}>Set up your finances</Text>
        <Text style={{ color: t.primaryText, opacity: 0.75, fontSize: 13 }}>Banks, cash, cards, loans, utang, salary & bills · ~5 min</Text>
      </View>
      <IconButton icon="close" label="Skip setup" color={t.primaryText} onPress={() => setOnboarded(true).catch(() => {})} />
    </Pressable>
  );
}
