import { useEffect, useState } from 'react';
import type { FavoriteEntry } from '../api.js';
import { BusinessRow, Button, EmptyState } from '../components/ui.js';
import { Sheet } from '../components/primitives.js';
import { ChevronRightIcon } from '../components/icons.js';
import {
  businessesInCollection,
  collectionCounts,
  collectionIdsForBusiness,
  createCollection,
  deleteCollection,
  listCollections,
  toggleBusinessInCollection,
  MAX_COLLECTION_NAME,
  type SavedCollection,
} from '../saved-collections.js';
import { favoriteToBusiness } from '../saved-collections.js';

/** Small "shelves" glyph for the organize action. */
function ShelvesIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <path d="M4 5h16" />
      <path d="M4 12h16" />
      <path d="M4 19h10" />
    </svg>
  );
}

export type NotifyFn = (kind: 'success' | 'error' | 'info', message: string) => void;

/* ------------------------------------------------------------------ */
/* New collection form (inline, used inside sheets)                     */
/* ------------------------------------------------------------------ */

export function NewCollectionForm(props: { userId: string; onCreated: (c: SavedCollection) => void; notify: NotifyFn; autoFocus?: boolean }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const canSubmit = name.trim().length > 0 && !busy;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const c = createCollection(props.userId, name);
      setName('');
      props.onCreated(c);
      props.notify('success', `Collection “${c.name}” created`);
    } catch (err) {
      props.notify('error', err instanceof Error ? err.message : 'Could not create the collection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Food, Services, Places to try"
        aria-label="Collection name"
        maxLength={MAX_COLLECTION_NAME}
        autoFocus={props.autoFocus}
        style={{ flex: 1 }}
      />
      <Button type="submit" sm disabled={!canSubmit}>
        {busy ? 'Creating…' : 'Create'}
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Move-to-collection sheet                                             */
/* ------------------------------------------------------------------ */

export function MoveToCollectionSheet(props: {
  userId: string;
  business: FavoriteEntry['business'] | null;
  onClose: () => void;
  onChanged: () => void;
  notify: NotifyFn;
}) {
  const { business } = props;
  const [tick, setTick] = useState(0);
  const [showNew, setShowNew] = useState(false);
  // Re-read from storage on every render tick so toggles stay truthful.
  void tick;
  const collections = business ? listCollections(props.userId) : [];
  const memberOf = business ? new Set(collectionIdsForBusiness(props.userId, business.id)) : new Set<string>();

  const toggle = (c: SavedCollection) => {
    if (!business) return;
    try {
      const nowIn = toggleBusinessInCollection(props.userId, c.id, business.id);
      props.notify('success', nowIn ? `Moved to “${c.name}”` : `Removed from “${c.name}”`);
      setTick((t) => t + 1);
      props.onChanged();
    } catch {
      props.notify('error', 'Could not update the collection.');
    }
  };

  return (
    <Sheet open={business !== null} onClose={props.onClose} title="File in a collection" subtitle={business?.name}>
      {collections.length === 0 && !showNew ? (
        <EmptyState
          icon={<ShelvesIcon size={28} />}
          title="No collections yet"
          body="Collections are little shelves for your saved businesses: Food, Services, Places to try."
        />
      ) : (
        <ul className="collection-pick-list" style={{ listStyle: 'none', margin: '0 0 12px', padding: 0, display: 'grid', gap: 8 }}>
          {collections.map((c) => {
            const active = memberOf.has(c.id);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className={`collection-pick${active ? ' collection-pick-on' : ''}`}
                  aria-pressed={active}
                  onClick={() => toggle(c)}
                >
                  <span className="collection-pick-box" aria-hidden>
                    {active ? '✓' : ''}
                  </span>
                  <span className="collection-pick-name">{c.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {showNew ? (
        <NewCollectionForm
          userId={props.userId}
          autoFocus
          notify={props.notify}
          onCreated={() => {
            setShowNew(false);
            setTick((t) => t + 1);
            props.onChanged();
          }}
        />
      ) : (
        <Button full variant="ghost" sm onClick={() => setShowNew(true)}>
          + New collection
        </Button>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Collections tab                                                     */
/* ------------------------------------------------------------------ */

export function CollectionsView(props: {
  userId: string;
  entries: FavoriteEntry[];
  onOpenBusiness: (id: string) => void;
  onRemove: (businessId: string) => void;
  onChanged: () => void;
  notify: NotifyFn;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  void tick;

  const refresh = () => {
    setTick((t) => t + 1);
    props.onChanged();
  };

  const collections = listCollections(props.userId);
  const counts = collectionCounts(props.userId);
  const byId = new Map(props.entries.map((e) => [e.business.id, e.business]));

  // If the open collection was deleted elsewhere, close it — in an effect,
  // never during render. The boolean dep keeps the effect stable even though
  // listCollections() returns a fresh array each render.
  const openExists = openId ? collections.some((c) => c.id === openId) : true;
  useEffect(() => {
    if (openId && !openExists) setOpenId(null);
  }, [openId, openExists]);

  if (openId) {
    const collection = collections.find((c) => c.id === openId);
    if (!collection) {
      return null;
    }
    const filed = businessesInCollection(props.userId, openId)
      .map((id) => byId.get(id))
      .filter((b): b is FavoriteEntry['business'] => Boolean(b));
    const deleting = confirmDelete === openId;

    const unfile = (businessId: string) => {
      try {
        toggleBusinessInCollection(props.userId, openId, businessId);
        props.notify('success', `Removed from “${collection.name}”`);
        refresh();
      } catch {
        props.notify('error', 'Could not update the collection.');
      }
    };

    const removeCollection = () => {
      if (!deleting) {
        setConfirmDelete(openId);
        return;
      }
      deleteCollection(props.userId, openId);
      props.notify('success', `Collection “${collection.name}” deleted`);
      setConfirmDelete(null);
      setOpenId(null);
      refresh();
    };

    return (
      <div>
        <button type="button" className="back-link" onClick={() => { setOpenId(null); setConfirmDelete(null); }}>
          ‹ All collections
        </button>
        <header className="owner-head saved-head">
          <div>
            <h1>{collection.name}</h1>
            <p className="saved-head-sub">{filed.length === 0 ? 'Empty shelf' : `${filed.length} saved`}</p>
          </div>
        </header>
        {filed.length === 0 ? (
          <EmptyState
            icon={<ShelvesIcon size={28} />}
            title="Nothing filed here yet"
            body={`Use “File in a collection” on any saved business to keep it on the “${collection.name}” shelf.`}
          />
        ) : (
          <ul className="fav-list">
            {filed.map((b) => (
              <li key={b.id} style={{ position: 'relative' }}>
                <BusinessRow business={favoriteToBusiness(b)} onOpen={() => props.onOpenBusiness(b.id)} />
                <button
                  type="button"
                  className="fav-heart"
                  aria-label={`Remove ${b.name} from ${collection.name}`}
                  title={`Remove from ${collection.name}`}
                  onClick={() => unfile(b.id)}
                  style={{
                    position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)',
                    width: 36, height: 36, borderRadius: '50%', background: 'var(--card)',
                    border: '1px solid var(--border)', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <ShelvesIcon size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ marginTop: 16 }}>
          <Button full variant={deleting ? 'danger' : 'ghost'} sm onClick={removeCollection}>
            {deleting ? 'Tap again to delete this collection' : 'Delete collection'}
          </Button>
          {deleting ? (
            <p className="hint" style={{ marginTop: 6 }}>
              The businesses stay in your Saved list. Only the “{collection.name}” shelf is removed.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div>
      {showNew ? (
        <div style={{ marginBottom: 12 }}>
          <NewCollectionForm
            userId={props.userId}
            autoFocus
            notify={props.notify}
            onCreated={() => {
              setShowNew(false);
              refresh();
            }}
          />
        </div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <Button full variant="secondary" sm onClick={() => setShowNew(true)}>
            + New collection
          </Button>
        </div>
      )}
      {collections.length === 0 ? (
        <EmptyState
          icon={<ShelvesIcon size={30} />}
          title="Shelves, not piles"
          body="Group the businesses you love into little collections (“Weekend food”, “Tailors to try”, “Family clinics”). Everything stays in your Saved list too."
        />
      ) : (
        <ul className="collection-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {collections.map((c) => (
            <li key={c.id}>
              <button type="button" className="collection-card" onClick={() => setOpenId(c.id)} aria-label={`Open collection ${c.name}, ${counts[c.id] ?? 0} businesses`}>
                <span className="collection-card-icon" aria-hidden>
                  <ShelvesIcon size={20} />
                </span>
                <span className="collection-card-main">
                  <span className="collection-card-name">{c.name}</span>
                  <span className="collection-card-meta">
                    {(counts[c.id] ?? 0) === 0 ? 'Empty shelf' : `${counts[c.id]} saved`}
                  </span>
                </span>
                <span className="collection-card-chevron" aria-hidden>
                  <ChevronRightIcon size={18} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
