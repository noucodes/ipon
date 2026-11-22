import { ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { TransactionForm } from '../../components/TransactionForm';
import { RequireAuth } from '../../components/RequireAuth';
import { Body, ErrorText, Loading } from '../../components/ui';
import { useTransaction } from '../../lib/queries';
import { space } from '../../theme';

export default function EditTransaction() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const q = useTransaction(id);

  return (
    <RequireAuth>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 48, gap: space.md }} keyboardShouldPersistTaps="handled">
        {q.isPending && <Loading />}
        <ErrorText error={q.error} />
        {q.data && (
          <>
            <Body muted style={{ fontSize: 13 }}>Logged by {q.data.created_by_name ?? 'someone'}</Body>
            <TransactionForm key={q.data.id} initial={q.data} onDone={() => router.back()} />
          </>
        )}
      </ScrollView>
    </RequireAuth>
  );
}
