import { useAsyncData } from '../hooks.js';
import { getMyBusinesses } from '../api.js';
import { ErrorState, Loading } from '../components/ui.js';
import { OwnerScreen as OwnerScreenChrome } from './owner-ui.js';
import { OwnerProfile } from './OwnerProfile.js';
import { OwnerHours } from './OwnerHours.js';
import { OwnerLocation } from './OwnerLocation.js';
import { DeliverySettingsSection } from './OwnerDeliverySettings.js';
import { OwnerServices, OwnerProducts } from './OwnerCatalog.js';
import { OwnerBookingsList } from './OwnerBookingsList.js';
import { OwnerOrders } from './OwnerOrders.js';
import { OwnerCustomerPayments } from './OwnerCustomerPayments.js';
import { OwnerSubscription } from './OwnerSubscriptionScreen.js';
import { OwnerReviews } from './OwnerReviews.js';

/** Page titles for each dedicated management screen. */
const TITLE: Record<string, string> = {
  profile: 'Business Profile',
  hours: 'Business Hours',
  location: 'Location',
  delivery: 'Delivery & COD',
  settings: 'Business Settings',
  services: 'Services',
  advances: 'Service Advance Settings',
  products: 'Products / Menu',
  bookings: 'Business Bookings',
  orders: 'Business Orders',
  payments: 'Customer Payments',
  'payment-methods': 'Business Payment Methods',
  subscription: 'Business Subscription',
  reviews: 'Business Reviews',
};

/**
 * One dedicated Business Dashboard screen per management feature. Each renders
 * through the shared chrome — back link, its own page title, and normal
 * scrolling content — never an overlay.
 */
export function OwnerScreen(props: { screen: string; businessId: string; onBack: () => void }) {
  const { screen, businessId, onBack } = props;

  let body: React.ReactNode;
  switch (screen) {
    case 'profile':
      body = <OwnerProfileLoader businessId={businessId} />;
      break;
    case 'hours':
      body = <OwnerHours businessId={businessId} />;
      break;
    case 'location':
      body = <OwnerLocation businessId={businessId} />;
      break;
    // Delivery and Business Settings expose the same server-authoritative
    // delivery/COD configuration; the hub lists both entry points.
    case 'delivery':
    case 'settings':
      body = <DeliverySettingsSection businessId={businessId} />;
      break;
    // Advance settings live on the service forms (NONE/FIXED/PERCENTAGE),
    // so the dedicated screen shows the same per-service management.
    case 'services':
    case 'advances':
      body = <OwnerServices businessId={businessId} />;
      break;
    case 'products':
      body = <OwnerProducts businessId={businessId} />;
      break;
    case 'bookings':
      body = <OwnerBookingsList businessId={businessId} onOpenBooking={onBack} />;
      break;
    case 'orders':
      body = <OwnerOrders businessId={businessId} />;
      break;
    // Customer Payments and Business Payment Methods are one management area
    // (verification queue + the channels customers pay into).
    case 'payments':
    case 'payment-methods':
      body = <OwnerCustomerPayments businessId={businessId} />;
      break;
    case 'subscription':
      body = <OwnerSubscription businessId={businessId} />;
      break;
    case 'reviews':
      body = <OwnerReviews businessId={businessId} />;
      break;
    default:
      body = <ErrorState message="Unknown screen." />;
  }

  return (
    <OwnerScreenChrome title={TITLE[screen] ?? 'Business'} onBack={onBack}>
      {body}
    </OwnerScreenChrome>
  );
}

/** Profile screen body: resolves the owned business, then renders the form. */
function OwnerProfileLoader({ businessId }: { businessId: string }) {
  const businesses = useAsyncData(() => getMyBusinesses(), []);
  if (businesses.loading) return <Loading label="Loading your business…" />;
  if (businesses.error) return <ErrorState message={businesses.error} onRetry={businesses.reload} />;
  const business = businesses.data?.find((b) => b.id === businessId);
  if (!business) return <ErrorState message="This business was not found in your account." />;
  return <OwnerProfile business={business} onSaved={businesses.reload} />;
}
