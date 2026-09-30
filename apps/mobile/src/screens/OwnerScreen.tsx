import { useAsyncData } from '../hooks.js';
import { getMyBusinesses } from '../api.js';
import { ErrorState, Loading } from '../components/ui.js';
import { OwnerScreen as OwnerScreenChrome } from './owner-ui.js';
import { OwnerProfile } from './OwnerProfile.js';
import { OwnerHours } from './OwnerHours.js';
import { OwnerLocation } from './OwnerLocation.js';
import { DeliverySettingsSection, BusinessSettingsScreen } from './OwnerDeliverySettings.js';
import { OwnerServices, OwnerProducts } from './OwnerCatalog.js';
import { OwnerBookingsList } from './OwnerBookingsList.js';
import { OwnerOrders } from './OwnerOrders.js';
import { OwnerCustomerPayments } from './OwnerCustomerPayments.js';
import { OwnerSubscription } from './OwnerSubscriptionScreen.js';
import { OwnerSubscriptionPlanDetails } from './OwnerSubscriptionPlanScreen.js';
import { OwnerSubscriptionChangePlan } from './OwnerSubscriptionChangePlanScreen.js';
import { OwnerSubscriptionPaymentMethods } from './OwnerSubscriptionPaymentMethodsScreen.js';
import { OwnerSubscriptionMakePayment } from './OwnerSubscriptionMakePaymentScreen.js';
import { OwnerSubscriptionPaymentHistory } from './OwnerSubscriptionPaymentHistoryScreen.js';
import { OwnerVerification } from './OwnerVerificationScreen.js';
import { OwnerPromotions } from './OwnerPromotionsScreen.js';
import { OwnerReviews } from './OwnerReviews.js';
import { OwnerRiders } from './OwnerRiders.js';

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
  riders: 'Riders',
  payments: 'Customer Payments',
  'payment-methods': 'Business Payment Methods',
  subscription: 'Business Subscription',
  'subscription-plan': 'Plan Details',
  'subscription-change-plan': 'Change Plan',
  'subscription-payment-methods': 'Payment Methods',
  'subscription-make-payment': 'Make a Payment',
  'subscription-payment-history': 'Payment History',
  'choose-plan': 'Choose Your Plan',
  verification: 'Business Verification',
  promotions: 'Promotions',
  reviews: 'Business Reviews',
};

/**
 * One dedicated Business Dashboard screen per management feature. Each renders
 * through the shared chrome — back link, its own page title, and normal
 * scrolling content — never an overlay.
 */
export function OwnerScreen(props: {
  screen: string;
  businessId: string;
  onBack: () => void;
  /** Opens a booking detail — the bookings list is a management screen, not a detail, so it needs a real opener. */
  onOpenBooking: (id: string) => void;
  /** Opens another owner management route (used by the Business Settings screen). Optional so deep links without a router still render. */
  onOpen?: (path: string) => void;
}) {
  const { screen, businessId, onBack, onOpenBooking } = props;

  // Back target for the subscription sub-screens: the subscription hub,
  // explicitly (history.back() is unsafe on cold-launch deep links, and the
  // hub is the only sensible parent). Without a router, fall back to the
  // dashboard back target.
  const hubBack = props.onOpen ? () => props.onOpen!(`/owner/${businessId}/subscription`) : onBack;
  const isSubscriptionSubScreen = [
    'subscription-plan',
    'subscription-change-plan',
    'subscription-payment-methods',
    'subscription-make-payment',
    'subscription-payment-history',
    'choose-plan',
  ].includes(screen);

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
    // The 'delivery' route is the focused Delivery & COD screen. The
    // 'settings' route is a genuine Business Settings screen: the delivery
    // section (the only business-wide settings that exist) plus links to
    // every other configuration area — visibly different from 'delivery',
    // and both route names keep working.
    case 'delivery':
      body = <DeliverySettingsSection businessId={businessId} />;
      break;
    case 'settings':
      body = props.onOpen ? (
        <BusinessSettingsScreen businessId={businessId} onOpen={props.onOpen} />
      ) : (
        <DeliverySettingsSection businessId={businessId} />
      );
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
      body = <OwnerBookingsList businessId={businessId} onOpenBooking={onOpenBooking} />;
      break;
    case 'orders':
      body = <OwnerOrders businessId={businessId} />;
      break;
    case 'riders':
      body = <OwnerRiders businessId={businessId} onBack={onBack} />;
      break;
    // Customer Payments and Business Payment Methods are one management area
    // (verification queue + the channels customers pay into).
    case 'payments':
    case 'payment-methods':
      body = <OwnerCustomerPayments businessId={businessId} />;
      break;
    case 'subscription':
      body = <OwnerSubscription businessId={businessId} onOpen={props.onOpen} />;
      break;
    // Subscription sub-screens: each its own route, each with a working
    // back button to the subscription hub. With a router, back goes to the
    // hub explicitly (never history.back(), which is unsafe on cold-launch
    // deep links); without one, it falls back to the dashboard back target.
    case 'subscription-plan':
      body = <OwnerSubscriptionPlanDetails businessId={businessId} />;
      break;
    case 'subscription-change-plan':
      body = <OwnerSubscriptionChangePlan businessId={businessId} onBack={hubBack} />;
      break;
    // 'choose-plan' is the legacy route name for the change-plan screen.
    case 'choose-plan':
      body = <OwnerSubscriptionChangePlan businessId={businessId} onBack={hubBack} />;
      break;
    case 'subscription-payment-methods':
      body = <OwnerSubscriptionPaymentMethods />;
      break;
    case 'subscription-make-payment':
      body = <OwnerSubscriptionMakePayment businessId={businessId} onOpen={props.onOpen} />;
      break;
    case 'subscription-payment-history':
      body = <OwnerSubscriptionPaymentHistory businessId={businessId} />;
      break;
    case 'verification':
      body = <OwnerVerification businessId={businessId} />;
      break;
    case 'promotions':
      body = <OwnerPromotions businessId={businessId} />;
      break;
    case 'reviews':
      body = <OwnerReviews businessId={businessId} />;
      break;
    default:
      body = <ErrorState message="Unknown screen." />;
  }

  return (
    <OwnerScreenChrome title={TITLE[screen] ?? 'Business'} onBack={isSubscriptionSubScreen ? hubBack : onBack}>
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
