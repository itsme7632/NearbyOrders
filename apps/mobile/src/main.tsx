import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { businessTabs, navigationTabs, type BusinessTab, type Tab } from './navigation.js';
import { getSession, onSessionChange, type Session } from './api.js';
import { useRoute } from './hooks.js';
import { initModeSessionSync, setAppMode, useAppMode } from './mode.js';
import { BellIcon, BookingsIcon, ExploreIcon, HomeIcon, OrdersIcon, ProfileIcon, StoreIcon } from './components/icons.js';
import { EmptyState, Loading } from './components/ui.js';
import { HomeScreen } from './screens/Home.js';
import { ExploreScreen } from './screens/Explore.js';
import { BusinessDetailScreen } from './screens/BusinessDetail.js';
import { BookServiceScreen } from './screens/BookService.js';
import { BookingsScreen, BookingDetailScreen } from './screens/Bookings.js';
import { ProfileScreen, EditProfileScreen, ChangePasswordScreen } from './screens/Profile.js';
import { OwnerDashboardScreen } from './screens/OwnerDashboard.js';
import { OwnerScreen } from './screens/OwnerScreen.js';
import { OwnerBookingDetailScreen } from './screens/OwnerBookings.js';
import { OwnerBusinessHome } from './screens/OwnerBusinessHome.js';
import { OwnerBusinessOrders } from './screens/OwnerBusinessOrders.js';
import { OwnerBusinessBookings } from './screens/OwnerBusinessBookings.js';
import { OwnerEarnings } from './screens/OwnerEarnings.js';
import { OwnerBusinessProfile } from './screens/OwnerBusinessProfile.js';
import { CreateBusinessScreen } from './screens/CreateBusiness.js';
import { CartScreen } from './screens/Cart.js';
import { OrdersScreen, OrderDetailScreen } from './screens/Orders.js';
import { NotificationsScreen } from './screens/Notifications.js';
import { useUnreadNotifications } from './useUnreadNotifications.js';

initModeSessionSync();

