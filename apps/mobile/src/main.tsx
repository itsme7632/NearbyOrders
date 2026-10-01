import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { businessTabs, navigationTabs, resolveTab, type BusinessTab, type Tab } from './navigation.js';
import { getMyBusinesses, getMyBusinessesWithEntitlement, getSession, onSessionChange, bootstrapSession, resolveImageUrl, type Business, type Session } from './api.js';
import { useRoute, useAsyncData } from './hooks.js';
import { applyDefaultModeForSession, initModeSessionSync, setAppMode, useAppMode } from './mode.js';
import { BellIcon, ExploreIcon, HomeIcon, OrdersIcon, BookingsIcon, NearbyOrdersMark, ProfileIcon, StoreIcon } from './components/icons.js';
import { Loading } from './components/ui.js';
import { RemoteImage } from './components/RemoteImage.js';
import { ToastProvider } from './components/primitives.js';
import { HomeScreen } from './screens/Home.js';
import { ExploreScreen } from './screens/Explore.js';
import { SearchScreen } from './screens/Search.js';
import { BusinessDetailScreen } from './screens/BusinessDetail.js';
import { BookServiceScreen } from './screens/BookService.js';
import { BookingDetailScreen, BookingsScreen } from './screens/Bookings.js';
import { ProfileScreen, EditProfileScreen, ChangePasswordScreen } from './screens/Profile.js';
// (OwnerDashboardScreen intentionally not imported: /owner renders OwnerBusinessHome.)
import { OwnerScreen } from './screens/OwnerScreen.js';
import { OwnerBookingDetailScreen } from './screens/OwnerBookings.js';
import { OwnerBusinessHome } from './screens/OwnerBusinessHome.js';
import { OwnerBusinessOrders } from './screens/OwnerBusinessOrders.js';
import { OwnerBusinessBookings } from './screens/OwnerBusinessBookings.js';
import { OwnerEarnings } from './screens/OwnerEarnings.js';
import { OwnerBusinessProfile } from './screens/OwnerBusinessProfile.js';
import { CreateBusinessScreen } from './screens/CreateBusiness.js';
import { CartScreen } from './screens/Cart.js';
import { OrderDetailScreen, OrdersScreen } from './screens/Orders.js';
import { CartPill } from './components/CartPill.js';
import { NotificationsScreen } from './screens/Notifications.js';
import { NotificationPreferencesScreen } from './screens/NotificationPreferences.js';
import {
  SavedBusinessesScreen,
  MyReviewsScreen,
  AddressesScreen,
  HelpScreen,
  TermsScreen,
  PrivacyScreen,
  AboutScreen,
} from './screens/customer-experience.js';
import { useUnreadNotifications } from './useUnreadNotifications.js';
import { usePushRegistration } from './usePushRegistration.js';
import { applyNativeStatusBarInset } from './statusBar.js';
import { initAndroidBackNavigation } from './androidBack.js';

initModeSessionSync();

// Android system back-button handling: overlays dismiss first, then WebView
// history goes back, then the tab root, and only at the genuine root with no
// history does the app background. Central, route-agnostic, no-op on web/iOS.
initAndroidBackNavigation();

// Android status-bar guarantee: measure the real native inset (WindowInsets)
// as early as possible so `--native-statusbar-height` is available to the
// `--sat` CSS token before first paint. Fire-and-forget and non-fatal by
// design — web/iOS skip it, and the env() fallbacks still apply.
void applyNativeStatusBarInset();

/**
 * Edge-to-edge scroll clipping boundary: fixed opaque gutter covering
 * exactly the Android status-bar region (0..--sat). Scrolled content slides
 * underneath it instead of rendering behind the system status bar.
 * position: fixed takes no layout space, so at-rest spacing is untouched.
 * See .statusbar-gutter in styles.css. Rendered once per app-root branch —
 * the bootstrap gate and the main tree are mutually exclusive, so exactly
 * one gutter is ever in the DOM.
 */
function StatusbarGutter() {
  return <div className="statusbar-gutter" aria-hidden="true" />;
}

/**
 * Business-mode app header, rendered once at the shell level: NearbyOrders
 * wordmark, the Owner mode badge, the notifications bell (same unread-badge
 * behavior as the customer header), and the business avatar. There is no
 * business context at shell level, so the avatar lands on the business
 * Profile tab — the identity hub for the owner's businesses.
 */
