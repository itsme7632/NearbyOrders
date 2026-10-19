import { Button } from '../components/ui.js';
import { useTheme, type ThemePreference } from '../theme.js';

const OPTIONS: { key: ThemePreference; title: string; body: string }[] = [
  { key: 'light', title: 'Light', body: 'The classic NearbyOrders look.' },
  { key: 'dark', title: 'Dark', body: 'NearbyOrders after sunset. Easier on the eyes at night.' },
  { key: 'system', title: 'System', body: 'Follow your phone\u2019s appearance setting automatically.' },
];

/**
 * Appearance setting: Light / Dark / System. The choice applies instantly
 * (theme.ts swaps the tokens, no restart) and persists in localStorage.
 */
export function AppearanceScreen(props: { onBack: () => void }) {
  const { preference, resolvedTheme, setPreference } = useTheme();
  return (
    <div className="screen">
      <header className="owner-head saved-head">
        <div>
          <h1>Appearance</h1>
          <p className="owner-sub">Choose how NearbyOrders looks</p>
        </div>
      </header>
      <div style={{ marginBottom: 8 }}>
        <Button variant="ghost" onClick={props.onBack}>
          ‹ Back
        </Button>
      </div>

      <div role="radiogroup" aria-label="Appearance" className="pref-list">
        {OPTIONS.map((opt) => {
          const active = preference === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              role="radio"
              aria-checked={active}
              className={`pref-row appearance-option${active ? ' appearance-option-active' : ''}`}
              onClick={() => setPreference(opt.key)}
            >
              <span className="pref-text">
                <span className="pref-title">{opt.title}</span>
                <span className="pref-body">{opt.body}</span>
              </span>
              <span className="radio-dot" aria-hidden />
            </button>
          );
        })}
      </div>

      <p className="hint" style={{ marginTop: 12 }}>
        {preference === 'system'
          ? `Following your phone: ${resolvedTheme === 'dark' ? 'dark' : 'light'} right now.`
          : 'Your choice is saved on this phone.'}
      </p>
    </div>
  );
}
