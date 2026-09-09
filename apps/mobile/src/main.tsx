import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { navigationTabs, type Tab } from './navigation.js';
import { getSession, onSessionChange, type Session } from './api.js';
import { useRoute } from './hooks.js';
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
        <div className="empty-state">
          <div className="empty-icon" aria-hidden>🧾</div>
          <h3>Orders</h3>
          <p>{session ? 'Your orders will appear here once ordering launches.' : 'Sign in to see your orders.'}</p>
        </div>
      </div>
    );
  } else if (tab === 'Bookings') {
    content = (
      <div className="screen">
        <div className="empty-state">
          <div className="empty-icon" aria-hidden>📅</div>
          <h3>Bookings</h3>
          <p>{session ? 'Your bookings will appear here once scheduling launches.' : 'Sign in to see your bookings.'}</p>
        </div>
      </div>
    );
  } else {
    content = <ProfileScreen onOwnerDashboard={() => push('/owner')} />;
  }

  return (
    <main>
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
      {content}
      <nav aria-label="Primary">
        {navigationTabs.map((t) => (
          <button
            key={t}
            className={t === tab && route.name === 'tabs' ? 'active' : ''}
            onClick={() => {
              setTab(t);
              push('/');
            }}
          >
            {t}
          </button>
        ))}
      </nav>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