/** Exported (besides self-mounting below) so tests can render the full app shell. */
export function App() {
  const [tab, setTab] = useState<Tab>('Home');
  const [businessTab, setBusinessTab] = useState<BusinessTab>('Overview');
  const [route, push, back] = useRoute();
  const [session, setSession] = useState<Session | null>(getSession());
  const [exploreSeed, setExploreSeed] = useState<{ category?: string; query?: string; nonce: number }>({ nonce: 0 });
  const [justCreatedName, setJustCreatedName] = useState<string | null>(null);
  const [justCreatedStatus, setJustCreatedStatus] = useState<string | null>(null);
  const { mode } = useAppMode();
  useEffect(() => onSessionChange(setSession), []);

  const isOwner = session?.user.role === 'BUSINESS_OWNER';
  const businessMode = Boolean(isOwner && mode === 'BUSINESS');

  const openBusiness = (id: string) => push(`/business/${id}`);

  const openCart = () => push('/cart');

  /** Signed-out fallback: ProfileScreen doubles as the auth screen. */
  const profileAuthScreen = (
    <ProfileScreen
      onOwnerDashboard={() => {
        setAppMode('BUSINESS');
        push('/owner');
      }}
      onEditProfile={() => push('/edit-profile')}
      onChangePassword={() => push('/change-password')}
      onOpenOrders={() => {
        setTab('Orders');
        push('/');
      }}
      onOpenBookings={() => {
        setTab('Bookings');
        push('/');
      }}
      onOpenNotifications={() => push('/notifications')}
    />
  );

  /** Signed-in Profile tab: the account & settings hub (customer identity). */
  const profileHubScreen = (
    <ProfileScreen
      onOwnerDashboard={() => {
        setAppMode('BUSINESS');
        push('/owner');
      }}
      onEditProfile={() => push('/edit-profile')}
      onChangePassword={() => push('/change-password')}
      onOpenOrders={() => {
        setTab('Orders');
        push('/');
      }}
      onOpenBookings={() => {
        setTab('Bookings');
        push('/');
      }}
      onOpenNotifications={() => push('/notifications')}
    />
  );

  // Phase 5: unread badge on the header bell. Refreshes on app open, window
  // focus, session changes, and explicitly after read-state mutations.
  const unread = useUnreadNotifications();

  /** Deep link for a notification: entity detail, or a safe fallback when the target no longer exists. */
  const openNotification = (n: { entityType: 'Booking' | 'Order' | string; entityId: string }) => {
    if (n.entityType === 'Booking') {
      setTab('Bookings');
      push(`/booking/${n.entityId}`);
    } else if (n.entityType === 'Order') {
      setTab('Orders');
      push(`/order/${n.entityId}`);
    } else {
      push('/notifications');
    }
  };

  const goExplore = (seed: { category?: string; query?: string }) => {
    setTab('Explore');
    setExploreSeed((prev) => ({ ...seed, nonce: prev.nonce + 1 }));
    push('/');
  };

  /** Leaves Business mode and returns to the customer experience. */
  const switchToCustomer = () => {
    setAppMode('CUSTOMER');
    setTab('Home');
    push('/');
  };

  let content: React.ReactNode;
  if (route.name === 'business') {
    content = (
      <BusinessDetailScreen
        idOrSlug={route.idOrSlug}
        onBack={back}
        onBook={(serviceId) => push(`/book/${route.idOrSlug}${serviceId ? `/${serviceId}` : ''}`)}
        canOrder={Boolean(session)}
        onOpenCart={session ? openCart : undefined}
      />
    );
  } else if (route.name === 'cart') {
    content = session ? (
      <CartScreen
        onBack={back}
        onBrowse={() => {
          setTab('Explore');
          push('/');
        }}
        onPlaced={() => {
          setTab('Orders');
          push('/');
        }}
      />
    ) : null;
  } else if (route.name === 'order') {
    // Both roles open order detail here: a customer sees their order; the
    // owning business is authorized server-side for the same endpoint.
    content = session ? <OrderDetailScreen orderId={route.orderId} onBack={back} /> : null;
  } else if (route.name === 'notifications') {
    content = session ? (
      <NotificationsScreen onOpenNotification={openNotification} onReadStateChange={unread.refresh} />
    ) : null;
  } else if (route.name === 'edit-profile') {
    content = session ? <EditProfileScreen onBack={back} onSaved={unread.refresh} /> : null;
  } else if (route.name === 'change-password') {
    content = session ? <ChangePasswordScreen onBack={back} /> : null;
  } else if (route.name === 'book') {
    // Both customers and business owners book through the same flow; the
    // identity is the signed-in person either way. Booking your own business
    // is blocked server-side.
    content = session ? (
      <BookServiceScreen
        businessId={route.businessId}
        preselectedServiceId={route.serviceId}
        onBack={back}
        onDone={() => {
          setTab('Bookings');
          push('/');
        }}
      />
    ) : null;
  } else if (route.name === 'booking') {
    // Same detail route for both roles; each gets their own view (owner view
    // includes lifecycle actions; customer view includes cancellation).
    content = session ? (
      session.user.role === 'BUSINESS_OWNER' ? (
        <OwnerBookingDetailScreen bookingId={route.bookingId} onBack={back} />
      ) : (
        <BookingDetailScreen bookingId={route.bookingId} onBack={back} />
      )
    ) : null;
  } else if (route.name === 'owner-dashboard') {
    // /owner: Business-mode Overview hub.
    content = session && session.user.role === 'BUSINESS_OWNER' ? (
      <OwnerBusinessHome
        onOpen={(path) => push(path)}
        onListBusiness={() => push('/create-business')}
        onOpenOrder={(id) => push(`/order/${id}`)}
        onOpenBooking={(id) => push(`/booking/${id}`)}
      />
    ) : (
      profileAuthScreen
    );
  } else if (route.name === 'owner-screen') {
    content = session && session.user.role === 'BUSINESS_OWNER' ? (
      <OwnerScreen screen={route.screen} businessId={route.businessId} onBack={() => push('/owner')} />
    ) : (
      profileAuthScreen
    );
  } else if (route.name === 'create-business') {
    // Owner-only self-service onboarding; the backend enforces the role again.
    content =
      session && session.user.role === 'BUSINESS_OWNER' ? (
        <CreateBusinessScreen
          onBack={back}
          onCreated={(_id, name, status) => {
            setJustCreatedName(name);
            setJustCreatedStatus(status ?? null);
            push(`/owner?created=${encodeURIComponent(name)}${status ? `&status=${encodeURIComponent(status)}` : ''}`);
          }}
        />
      ) : (
        profileAuthScreen
      );
  } else if (businessMode && route.name === 'tabs') {
    // BUSINESS MODE: its own tab set and screens. Customer navigation and
    // customer-only content (Home, Explore, My Orders, My Bookings) never
    // render here.
    if (businessTab === 'Overview') {
      content = (
        <OwnerBusinessHome
          onOpen={(path) => push(path)}
          onListBusiness={() => push('/create-business')}
          onOpenOrder={(id) => push(`/order/${id}`)}
          onOpenBooking={(id) => push(`/booking/${id}`)}
        />
      );
    } else if (businessTab === 'Orders') {
      content = <OwnerBusinessOrders onListBusiness={() => push('/create-business')} />;
    } else if (businessTab === 'Bookings') {
      content = (
        <OwnerBusinessBookings
          onOpenBooking={(id) => push(`/booking/${id}`)}
          onListBusiness={() => push('/create-business')}
        />
      );
    } else if (businessTab === 'Earnings') {
      content = <OwnerEarnings onListBusiness={() => push('/create-business')} />;
    } else {
      content = (
        <OwnerBusinessProfile
          onOpenDashboard={() => push('/owner')}
          onEditProfile={() => push('/edit-profile')}
          onChangePassword={() => push('/change-password')}
          onOpenNotifications={() => push('/notifications')}
          onSwitchToCustomer={switchToCustomer}
          onListBusiness={() => push('/create-business')}
        />
      );
    }
  } else if (tab === 'Home') {
    content = (
      <HomeScreen
        onSearch={(query) => goExplore({ query })}
        onOpenBusiness={openBusiness}
        onExploreCategory={(category) => goExplore({ category })}
        onSeeAllCategories={() => goExplore({})}
      />
    );
  } else if (tab === 'Explore') {
    content = <ExploreScreen key={exploreSeed.nonce} initialCategory={exploreSeed.category} initialQuery={exploreSeed.query} onOpenBusiness={openBusiness} />;
  } else if (tab === 'Orders') {
    // Customer mode only: the person's own placed orders, whatever their role.
    content = session ? (
      <OrdersScreen
        onOpenOrder={(id) => push(`/order/${id}`)}
        onBrowse={() => {
          setTab('Explore');
          push('/');
        }}
      />
    ) : (
      <div className="screen">
        <EmptyState
          icon={<OrdersIcon size={30} />}
          title="Your orders"
          body="Sign in to place orders and track them here."
        />
      </div>
    );
  } else if (tab === 'Bookings') {
    content = session ? (
      <BookingsScreen
        onOpenBooking={(id) => push(`/booking/${id}`)}
        onExplore={() => {
          setTab('Explore');
          push('/');
        }}
      />
    ) : null;
  } else {
    content = session ? profileHubScreen : profileAuthScreen;
  }

  // Authentication is its own flow: when a signed-out user reaches an
  // authenticated destination (booking flow, booking detail, Bookings or
  // Profile tab) they only see the auth screen — no app chrome. The original
  // route/tab stays active, so after sign-in they land where they intended.
  const authFlow =
    !session &&
    ((route.name === 'tabs' && (tab === 'Profile' || tab === 'Bookings')) ||
      route.name === 'book' ||
      route.name === 'booking' ||
      route.name === 'notifications');
  if (authFlow && content === null) content = session ? profileHubScreen : profileAuthScreen;

  return (
    <main className={authFlow ? 'auth-mode' : undefined}>
      {!authFlow ? (
        <header className="app-header">
          <button className="logo" onClick={() => { setTab('Home'); setBusinessTab('Overview'); push('/'); }} aria-label="NearbyOrders home">
            NearbyOrders
          </button>
          {isOwner ? (
            <button
              className="header-link"
              onClick={() => {
                // Enters Business mode (idempotent) and shows the Overview.
                setAppMode('BUSINESS');
                setBusinessTab('Overview');
                push('/owner');
              }}
            >
              {businessMode ? 'Overview' : 'My business'}
            </button>
          ) : null}
          {session ? (
            <button
              type="button"
              className="bell-btn"
              onClick={() => push('/notifications')}
              aria-label={unread.count > 0 ? `Notifications, ${unread.count} unread` : 'Notifications'}
            >
              <BellIcon size={22} />
              {unread.count > 0 ? <span className="bell-badge">{unread.count > 99 ? '99+' : unread.count}</span> : null}
            </button>
          ) : null}
        </header>
      ) : null}
      {content}
      {!authFlow ? (
        businessMode ? (
          <nav aria-label="Business" className="business-nav">
            {businessTabs.map((t) => {
              const active = t === businessTab && route.name === 'tabs';
              const IconCmp =
                t === 'Overview' ? HomeIcon : t === 'Orders' ? OrdersIcon : t === 'Bookings' ? BookingsIcon : t === 'Earnings' ? StoreIcon : ProfileIcon;
              return (
                <button
                  key={t}
                  className={active ? 'nav-item active' : 'nav-item'}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    setBusinessTab(t);
                    push('/');
                  }}
                >
                  <IconCmp size={22} />
                  <span>{t}</span>
                </button>
              );
            })}
          </nav>
        ) : (
          <nav aria-label="Primary">
            {navigationTabs.map((t) => {
              const active = t === tab && route.name === 'tabs';
              const IconCmp =
                t === 'Home' ? HomeIcon : t === 'Explore' ? ExploreIcon : t === 'Orders' ? OrdersIcon : t === 'Bookings' ? BookingsIcon : ProfileIcon;
              return (
                <button
                  key={t}
                  className={active ? 'nav-item active' : 'nav-item'}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    setTab(t);
                    push('/');
                  }}
                >
                  <IconCmp size={22} />
                  <span>{t}</span>
                </button>
              );
            })}
          </nav>
        )
      ) : null}
    </main>
  );
}

const mountPoint = document.getElementById('root');
if (mountPoint) createRoot(mountPoint).render(<App />);
