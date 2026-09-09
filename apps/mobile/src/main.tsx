import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { navigationTabs, type Tab } from './navigation.js';
import { getSession, onSessionChange, type Session } from './api.js';
import { useRoute } from './hooks.js';
import { BookingsIcon, ExploreIcon, HomeIcon, OrdersIcon, ProfileIcon } from './components/icons.js';
import { EmptyState } from './components/ui.js';
import { HomeScreen } from './screens/Home.js';
import { ExploreScreen } from './screens/Explore.js';
import { BusinessDetailScreen } from './screens/BusinessDetail.js';
import { ProfileScreen } from './screens/Profile.js';
import { OwnerDashboardScreen } from './screens/OwnerDashboard.js';

function App() {
  const [tab, setTab] = useState<Tab>('Home');
  const [route, push, back] = useRoute();
  const [session, setSession] = useState<Session | null>(getSession());
  const [exploreSeed, setExploreSeed] = useState<{ category?: string; query?: string; nonce: number }>({ nonce: 0 });
  useEffect(() => onSessionChange(setSession), []);

  const openBusiness = (id: string) => push(`/business/${id}`);

  const goExplore = (seed: { category?: string; query?: string }) => {
    setTab('Explore');
    setExploreSeed((prev) => ({ ...seed, nonce: prev.nonce + 1 }));
    push('/');
  };

  let content: React.ReactNode;
  if (route.name === 'business') {
    content = <BusinessDetailScreen idOrSlug={route.idOrSlug} onBack={back} />;
  } else if (route.name === 'owner-dashboard') {
    content = session ? <OwnerDashboardScreen onBack={back} /> : <ProfileScreen onOwnerDashboard={() => push('/owner')} />;
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
    content = (
      <div className="screen">
        <EmptyState
          icon={<OrdersIcon size={30} />}
          title="No orders yet"
          body={
            session
              ? 'Your orders will appear here once ordering launches.'
              : 'Sign in to see your orders once ordering launches.'
          }
        />
      </div>
    );
  } else if (tab === 'Bookings') {
    content = (
      <div className="screen">
        <EmptyState
          icon={<BookingsIcon size={30} />}
          title="No bookings yet"
          body={
            session
              ? 'Your upcoming bookings will appear here once scheduling launches.'
              : 'Sign in to see your bookings once scheduling launches.'
          }
        />
      </div>
    );
  } else {
    content = <ProfileScreen onOwnerDashboard={() => push('/owner')} />;
  }

  // Authentication is its own flow: signed-out users only see the auth screen
  // (no app header, no primary navigation). Everything else keeps the chrome.
  const authFlow = !session && route.name === 'tabs' && tab === 'Profile';

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

createRoot(document.getElementById('root')!).render(<App />);
