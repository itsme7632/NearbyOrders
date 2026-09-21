import { useEffect, useState } from 'react';
import {
  listFavorites,
  saveFavorite,
  unsaveFavorite,
  getSession,
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  listMyReviews,
  type Business,
  type FavoriteEntry,
  type CustomerAddress,
  type MyReview,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { BusinessRow, Button, EmptyState, ErrorState, ListSkeleton } from '../components/ui.js';
import { HeartIcon } from '../components/icons.js';
import { SegmentedControl, useToast } from '../components/primitives.js';
import { favoriteToBusiness, pruneCollections } from '../saved-collections.js';
import {
  CollectionsView,
  MoveToCollectionSheet,
  type NotifyFn,
} from './SavedCollections.js';
import { PinDropPicker } from '../components/PinDropPicker.js';

/* ------------------------------------------------------------------ */
/* Shared screen scaffolding                                           */
/* ------------------------------------------------------------------ */

function ScreenHead(props: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <header className="owner-head saved-head">
      <div>
        <h1>{props.title}</h1>
        {props.sub ? <p className="saved-head-sub">{props.sub}</p> : null}
      </div>
      {props.children}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Saved (favorite) businesses                                         */
/* ------------------------------------------------------------------ */

export function SavedBusinessesScreen(props: { onBack: () => void; onOpenBusiness: (id: string) => void }) {
  const toast = useToast();
  const notify: NotifyFn = (kind, message) => {
    if (kind === 'success') toast.success(message);
    else if (kind === 'error') toast.error(message);
    else toast.info(message);
  };
  const saved = useAsyncData(() => listFavorites(), []);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Phase 3A: lightweight local-first collections over the same favorites.
  const [view, setView] = useState<'all' | 'collections'>('all');
  const [fileTarget, setFileTarget] = useState<FavoriteEntry['business'] | null>(null);
  const [shelfTick, setShelfTick] = useState(0);
  const userId = getSession()?.user.id ?? '';

  // Memberships referencing unsaved businesses are dropped whenever the
  // favorites list refreshes — an unsave silently leaves every collection.
  useEffect(() => {
    if (userId && saved.data) pruneCollections(userId, saved.data.map((e) => e.business.id));
  }, [userId, saved.data]);

  const remove = async (businessId: string) => {
    if (removingId) return;
    setRemovingId(businessId);
    try {
      await unsaveFavorite(businessId);
      toast.success('Removed from Saved');
      saved.reload();
    } catch {
      // The row stays in place; the user can retry the tap.
      toast.error('Could not remove from Saved. Please try again.');
    } finally {
      setRemovingId(null);
    }
  };

  if (saved.loading) return <ListSkeleton count={4} />;
  if (saved.error) return <ErrorState message={saved.error} onRetry={saved.reload} />;

  const entries = saved.data ?? [];
  if (!entries.length) {
    return (
      <div className="screen">
        <ScreenHead title="Saved businesses" />
        <EmptyState
          icon={<HeartIcon size={30} />}
          title="Nothing saved yet"
          body="Tap the heart on any business to keep it here for quick access — then file your favorites into little collections like “Weekend food” or “Places to try”."
          action={
            <Button variant="ghost" onClick={props.onBack}>
              Explore businesses
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="screen">
      <ScreenHead title="Saved businesses" sub={`${entries.length} saved`} />
      <SegmentedControl
        value={view}
        onChange={setView}
        label="Saved view"
        options={[
          { value: 'all', label: 'All saved' },
          { value: 'collections', label: 'Collections' },
        ]}
      />
      <div style={{ marginTop: 12 }}>
        {view === 'collections' ? (
          <CollectionsView
            userId={userId}
            entries={entries}
            onOpenBusiness={props.onOpenBusiness}
            onRemove={(id) => void remove(id)}
            onChanged={() => setShelfTick((t) => t + 1)}
            notify={notify}
          />
        ) : (
          <SavedList
            entries={entries}
            removingId={removingId}
            onOpenBusiness={props.onOpenBusiness}
            onRemove={(id) => void remove(id)}
            onFile={(b) => setFileTarget(b)}
            shelfTick={shelfTick}
            userId={userId}
          />
        )}
      </div>
      <MoveToCollectionSheet
        userId={userId}
        business={fileTarget}
        onClose={() => setFileTarget(null)}
        onChanged={() => setShelfTick((t) => t + 1)}
        notify={notify}
      />
    </div>
  );
}

/**
 * The "All saved" list: the same favorites rows as before, each with an
 * organize (shelf) action that files the business into local collections.
 */
function SavedList(props: {
  entries: FavoriteEntry[];
  removingId: string | null;
  onOpenBusiness: (id: string) => void;
  onRemove: (businessId: string) => void;
  onFile: (b: FavoriteEntry['business']) => void;
  shelfTick: number;
  userId: string;
}) {
  // Re-render shelf badges when collections change.
  void props.shelfTick;
  return (
    <ul className="fav-list">
      {props.entries.map(({ business }) => (
        // Same BusinessRow treatment as Explore/Search; the unsave heart
        // overlays the row's trailing edge as a separate action.
        <li key={business.id} style={{ position: 'relative' }}>
          <BusinessRow business={favoriteToBusiness(business)} onOpen={() => props.onOpenBusiness(business.id)} />
          <span className="fav-actions" role="group" aria-label={`Actions for ${business.name}`}>
            <button
              type="button"
              className="fav-action-btn"
              aria-label={`File ${business.name} in a collection`}
              title="File in a collection"
              onClick={() => props.onFile(business)}
            >
              <ShelvesGlyph />
            </button>
            <button
              type="button"
              className="fav-heart fav-action-btn"
              aria-label={`Remove ${business.name} from saved`}
              title="Remove from Saved"
              disabled={props.removingId === business.id}
              onClick={() => props.onRemove(business.id)}
              style={{ opacity: props.removingId === business.id ? 0.5 : 1 }}
            >
              <HeartIcon size={18} filled />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Compact shelf glyph for the per-row "file in a collection" action. */
function ShelvesGlyph({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <path d="M4 5h16" />
      <path d="M4 12h16" />
      <path d="M4 19h10" />
    </svg>
  );
}

/**
 * The favorites API returns a display subset of the business; adapt it to the
 * full Business shape BusinessRow expects. Canonical implementation lives in
 * saved-collections.ts (re-exported here so existing importers keep working).
 */
export { favoriteToBusiness } from '../saved-collections.js';

/* ------------------------------------------------------------------ */
/* My reviews                                                          */
/* ------------------------------------------------------------------ */

export function MyReviewsScreen(props: { onBack: () => void; onOpenBusiness: (id: string) => void }) {
  const reviews = useAsyncData(() => listMyReviews(), []);

  if (reviews.loading) return <ListSkeleton count={3} />;
  if (reviews.error) return <ErrorState message={reviews.error} onRetry={reviews.reload} />;

  const items = reviews.data ?? [];
  if (!items.length) {
    return (
      <div className="screen">
        <ScreenHead title="My reviews" />
        <EmptyState
          icon={<span aria-hidden>★</span>}
          title="No reviews yet"
          body="After a completed booking or order you can rate the business and it will show up here."
        />
        <Button full variant="ghost" onClick={props.onBack}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="screen">
      <ScreenHead title="My reviews" sub={`${items.length} written`} />
      <ul className="fav-list">
        {items.map((rv) => (
          <li key={rv.id}>
            <button type="button" className="fav-row" onClick={() => props.onOpenBusiness(rv.business.id)}>
              <span className="fav-thumb fav-thumb-empty" aria-hidden>
                ★
              </span>
              <span className="fav-row-text">
                <span className="fav-row-name">{rv.business.name}</span>
                <span className="fav-row-meta">
                  {'★'.repeat(rv.rating)}
                  {'☆'.repeat(5 - rv.rating)}
                  {' · '}
                  {new Date(rv.createdAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                {rv.comment ? <span className="fav-row-comment">{rv.comment}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Addresses                                                           */
/* ------------------------------------------------------------------ */

type AddressDraft = {
  label: string;
  recipientName: string;
  phone: string;
  addressText: string;
  latitude: number | null;
  longitude: number | null;
};

const EMPTY_DRAFT: AddressDraft = { label: '', recipientName: '', phone: '', addressText: '', latitude: null, longitude: null };

function AddressForm(props: {
  initial?: AddressDraft;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (draft: AddressDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<AddressDraft>(props.initial ?? EMPTY_DRAFT);
  const [showPin, setShowPin] = useState(
    () => (props.initial?.latitude ?? null) !== null || (props.initial?.longitude ?? null) !== null,
  );
  const canSubmit = draft.label.trim() && draft.recipientName.trim() && draft.addressText.trim().length >= 5 && !props.busy;
  const hasPin = draft.latitude !== null && draft.longitude !== null;
  return (
    <form
      className="addr-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) props.onSubmit(draft);
      }}
    >
      <label className="addr-field">
        <span>Label</span>
        <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Home, Work…" maxLength={60} required />
      </label>
      <label className="addr-field">
        <span>Recipient name</span>
        <input value={draft.recipientName} onChange={(e) => setDraft({ ...draft, recipientName: e.target.value })} maxLength={120} required />
      </label>
      <label className="addr-field">
        <span>Phone (optional)</span>
        <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} inputMode="tel" placeholder="0300…" />
      </label>
      <label className="addr-field">
        <span>Address</span>
        <textarea
          value={draft.addressText}
          onChange={(e) => setDraft({ ...draft, addressText: e.target.value })}
          rows={2}
          maxLength={300}
          placeholder="House, street, area, city"
          required
        />
      </label>
      {/* Phase 3C: optional map pin. Coordinates are never invented — the
          pin only exists once the user places it. */}
      <div className="addr-pin-section">
        <button
          type="button"
          className="addr-link"
          aria-expanded={showPin}
          onClick={() => setShowPin((s) => !s)}
        >
          {showPin ? '▾ Hide map pin' : '▸ Pin on map (optional)'}
          {hasPin && !showPin ? ' — pin placed ✓' : null}
        </button>
        {showPin ? (
          <div style={{ marginTop: 8 }}>
            <PinDropPicker
              value={hasPin ? { latitude: draft.latitude as number, longitude: draft.longitude as number } : null}
              onChange={(v) => setDraft((d) => ({ ...d, latitude: v?.latitude ?? null, longitude: v?.longitude ?? null }))}
            />
          </div>
        ) : null}
      </div>
      {props.error ? (
        <p className="addr-error" role="alert">
          {props.error}
        </p>
      ) : null}
      <div className="addr-actions">
        <Button type="button" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {props.busy ? 'Saving…' : props.submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function AddressesScreen(props: { onBack: () => void }) {
  const addresses = useAsyncData(() => listAddresses(), []);
  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (addresses.loading && mode === 'list' && !editingId) return <ListSkeleton count={3} />;
  if (addresses.error && mode === 'list' && !editingId) return <ErrorState message={addresses.error} onRetry={addresses.reload} />;

  const items = addresses.data ?? [];

  const refresh = () => {
    addresses.reload();
  };

  const submitCreate = async (draft: AddressDraft) => {
    setBusy(true);
    setActionError(null);
    try {
      await createAddress({
        label: draft.label.trim(),
        recipientName: draft.recipientName.trim(),
        phone: draft.phone.trim() || null,
        addressText: draft.addressText.trim(),
        ...(draft.latitude !== null && draft.longitude !== null
          ? { coordinates: { latitude: draft.latitude, longitude: draft.longitude } }
          : {}),
      });
      setMode('list');
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not save the address. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async (id: string, draft: AddressDraft) => {
    setBusy(true);
    setActionError(null);
    try {
      await updateAddress(id, {
        label: draft.label.trim(),
        recipientName: draft.recipientName.trim(),
        phone: draft.phone.trim() || null,
        addressText: draft.addressText.trim(),
        // The pin is authoritative from the form: a removed pin clears it
        // server-side; untouched pins round-trip unchanged.
        coordinates:
          draft.latitude !== null && draft.longitude !== null
            ? { latitude: draft.latitude, longitude: draft.longitude }
            : null,
      });
      setEditingId(null);
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not update the address. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const setDefault = async (id: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await updateAddress(id, { isDefault: true });
      refresh();
    } catch {
      setActionError('Could not set the default address. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await deleteAddress(id);
      refresh();
    } catch {
      setActionError('Could not delete the address. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const editing = items.find((a) => a.id === editingId) ?? null;

  if (editing) {
    return (
      <div className="screen">
        <ScreenHead title="Edit address" />
        <AddressForm
          initial={{ label: editing.label, recipientName: editing.recipientName, phone: editing.phone ?? '', addressText: editing.addressText, latitude: editing.latitude, longitude: editing.longitude }}
          submitLabel="Save changes"
          busy={busy}
          error={actionError}
          onSubmit={(d) => void submitEdit(editing.id, d)}
          onCancel={() => {
            setEditingId(null);
            setActionError(null);
          }}
        />
      </div>
    );
  }

  if (mode === 'create') {
    return (
      <div className="screen">
        <ScreenHead title="New address" />
        <AddressForm submitLabel="Save address" busy={busy} error={actionError} onSubmit={(d) => void submitCreate(d)} onCancel={() => { setMode('list'); setActionError(null); }} />
      </div>
    );
  }

  return (
    <div className="screen">
      <ScreenHead title="Addresses" sub={items.length ? 'Used for delivery orders' : undefined}>
        <button type="button" className="header-link" onClick={() => setMode('create')}>
          Add
        </button>
      </ScreenHead>

      {actionError ? (
        <div className="error-state" role="alert">
          <p>⚠ {actionError}</p>
        </div>
      ) : null}

      {!items.length ? (
        <>
          <EmptyState
            icon={<span aria-hidden>📍</span>}
            title="No addresses yet"
            body="Add a delivery address once and reuse it at checkout."
          />
          <Button full onClick={() => setMode('create')}>
            Add an address
          </Button>
        </>
      ) : (
        <ul className="addr-list">
          {items.map((a) => (
            <li key={a.id} className={`addr-card${a.isDefault ? ' addr-card-default' : ''}`}>
              <div className="addr-card-top">
                <span className="addr-label">{a.label}</span>
                {a.isDefault ? <span className="addr-default-chip">Default</span> : null}
              </div>
              <p className="addr-recipient">{a.recipientName}</p>
              <p className="addr-text">{a.addressText}</p>
              {a.phone ? <p className="addr-phone">{a.phone}</p> : null}
              {a.latitude !== null && a.longitude !== null ? (
                <p className="addr-pin-hint">📍 Map pin set — couriers can find you</p>
              ) : null}
              <div className="addr-card-actions">
                {!a.isDefault ? (
                  <button type="button" className="addr-link" onClick={() => void setDefault(a.id)} disabled={busy}>
                    Set default
                  </button>
                ) : null}
                <button
                  type="button"
                  className="addr-link"
                  onClick={() => {
                    setActionError(null);
                    setEditingId(a.id);
                  }}
                >
                  Edit
                </button>
                <button type="button" className="addr-link addr-link-danger" onClick={() => void remove(a.id)} disabled={busy}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Info pages (honest placeholders — final legal content comes later)  */
/* ------------------------------------------------------------------ */

function InfoPage(props: { title: string; children: React.ReactNode; onBack: () => void }) {
  return (
    <div className="screen">
      <ScreenHead title={props.title} />
      <div className="info-card">{props.children}</div>
      <Button full variant="ghost" onClick={props.onBack}>
        Back
      </Button>
    </div>
  );
}

export function HelpScreen(props: { onBack: () => void }) {
  return (
    <InfoPage title="Help & support" onBack={props.onBack}>
      <p>
        NearbyOrders connects you with nearby local businesses for bookings and orders. If something went wrong with an
        order or booking, contact the business directly first — their phone number and address are on their profile.
      </p>
      <p>For account problems (sign-in, wrong charges shown, deleted listings), reach the platform team at the support
        address published with your app release. This page will grow into full self-service support.</p>
    </InfoPage>
  );
}

export function TermsScreen(props: { onBack: () => void }) {
  return (
    <InfoPage title="Terms & conditions" onBack={props.onBack}>
      <p>
        This is a plain-language summary, not the final legal text. By using NearbyOrders you agree to use the platform
        for genuine bookings and orders, to pay businesses through the payment channels they publish, and not to
        misuse other people's data.
      </p>
      <p>
        Businesses are responsible for the accuracy of their own listings, prices, and availability. The final legal
        terms will replace this summary before public launch.
      </p>
    </InfoPage>
  );
}

export function PrivacyScreen(props: { onBack: () => void }) {
  return (
    <InfoPage title="Privacy policy" onBack={props.onBack}>
      <p>
        NearbyOrders stores your account details (name, email, phone), your bookings and orders, and — if you add them —
        your saved businesses and delivery addresses. Businesses you transact with see only the information needed to
        serve you (your name and the order/booking details).
      </p>
      <p>Payment receipts you upload go only to the business you are paying. Push notification tokens are used solely
        to deliver your notifications. This summary will be replaced by the final legal policy before public launch.</p>
    </InfoPage>
  );
}

export function AboutScreen(props: { onBack: () => void }) {
  return (
    <InfoPage title="About NearbyOrders" onBack={props.onBack}>
      <p className="about-tagline">Find nearby. Book or order.</p>
      <p>
        NearbyOrders is a local marketplace for Pakistan: discover real businesses around you, book services with live
        availability, and order products for pickup or delivery. Built mobile-first, in PKR, for real neighborhoods.
      </p>
    </InfoPage>
  );
}

/* ------------------------------------------------------------------ */
/* Saved-state hook shared by the business profile heart               */
/* ------------------------------------------------------------------ */

/** Tracks + toggles the saved state of one business for the signed-in user. */
export function useSavedBusiness(businessId: string) {
  const [saved, setSaved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSaved(null);
    import('../api.js').then(({ getFavoriteState }) =>
      getFavoriteState(businessId)
        .then((r) => {
          if (!cancelled) setSaved(r.saved);
        })
        .catch(() => {
          if (!cancelled) setSaved(false);
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const toggle = async (): Promise<'ok' | 'error'> => {
    if (busy || saved === null) return 'ok';
    setBusy(true);
    const next = !saved;
    try {
      const r = next ? await saveFavorite(businessId) : await unsaveFavorite(businessId);
      setSaved(r.saved);
      return 'ok';
    } catch {
      // keep previous state; the caller surfaces the failure to the user
      return 'error';
    } finally {
      setBusy(false);
    }
  };

  return { saved, busy, toggle };
}
