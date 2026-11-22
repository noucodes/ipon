import { useLocalSearchParams, useRouter } from 'expo-router';
import { QuickAdd } from '../components/QuickAdd';
import { RequireAuth } from '../components/RequireAuth';

const TYPES = ['expense', 'income', 'transfer'];

// Quick add. Opened by double-tap, the Home buttons, app icon shortcuts,
// the quick settings tile, the widget, a detected-payment notification, or a deep link:
//   financetracker://add  ·  financetracker://add?type=transfer
//   financetracker://add?type=expense&amount=50000&source=GCash&detection=<id>
export default function AddTransaction() {
  const router = useRouter();
  const { type, amount, source, detection, from, to, recurring } = useLocalSearchParams();
  const cents = Number.parseInt(amount, 10);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <RequireAuth>
      <QuickAdd
        initialType={TYPES.includes(type) ? type : 'expense'}
        initialAmountCents={Number.isFinite(cents) && cents > 0 ? cents : 0}
        source={typeof source === 'string' ? source : null}
        detectionId={typeof detection === 'string' ? detection : null}
        initialFrom={typeof from === 'string' ? from : null}
        initialTo={typeof to === 'string' ? to : null}
        recurringId={typeof recurring === 'string' ? recurring : null}
        onClose={close}
      />
    </RequireAuth>
  );
}
