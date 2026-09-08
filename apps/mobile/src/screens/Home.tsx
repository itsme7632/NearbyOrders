import { useState } from 'react';
import { listBusinesses, listCategories, type Business, type Category } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { BusinessCard, EmptyState, ErrorState, Loading } from '../components/ui.js';

export function HomeScreen(props: {
  onSearch: (q: string) => void;
  onOpenBusiness: (id: string) => void;
  onExploreCategory: (slug: string) => void;
}) {
  const [query, setQuery] = useState('');
  const categories = useAsyncData<Category[]>(() => listCategories(), []);
  const businesses = useAsyncData<Business[]>(() => listBusinesses({ q: '', limit: 20 }), []);

  return (
    <div className="screen">
      <section className="hero">
        <p>Find nearby. Book or order.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            props.onSearch(query);
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search nearby businesses"
            aria-label="Search businesses"
          />
        </form>
      </section>

      <section aria-label="Categories">
        <div className="section-head">
          <h2>Explore categories</h2>
        </div>
        {categories.loading ? (
          <Loading label="Loading categories…" />
        ) : categories.error ? (
          <ErrorState message={categories.error} onRetry={categories.reload} />
        ) : (
          <div className="category-grid">
            {categories.data?.map((c) => (
              <button key={c.id} className="category-chip" onClick={() => props.onExploreCategory(c.slug)}>
                {c.name}
              </button>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Businesses">
        <div className="section-head">
          <h2>Nearby businesses</h2>
        </div>
        {businesses.loading ? (
          <Loading label="Finding businesses…" />
        ) : businesses.error ? (
          <ErrorState message={businesses.error} onRetry={businesses.reload} />
        ) : !businesses.data?.length ? (
          <EmptyState
            icon="🏪"
            title="No businesses yet"
            body="Approved nearby businesses will appear here as they join NearbyOrders."
          />
        ) : (
          <div className="business-list">
            {businesses.data.map((b) => (
              <BusinessCard key={b.id} business={b} onOpen={() => props.onOpenBusiness(b.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
