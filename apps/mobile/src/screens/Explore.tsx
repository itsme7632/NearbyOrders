import { useState } from 'react';
import { listBusinesses, listCategories, type Business, type Category } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { BusinessCard, EmptyState, ErrorState, Loading } from '../components/ui.js';
import { ExploreIcon } from '../components/icons.js';

export function ExploreScreen(props: {
  initialCategory?: string;
  initialQuery?: string;
  onOpenBusiness: (id: string) => void;
}) {
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(props.initialCategory);
  const [query, setQuery] = useState(props.initialQuery ?? '');

  const categories = useAsyncData<Category[]>(() => listCategories(), []);
  const businesses = useAsyncData<Business[]>(
    () => listBusinesses({ q: query || undefined, category: selectedCategory }),
    [query, selectedCategory],
  );

  return (
    <div className="screen">
      <form
        className="search-row"
        onSubmit={(e) => {
          e.preventDefault();
          // state change above already re-triggers the query via useAsyncData deps
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search businesses or services"
          aria-label="Search businesses"
        />
      </form>

      <section aria-label="Category filters">
        {categories.loading ? (
          <Loading label="Loading filters…" />
        ) : categories.error ? (
          <ErrorState message={categories.error} onRetry={categories.reload} />
        ) : (
          <div className="filter-row">
            <button className={`chip${!selectedCategory ? ' chip-active' : ''}`} onClick={() => setSelectedCategory(undefined)}>
              All
            </button>
            {categories.data?.map((c) => (
              <button
                key={c.id}
                className={`chip${selectedCategory === c.slug ? ' chip-active' : ''}`}
                onClick={() => setSelectedCategory(selectedCategory === c.slug ? undefined : c.slug)}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Results">
        <div className="section-head">
          <h2>{selectedCategory ? categories.data?.find((c) => c.slug === selectedCategory)?.name ?? 'Results' : 'All nearby'}</h2>
        </div>
        {businesses.loading ? (
          <Loading label="Searching…" />
        ) : businesses.error ? (
          <ErrorState message={businesses.error} onRetry={businesses.reload} />
        ) : !businesses.data?.length ? (
          <EmptyState icon={<ExploreIcon size={30} />} title="Nothing found" body="Try a different search term or category filter." />
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
