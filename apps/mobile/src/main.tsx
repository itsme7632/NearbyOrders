import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { navigationTabs, type Tab } from './navigation.js';
import { getSession, onSessionChange, type Session } from './api.js';
import { useRoute } from './hooks.js';
import { BookingsIcon, ExploreIcon, HomeIcon, OrdersIcon, ProfileIcon } from './components/icons.js';
import { EmptyState, Loading } from './components/ui.js';
import { HomeScreen } from './screens/Home.js';
import { ExploreScreen } from './screens/Explore.js';
import { BusinessDetailScreen } from './screens/BusinessDetail.js';
import { BookServiceScreen } from './screens/BookService.js';
import { BookingsScreen, BookingDetailScreen } from './screens/Bookings.js';
import { OwnerBookingsScreen, OwnerBookingDetailScreen } from './screens/OwnerBookings.js';
import { ProfileScreen } from './screens/Profile.js';
import { OwnerDashboardScreen } from './screens/OwnerDashboard.js';
import { CreateBusinessScreen } from './screens/CreateBusiness.js';
import { CartScreen } from './screens/Cart.js';
import { OrdersScreen, OrderDetailScreen } from './screens/Orders.js';

function App() {
  const [tab, setTab] = useState<Tab>('Home');
  const [route, push, back] = useRoute();
  const [session, setSession] = useState<Session | null>(getSession());
  const [exploreSeed, setExploreSeed] = useState<{ category?: string; query?: string; nonce: number }>({ nonce: 0 });
  const [justCreatedName, setJustCreatedName] = useState<string | null>(null);
  const [justCreatedStatus, setJustCreatedStatus] = useState<string | null>(null);
  useEffect(() => onSessionChange(setSession), []);

  const openBusiness = (id: string) => push(`/business/${id}`);

  const openCart = () => push('/cart');

  const goExplore = (seed: { category?: string; query?: string }) => {
    setTab('Explore');
    setExploreSeed((prev) => ({ ...seed, nonce: prev.nonce + 1 }));
    push('/');
  };

  let content: React.ReactNode;
  if (route.name === 'business') {
    content = (
      <BusinessDetailScreen
        idOrSlug={route.idOrSlug}
        onBack={back}
        onBook={(serviceId) => push(`/book/${route.idOrSlug}${serviceId ? `/${serviceId}` : ''}`)}
        canOrder={session?.user.role === 'CUSTOMER'}
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
    content = session ? <OrderDetailScreen orderId={route.orderId} onBack={back} /> : null;
  } else if (route.name === 'book') {
    // The hash already carries the destination, so after sign-in this same
    // route renders the booking flow again — no separate return logic needed.
    content = session
      ? session.user.role === 'CUSTOMER'
        ? (
            <BookServiceScreen
              businessId={route.businessId}
              preselectedServiceId={route.serviceId}
              onBack={back}
              onDone={() => {
                setTab('Bookings');
                push('/');
              }}
            />
          )
        : (
            <div className="screen">
              <button className="back-link" onClick={back}>
                ‹ Back
              </button>
              <EmptyState
                icon={<BookingsIcon size={30} />}
                title="Booking is for customer accounts"
                body="This account is a business account, so it cannot book services. Use a customer account to book."
              />
            </div>
          )
      : null;
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
    content = session ? (
      <OwnerDashboardScreen
        onBack={back}
        onListBusiness={session.user.role === 'BUSINESS_OWNER' ? () => push('/create-business') : undefined}
        justCreatedName={route.justCreated ? route.justCreatedName : null}
        justCreatedStatus={route.justCreated ? route.justCreatedStatus ?? null : null}
      />
    ) : (
      <ProfileScreen onOwnerDashboard={() => push('/owner')} />
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
        <ProfileScreen onOwnerDashboard={() => push('/owner')} />
      );
  } else if (tab === 'Home') {
    content = (
      <HomeScreen
        onSearch={(query) => goExplore({ query })}
        onOpenBusiness={openBusiness}
        onExploreCategory={(category) => goExplore({ category })}
      />
    );
  } else if (tab === 'Explore') {
    content = <ExploreScreen key={exploreSeed.nonce} initialCategory={exploreSeed.category} initialQuery={exploreSeed.query} onOpenBusiness={openBusiness} />;
  } else if (tab === 'Orders') {
    content =
      session && session.user.role === 'CUSTOMER' ? (
        <OrdersScreen
          onOpenOrder={(id) => push(`/order/${id}`)}
          onBrowse={() => {
            setTab('Explore');
            push('/');
          }}
        />
      ) : session && session.user.role === 'BUSINESS_OWNER' ? (
        // Owners get incoming orders inside My business → Orders; the Orders
        // tab routes them there instead of a second dashboard.
        <OwnerOrdersRedirect onOwnerDashboard={() => push('/owner')} />
      ) : (
        <div className="screen">
          <EmptyState
            icon={<OrdersIcon size={30} />}
            title="Your orders"
            body="Sign in as a customer to place orders and track them here."
          />
        </div>
      );
  } else if (tab === 'Bookings') {
    content = session ? (
      session.user.role === 'BUSINESS_OWNER' ? (
        <OwnerBookingsScreen
          onOpenBooking={(id) => push(`/booking/${id}`)}
          onListBusiness={session.user.role === 'BUSINESS_OWNER' ? () => push('/create-business') : undefined}
        />
      ) : (
        <BookingsScreen
          onOpenBooking={(id) => push(`/booking/${id}`)}
          onExplore={() => {
            setTab('Explore');
            push('/');
          }}
        />
      )
    ) : null;
  } else {
    content = <ProfileScreen onOwnerDashboard={() => push('/owner')} />;
  }

  // Authentication is its own flow: when a signed-out user reaches an
  // authenticated destination (booking flow, booking detail, Bookings or
  // Profile tab) they only see the auth screen — no app chrome. The original
  // route/tab stays active, so after sign-in they land where they intended.
  const authFlow =
    !session &&
    ((route.name === 'tabs' && (tab === 'Profile' || tab === 'Bookings')) || route.name === 'book' || route.name === 'booking');
  if (authFlow && content === null) content = <ProfileScreen onOwnerDashboard={() => push('/owner')} />;

  return (
    <main className={authFlow ? 'auth-mode' : undefined}>
      {!authFlow ? (
        <header className="app-header">
          <button className="logo" onClick={() => { setTab('Home'); push('/'); }} aria-label="NearbyOrders home">
            NearbyOrders
          </button>
          {session?.user.role === 'BUSINESS_OWNER' ? (
            <button className="header-link" onClick={() => push('/owner')}>
              My business
            </button>
          ) : null}
        </header>
      ) : null}
      {content}
      {!authFlow ? (
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
      ) : null}
    </main>
  );
}

function OwnerOrdersRedirect(props: { onOwnerDashboard: () => void }) {
  useEffect(() => {
    props.onOwnerDashboard();
  });
  return <Loading label="Opening your business…" />;
}

createRoot(document.getElementById('root')!).render(<App />);
