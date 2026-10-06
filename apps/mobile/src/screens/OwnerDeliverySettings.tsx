import { useState } from 'react';
import { getDeliverySettings, putDeliverySettings, type DeliverySettings } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, ErrorState, Loading } from '../components/ui.js';
import { Toggle } from '../components/primitives.js';
import { OwnerHubRow } from './owner-ui.js';
import { AlertIcon, BookingsIcon, CheckIcon, InfoIcon, StoreIcon } from '../components/icons.js';
import { parsePriceToMinor } from './OwnerCatalog.js';

export function DeliverySettingsSection(props: { businessId: string }) {
  const settings = useAsyncData<DeliverySettings>(() => getDeliverySettings(props.businessId), [props.businessId]);
  const [deliveryEnabled, setDeliveryEnabled] = useState<boolean | null>(null);
  const [codEnabled, setCodEnabled] = useState<boolean | null>(null);
  const [fee, setFee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const current = settings.data;
  const model = {
    deliveryEnabled: deliveryEnabled ?? current?.deliveryEnabled ?? false,
    codEnabled: codEnabled ?? current?.codEnabled ?? false,
    fee,
  };

  // Empty fee field means "keep the saved fee" — never silently reset it to 0.
  const feeMinor = fee.trim() === '' ? current?.deliveryFeeMinor ?? 0 : parsePriceToMinor(fee);
  const feeInvalid = model.deliveryEnabled && fee.trim() !== '' && feeMinor === null;

  const save = async () => {
    if (busy || feeInvalid) return;
    setBusy(true);
    setError(null);
    try {
      await putDeliverySettings(props.businessId, {
        deliveryEnabled: model.deliveryEnabled,
        codEnabled: model.deliveryEnabled && model.codEnabled,
        deliveryFeeMinor: model.deliveryEnabled ? feeMinor ?? 0 : 0,
      });
      setSaved(true);
      setFee('');
      setDeliveryEnabled(null);
      setCodEnabled(null);
      settings.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-label="Delivery settings">
      <h2>Delivery &amp; cash on delivery</h2>
      <p className="hint">
        Offer delivery with your own rider. Customers pay the delivery fee to you: NearbyOrders never handles the money.
      </p>
      {settings.loading && !current ? (
        <Loading label="Loading settings…" />
      ) : settings.error && !current ? (
        <ErrorState message={settings.error} onRetry={settings.reload} />
      ) : (
        <>
          {error ? <ErrorState message={error} /> : null}
          {saved ? <p className="save-ok">Saved ✓</p> : null}
          <div className="set-row">
            <div className="set-text">
              <span className="set-title">Offer delivery</span>
              <span className="set-body">Let customers choose delivery by your rider.</span>
            </div>
            <Toggle
              checked={model.deliveryEnabled}
              onChange={(v) => {
                setSaved(false);
                setDeliveryEnabled(v);
                if (!v) setCodEnabled(false);
              }}
              label="Offer delivery"
            />
          </div>
          {model.deliveryEnabled ? (
            <>
              <div className="set-row">
                <div className="set-text">
                  <span className="set-title">Cash on delivery</span>
                  <span className="set-body">Accept cash when your rider hands over the order.</span>
                </div>
                <Toggle
                  checked={model.codEnabled}
                  onChange={(v) => {
                    setSaved(false);
                    setCodEnabled(v);
                  }}
                  label="Cash on delivery"
                />
              </div>
              <div className="set-field">
                <div className="set-text">
                  <span className="set-title">Delivery fee (PKR)</span>
                  <span className="set-body">Added to the order total for delivery orders only. Leave empty to keep the current fee.</span>
                </div>
                <div className="field">
                  <input
                    value={model.fee}
                    onChange={(e) => {
                      setSaved(false);
                      setFee(e.target.value);
                    }}
                    inputMode="decimal"
                    placeholder={current ? String(current.deliveryFeeMinor / 100) : 'e.g. 200'}
                    aria-invalid={feeInvalid}
                    aria-label="Delivery fee in rupees"
                  />
                </div>
                {feeInvalid ? <p className="form-error">Enter a valid fee in rupees, e.g. 200 or 200.50.</p> : null}
              </div>
            </>
          ) : null}
          <div className="set-actions">
            <Button full onClick={save} disabled={busy || feeInvalid}>
              {busy ? 'Saving…' : 'Save delivery settings'}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Business Settings screen (the 'settings' route). Delivery and COD are the
 * only business-wide settings that exist, so this screen hosts the delivery
 * section plus links to every other configuration area — visibly different
 * from the focused 'delivery' route, which shows the delivery form alone.
 * Customer payment channels live in OwnerCustomerPayments ('payments' /
 * 'payment-methods' routes); this screen links to them rather than
 * duplicating them.
 */
export function BusinessSettingsScreen(props: { businessId: string; onOpen: (path: string) => void }) {
  const base = `/owner/${props.businessId}`;
  return (
    <>
      <DeliverySettingsSection businessId={props.businessId} />
      <section className="card" aria-label="More settings" style={{ marginTop: 12 }}>
        <h2>More settings</h2>
        <p className="hint">Everything else you can configure for this business.</p>
        <OwnerHubRow icon={<StoreIcon size={18} />} title="Business profile" subtitle="Name, address, contact, category" onClick={() => props.onOpen(`${base}/profile`)} />
        <OwnerHubRow icon={<BookingsIcon size={18} />} title="Business hours" subtitle="Set your operating hours" onClick={() => props.onOpen(`${base}/hours`)} />
        <OwnerHubRow icon={<InfoIcon size={18} />} title="Service advance settings" subtitle="Per-service advance requirements" onClick={() => props.onOpen(`${base}/advances`)} />
        <OwnerHubRow icon={<AlertIcon size={18} />} title="Customer payments" subtitle="Verify customer payment proofs" onClick={() => props.onOpen(`${base}/payments`)} />
        <OwnerHubRow icon={<CheckIcon size={18} />} title="Business payment methods" subtitle="Channels customers pay you through" onClick={() => props.onOpen(`${base}/payment-methods`)} />
      </section>
    </>
  );
}