function OwnerAppHeader(props: {
  onHome: () => void;
  onNotifications: () => void;
  onAvatar: () => void;
  unreadCount: number;
}) {
  // First owned business only, for the avatar; errors stay silent — the
  // header never breaks on a failed side fetch.
  const businesses = useAsyncData<Business[]>(() => getMyBusinesses().catch(() => []), []);
  const first = businesses.data?.[0] ?? null;
  const initial = first?.name?.[0]?.toUpperCase() ?? null;
  return (
    <header className="app-header owner-app-header">
      <button className="logo" onClick={props.onHome} aria-label="NearbyOrders business overview">
        <span className="brand-mark" aria-hidden>
          <NearbyOrdersMark size={30} />
        </span>
        <span className="logo-word">
          Nearby<b>Orders</b>
        </span>
      </button>
      <span className="owner-mode-badge">Owner</span>
      <span className="header-spacer" aria-hidden />
      <button
        type="button"
        className="bell-btn"
        onClick={props.onNotifications}
        aria-label={props.unreadCount > 0 ? `Notifications, ${props.unreadCount} unread` : 'Notifications'}
      >
        <BellIcon size={21} />
        {props.unreadCount > 0 ? (
          <span className="bell-badge">{props.unreadCount > 99 ? '99+' : props.unreadCount}</span>
        ) : null}
      </button>
      <button
        type="button"
        className="owner-header-avatar"
        aria-label={first ? `${first.name} business profile` : 'Business profile'}
        onClick={props.onAvatar}
      >
        {first?.imageUrl ? (
          <RemoteImage src={resolveImageUrl(first.imageUrl) ?? undefined} alt="" loading="eager" />
        ) : initial ? (
          <span aria-hidden>{initial}</span>
        ) : (
          <StoreIcon size={20} />
        )}
      </button>
    </header>
  );
}

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

  // Persistent login: on startup, a securely stored refresh token is
  // exchanged for a fresh session (POST /auth/refresh, then GET /auth/me).
  // Expired/revoked tokens are cleared and the login screen shows instead.
  // The app renders nothing else until this resolves — no session, no fetch
  // that could act on a stale identity.
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    bootstrapSession()
      .catch(() => false)
      .then(() => {
        if (!cancelled) setAuthReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Session bootstrap: each new session resolves its default mode (does this
  // owner still own businesses?) before any mode-sensitive content paints, so
  // an owner logging in never glimpses the customer home before their
  // business dashboard appears. Customers resolve instantly (no fetch).
  const [modeResolvedFor, setModeResolvedFor] = useState<string | null | 'pending'>(() => (getSession() ? 'pending' : null));
  useEffect(() => {
    if (!session) {
      setModeResolvedFor(null);
      return;
    }
    if (modeResolvedFor === session.user.id) return;
    applyDefaultModeForSession(session).then(() => setModeResolvedFor(session.user.id));
  }, [session, modeResolvedFor]);
  const bootstrapping = session !== null && modeResolvedFor !== session.user.id;  const isOwner = session?.user.role === 'BUSINESS_OWNER';
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
        setTab(resolveTab('Orders'));
        push('/');
      }}
      onOpenBookings={() => {
        setTab(resolveTab('Bookings'));
        push('/');
      }}
      onOpenNotifications={() => push('/notifications')}
      onOpenSaved={() => push('/saved-businesses')}
      onOpenMyReviews={() => push('/my-reviews')}
      onOpenAddresses={() => push('/addresses')}
      onOpenInfo={(page) => push(`/info/${page}`)}
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
        setTab(resolveTab('Orders'));
        push('/');
      }}
      onOpenBookings={() => {
        setTab(resolveTab('Bookings'));
        push('/');
      }}
      onOpenNotifications={() => push('/notifications')}
      onOpenSaved={() => push('/saved-businesses')}
      onOpenMyReviews={() => push('/my-reviews')}
      onOpenAddresses={() => push('/addresses')}
      onOpenInfo={(page) => push(`/info/${page}`)}
    />
  );

  // Phase 5: unread badge on the header bell. Refreshes on app open, window
  // focus, session changes, and explicitly after read-state mutations.
  const unread = useUnreadNotifications();

  /** Deep link for a notification: entity detail, or a safe fallback when the target no longer exists. */
  const openNotification = (n: { entityType: 'Booking' | 'Order' | string; entityId: string }) => {
    if (n.entityType === 'Booking') {
      setTab(resolveTab('Bookings'));
      push(`/booking/${n.entityId}`);
    } else if (n.entityType === 'Order') {
      if (mode === 'BUSINESS') {
        // Owner notifications must never open the customer order-detail
        // surface. The business board is scoped to owned businesses.
        push('/owner');
      } else {
        setTab(resolveTab('Orders'));
        push(`/order/${n.entityId}`);
      }
    } else if (n.entityType === 'Review') {
      setAppMode('BUSINESS');
      push('/owner');
    } else {
      push('/notifications');
    }
  };

  /** Phase 13: native push registration + tap deep links (optional, silent on failure). */
  const handlePushDeepLink = useCallback(
    (link: string) => {
      // Only known-safe route shapes from the server's own deepLinkFor();
      // anything else falls back to the notifications list.
      if (link.startsWith('/booking/')) {
        setTab(resolveTab('Bookings'));
        push(link);
      } else if (link.startsWith('/order/')) {
        if (mode === 'BUSINESS') {
          push('/owner');
        } else {
          setTab(resolveTab('Orders'));
          push(link);
        }
      } else if (link.startsWith('/business/')) {
        setAppMode('BUSINESS');
        push('/owner');
      } else if (link === '/owner/subscription') {
        setAppMode('BUSINESS');
        push('/owner');
      } else {
        push('/notifications');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  usePushRegistration(handlePushDeepLink);

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
  if (bootstrapping) {
    // Neutral placeholder while a fresh session's default mode resolves; all
    // hooks above have already run, so hook order stays stable.
    content = <Loading label="Loading NearbyOrders…" />;
  } else if (route.name === 'business') {
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
        onAddAddress={() => push('/addresses')}
        onPlaced={() => {
          setTab(resolveTab('Orders'));
          push('/');
        }}
      />
    ) : null;
  } else if (route.name === 'order') {
    // Both roles open order detail here: a customer sees their order; the
    // owning business is authorized server-side for the same endpoint.
    content = session ? <OrderDetailScreen orderId={route.orderId} onBack={back} /> : null;
  } else if (route.name === 'search') {
    content = <SearchScreen initialQuery={route.initialQuery} onBack={back} onOpenBusiness={openBusiness} />;
  } else if (route.name === 'notifications') {
    content = session ? (
      <NotificationsScreen
        onOpenNotification={openNotification}
        onReadStateChange={unread.refresh}
        onOpenPreferences={() => push('/notification-preferences')}
      />
    ) : null;
  } else if (route.name === 'notification-preferences') {
    content = session ? <NotificationPreferencesScreen onBack={back} /> : null;
  } else if (route.name === 'edit-profile') {
    content = session ? <EditProfileScreen onBack={back} onSaved={unread.refresh} /> : null;
  } else if (route.name === 'change-password') {
    content = session ? <ChangePasswordScreen onBack={back} /> : null;
  } else if (route.name === 'saved-businesses') {
    content = session ? <SavedBusinessesScreen onBack={back} onOpenBusiness={openBusiness} /> : null;
  } else if (route.name === 'my-reviews') {
    content = session ? <MyReviewsScreen onBack={back} onOpenBusiness={openBusiness} /> : null;
  } else if (route.name === 'addresses') {
    content = session ? <AddressesScreen onBack={back} /> : null;
  } else if (route.name === 'info') {
    content =
      route.page === 'help' ? <HelpScreen onBack={back} /> : route.page === 'terms' ? <TermsScreen onBack={back} /> : route.page === 'privacy' ? <PrivacyScreen onBack={back} /> : <AboutScreen onBack={back} />;
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
          setTab(resolveTab('Bookings'));
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
        justCreatedName={route.justCreatedName ?? null}
        justCreatedStatus={route.justCreatedStatus ?? null}
      />
    ) : (
      profileAuthScreen
    );
  } else if (route.name === 'owner-screen') {
    content = session && session.user.role === 'BUSINESS_OWNER' ? (
      <OwnerScreen
        screen={route.screen}
        businessId={route.businessId}
        onBack={() => push('/owner')}
        onOpen={(path) => push(path)}
        onOpenBooking={(id) => push(`/booking/${id}`)}
      />
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
          // P3: the limit notice's Upgrade action routes into the existing
          // plan/subscription flow for the owner's first business.
          onUpgrade={() => {
            void getMyBusinessesWithEntitlement()
              .then(({ businesses: owned }) => {
                const first = owned[0];
                push(first ? `/owner/${first.id}/subscription` : '/owner');
              })
              .catch(() => push('/owner'));
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
          onOpenBusinessScreen={(businessId, screen) => push(`/owner/${businessId}/${screen}`)}
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
        onOpenSearch={() => push('/search')}
        onOpenBusiness={openBusiness}
        onOpenOrder={(id) => push(`/order/${id}`)}
        onOpenBooking={(id) => push(`/booking/${id}`)}
        onExploreCategory={(category) => goExplore({ category })}
        onSeeAllCategories={() => goExplore({})}
      />
    );
  } else if (tab === 'Explore') {
    content = (
      <ExploreScreen
        key={exploreSeed.nonce}
        initialCategory={exploreSeed.category}
        initialQuery={exploreSeed.query}
        onOpenBusiness={openBusiness}
        onOpenSearch={(q) => push(`/search?q=${encodeURIComponent(q)}`)}
      />
    );
  } else if (tab === 'Orders') {
    // Locked navigation: the customer's order history is its own tab.
    content = session ? (
      <OrdersScreen
        onOpenOrder={(id) => push(`/order/${id}`)}
        onBrowse={() => {
          setTab('Explore');
          push('/');
        }}
      />
    ) : (
      profileAuthScreen
    );
  } else if (tab === 'Bookings') {
    // Locked navigation: the customer's bookings are their own tab.
    content = session ? (
      <BookingsScreen
        onOpenBooking={(id) => push(`/booking/${id}`)}
        onExplore={() => {
          setTab('Explore');
          push('/');
        }}
      />
    ) : (
      profileAuthScreen
    );
  } else if (tab === 'Profile') {
    content = session ? profileHubScreen : profileAuthScreen;
  } else {
    // Legacy Warm Proximity values ('Activity', 'Saved', 'Account') resolve
    // through resolveTab() at the tab-state boundaries; anything else falls
    // back to the Profile hub, which keeps Saved, notifications, addresses,
    // reviews and settings reachable.
    content = session ? profileHubScreen : profileAuthScreen;
  }

  // Authentication is its own flow: when a signed-out user reaches an
  // authenticated destination (booking flow, booking detail, Bookings or
  // Profile tab) they only see the auth screen — no app chrome. The original
  // route/tab stays active, so after sign-in they land where they intended.
  const authFlow =
    !session &&
    ((route.name === 'tabs' && tab === 'Profile') ||
      route.name === 'book' ||
      route.name === 'booking' ||
      route.name === 'notifications');
  if (authFlow && content === null) content = session ? profileHubScreen : profileAuthScreen;

  // Session restore gate: nothing else renders until the refresh-token
  // exchange has resolved, so the app never paints on a stale identity.
  // The status-bar gutter stays mounted — the Android inset guarantee is
  // structural, not content-dependent.
  if (!authReady) {
    return (
      <main>
        <StatusbarGutter />
        <div className="screen">
          <Loading label="Signing you in…" />
        </div>
      </main>
    );
  }

  return (
    <ToastProvider>
    <main className={authFlow ? 'auth-mode' : undefined}>
      <StatusbarGutter />
      {/* Phase 3I: keyboard / screen-reader users can jump past the header. */}
      {/* Skip link: jumps keyboard users past the header/nav to the main
          content. tabIndex={-1} lets the target receive programmatic focus so
          screen readers announce it reliably after activation. */}
      <a href="#app-content" className="skip-link">
        Skip to content
      </a>
      {!authFlow ? (
        businessMode ? (
          // Business mode renders ONE dedicated owner app header at shell
          // level (owner screens never render their own app header).
          <OwnerAppHeader
            onHome={() => {
              setBusinessTab('Overview');
              push('/');
            }}
            onNotifications={() => push('/notifications')}
            onAvatar={() => {
              setBusinessTab('Profile');
              push('/');
            }}
            unreadCount={unread.count}
          />
        ) : (
          <header className="app-header">
            <button className="logo" onClick={() => { setTab('Home'); setBusinessTab('Overview'); push('/'); }} aria-label="NearbyOrders home">
              <span className="brand-mark" aria-hidden>
                <NearbyOrdersMark size={30} />
              </span>
              <span className="logo-word">
                Nearby<b>Orders</b>
              </span>
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
            <span className="header-spacer" aria-hidden />
            {session ? (
              <button
                type="button"
                className="bell-btn"
                onClick={() => push('/notifications')}
                aria-label={unread.count > 0 ? `Notifications, ${unread.count} unread` : 'Notifications'}
              >
                <BellIcon size={21} />
                {unread.count > 0 ? <span className="bell-badge">{unread.count > 99 ? '99+' : unread.count}</span> : null}
              </button>
            ) : null}
          </header>
        )
      ) : null}
      <div id="app-content" tabIndex={-1}>{content}</div>
      {/* Phase 3J floating-action hierarchy (mutually exclusive by route):
          - Tab routes: CartPill only (hidden when the cart is empty).
          - Business route: BusinessDetail's own sticky CTA bar only.
          They can never overlap: CartPill mounts only for route.name ===
          'tabs', while Business Detail renders under route.name ===
          'business'. Both sit above the bottom nav via safe-area-aware
          bottom offsets. */}
      {!authFlow && !businessMode && route.name === 'tabs' ? <CartPill onViewCart={() => push('/cart')} /> : null}
      {!authFlow ? (
        businessMode ? (
          <nav aria-label="Business" className="business-nav business-nav-v3">
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
                  <IconCmp size={21} />
                  <span>{t}</span>
                </button>
              );
            })}
          </nav>
        ) : (
          <nav aria-label="Primary" className="nav-v3">
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
                  <IconCmp size={21} />
                  <span>{t}</span>
                </button>
              );
            })}
          </nav>
        )
      ) : null}
    </main>
    </ToastProvider>
  );
}

const mountPoint = document.getElementById('root');
if (mountPoint) createRoot(mountPoint).render(<App />);
