import { Button } from './ui.js';
import { AlertIcon } from './icons.js';
import type { BusinessEntitlement } from '../api.js';

/**
 * P3: business-slot limit notice. Rendered when the owner's plan has no
 * remaining business slots — never when a slot is available. Usage numbers
 * always come from the server (BusinessEntitlement); nothing is derived
 * from plan names on the client.
 */
export function BusinessLimitNotice(props: {
  entitlement: BusinessEntitlement;
  onUpgrade: () => void;
}) {
  const { usedBusinesses, maxBusinesses } = props.entitlement;
  return (
    <div className="card" role="status" aria-live="polite">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <AlertIcon size={20} />
        <div>
          <p style={{ fontWeight: 700, margin: '0 0 4px' }}>Business limit reached</p>
          <p className="muted" style={{ margin: '0 0 4px' }}>
            Your current plan allows {maxBusinesses} {maxBusinesses === 1 ? 'business' : 'businesses'}. You are
            using {usedBusinesses} of {maxBusinesses}.
          </p>
          <p className="muted" style={{ margin: 0 }}>
            Upgrade your plan to list more businesses. Your existing businesses are unaffected.
          </p>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <Button full onClick={props.onUpgrade}>
          Upgrade plan
        </Button>
      </div>
    </div>
  );
}
