import { listPaymentMethods, type PaymentMethod } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { ErrorState, Loading } from '../components/ui.js';
import { PaymentMethodCard } from './OwnerSubscriptionShared.js';

/**
 * Payment methods: the admin-configured pay-in channels only — title,
 * account title, account number, instructions. Nothing else: no form, no
 * history. All channels come from GET /subscription/payment-methods; nothing
 * is hard-coded.
 *
 * Rendered inside the OwnerScreen chrome, which provides the back button to
 * the subscription hub — this screen never renders its own.
 */
export function OwnerSubscriptionPaymentMethods() {
  const methods = useAsyncData<PaymentMethod[]>(() => listPaymentMethods(), []);
  const methodList = Array.isArray(methods.data) ? methods.data : [];

  return (
    <div className="pay-wrap">
      <p className="sub-lede">Send your payment using one of the methods below, then submit your payment proof.</p>

      {methods.loading ? (
        <Loading label="Loading payment methods…" />
      ) : methods.error ? (
        <ErrorState message={methods.error} onRetry={methods.reload} />
      ) : methodList.length === 0 ? (
        <p className="pay-empty">No payment methods are available right now. Please try again later.</p>
      ) : (
        <ul className="pay-method-list">
          {methodList.map((m) => (
            <PaymentMethodCard key={m.id} method={m} />
          ))}
        </ul>
      )}
    </div>
  );
}
