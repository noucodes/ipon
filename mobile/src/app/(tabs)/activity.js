import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Chip, ChipRow, Empty, ErrorText, Fab, Field, Label, Loading, Title } from '../../components/ui';
import { TransactionRow } from '../../components/TransactionRow';
import { OutboxList } from '../../components/Outbox';
import { useTransactions } from '../../lib/queries';
import { useDoubleTap } from '../../lib/useDoubleTap';
import { friendlyDate } from '../../lib/format';
import { useTheme, space } from '../../theme';

const FILTERS = [
  { value: undefined, label: 'All' },
  { value: 'expense', label: 'Expenses' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfers' },
];

export default function Activity() {
  const t = useTheme();
  const router = useRouter();
  const [type, setType] = useState(undefined);
  const [search, setSearch] = useState('');
  const q = useTransactions({ type, q: search.trim() || undefined });
  const doubleTap = useDoubleTap(() => router.push('/add'));

  // Flatten pages and insert a date header whenever the day changes.
  const rows = useMemo(() => {
    const out = [];
    let lastDate = null;
    for (const page of q.data?.pages ?? []) {
      for (const tx of page.transactions) {
        if (tx.occurred_on !== lastDate) {
          out.push({ kind: 'header', key: `h-${tx.occurred_on}`, date: tx.occurred_on });
          lastDate = tx.occurred_on;
        }
        out.push({ kind: 'tx', key: tx.id, tx });
      }
    }
    return out;
  }, [q.data]);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }} {...doubleTap}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ padding: space.lg, paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={q.refetch} />}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.sm }}>
            <Title>Activity</Title>
            <Field value={search} onChangeText={setSearch} placeholder="Search notes" returnKeyType="search" />
            <ChipRow>
              {FILTERS.map((f) => (
                <Chip key={f.label} label={f.label} selected={type === f.value} onPress={() => setType(f.value)} />
              ))}
            </ChipRow>
            <OutboxList />
            {q.isPending && <Loading />}
            <ErrorText error={q.error} />
          </View>
        }
        ListEmptyComponent={!q.isPending && !q.error ? (
          <Empty icon="receipt-outline" title="Nothing here yet" hint="Double-tap or press + to log a transaction." />
        ) : null}
        ListFooterComponent={q.isFetchingNextPage ? <Loading /> : null}
        renderItem={({ item }) =>
          item.kind === 'header' ? (
            <Label style={{ marginTop: space.lg, marginBottom: 2 }}>{friendlyDate(item.date)}</Label>
          ) : (
            <View style={{ marginBottom: space.sm }}>
              <TransactionRow tx={item.tx} card onPress={() => router.push(`/transaction/${item.tx.id}`)} />
            </View>
          )
        }
      />
      <Fab onPress={() => router.push('/add')} />
    </SafeAreaView>
  );
}
