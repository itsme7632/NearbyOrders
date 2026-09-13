import { useState } from 'react';
import { getDeliverySettings, putDeliverySettings, type DeliverySettings } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, ErrorState, Field, Loading, Toggle } from '../components/ui.js';
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
          <Toggle
            checked={model.deliveryEnabled}
            onChange={(v) => {
              setSaved(false);
              setDeliveryEnabled(v);
              if (!v) setCodEnabled(false);
            }}
            label="Offer delivery (own rider)"
          />
          {model.deliveryEnabled ? (
            <>
              <Toggle
                checked={model.codEnabled}
                onChange={(v) => {
                  setSaved(false);
                  setCodEnabled(v);
                }}
                label="Cash on delivery"
              />
              <Field label="Delivery fee (PKR)" hint="Added to the order total for delivery orders only.">
                <input
                  value={model.fee}
                  onChange={(e) => {
                    setSaved(false);
                    setFee(e.target.value);
                  }}
                  inputMode="decimal"
                  placeholder={current ? String(current.deliveryFeeMinor / 100) : 'e.g. 200'}
                  aria-invalid={feeInvalid}
                />
              </Field>
              {feeInvalid ? <p className="form-error">Enter a valid fee in rupees, e.g. 200 or 200.50.</p> : null}
            </>
          ) : null}
          <Button full onClick={save} disabled={busy || feeInvalid}>
            {busy ? 'Saving…' : 'Save delivery settings'}
          </Button>
        </>
      )}
    </section>
  );
}
