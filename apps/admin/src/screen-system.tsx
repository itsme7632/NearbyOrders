import * as React from 'react';
import * as api from './api.js';
import type { AuditEntry } from './api.js';
import * as websiteApi from './website-api.js';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  FilterSelect,
  PageHeader,
  Skeleton,
  SearchInput,
  Toolbar,
  fmtDateTime,
  statusLabel,
  useAsync,
} from './ds.js';

const INITIAL_VISIBLE = 100;
const META_MAX_LEN = 140;

function isScalar(v: unknown): v is string | number | boolean {
  const t = typeof v;
  return t === 'string' || t === 'number' || t === 'boolean';
}

function metadataSummary(metadata: unknown): string | null {
  if (metadata === null || metadata === undefined) return null;
  if (isScalar(metadata)) {
    const s = String(metadata);
    return s.length > META_MAX_LEN ? `${s.slice(0, META_MAX_LEN)}...` : s;
  }
  if (typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (!isScalar(value)) continue;
    const pair = `${key}=${String(value)}`;
    pairs.push(pair.length > 60 ? `${pair.slice(0, 60)}...` : pair);
  }
  if (pairs.length === 0) return null;
  const joined = pairs.join(', ');
  return joined.length > META_MAX_LEN ? `${joined.slice(0, META_MAX_LEN)}...` : joined;
}

function matchesSearch(entry: AuditEntry, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const haystacks = [entry.action, entry.entityType, entry.entityId, entry.actor ? entry.actor.email : '', entry.actor ? entry.actor.id : '', metadataSummary(entry.metadata) ?? ''];
  return haystacks.some((h) => h.toLowerCase().includes(needle));
}

function WebsiteAppSettings() {
  const [config, setConfig] = React.useState<websiteApi.WebsiteAppLinkConfig | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [form, setForm] = React.useState({
    googlePlayUrl: '', directApkUrl: '', appStoreUrl: '',
    primaryCta: 'play' as websiteApi.WebsitePlatform,
    googlePlayEnabled: false, directApkEnabled: false, appStoreEnabled: false,
    businessOnboardingUrl: '',
  });

  const load = React.useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const next = await websiteApi.getWebsiteAppLinks();
      setConfig(next);
      const byPlatform = Object.fromEntries(next.buttons.map((b) => [b.platform, b]));
      setForm({
        googlePlayUrl: byPlatform.play?.url ?? '',
        directApkUrl: byPlatform.apk?.url ?? '',
        appStoreUrl: byPlatform.ios?.url ?? '',
        primaryCta: next.primaryCta,
        googlePlayEnabled: Boolean(byPlatform.play?.enabled),
        directApkEnabled: Boolean(byPlatform.apk?.enabled),
        appStoreEnabled: Boolean(byPlatform.ios?.enabled),
        businessOnboardingUrl: next.businessOnboardingUrl ?? '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load website settings.');
    } finally { setLoading(false); }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError(null); setSaved(false);
    try {
      const next = await websiteApi.updateWebsiteAppLinks({
        googlePlayUrl: form.googlePlayUrl.trim() || null,
        directApkUrl: form.directApkUrl.trim() || null,
        appStoreUrl: form.appStoreUrl.trim() || null,
        primaryCta: form.primaryCta,
        googlePlayEnabled: form.googlePlayEnabled,
        directApkEnabled: form.directApkEnabled,
        appStoreEnabled: form.appStoreEnabled,
        businessOnboardingUrl: form.businessOnboardingUrl.trim() || null,
      });
      setConfig(next); setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save website settings.');
    } finally { setSaving(false); }
  };

  if (loading) return <Card title="Website / App Settings"><Skeleton rows={5} height={52} /></Card>;

  return (
    <Card title="Website / App Settings" subtitle="Manage the public website's app download and business onboarding destinations. Changes take effect without a website redeploy.">
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      <form onSubmit={save}>
        <div style={{ display: 'grid', gap: 20, maxWidth: 820 }}>
          {([
            ['Google Play', 'googlePlayUrl', 'googlePlayEnabled'],
            ['Direct APK', 'directApkUrl', 'directApkEnabled'],
            ['App Store', 'appStoreUrl', 'appStoreEnabled'],
          ] as const).map(([label, urlKey, enabledKey]) => (
            <div key={urlKey} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 16 }}>
              <label style={{ display: 'block', fontWeight: 700, marginBottom: 8 }}>{label} URL</label>
              <input type="url" inputMode="url" placeholder="https://..." value={form[urlKey]} onChange={(e) => update(urlKey, e.target.value)} style={{ width: '100%' }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 14, fontWeight: 600 }}>
                <input type="checkbox" checked={form[enabledKey]} onChange={(e) => update(enabledKey, e.target.checked)} />
                Enabled on public website
              </label>
            </div>
          ))}

          <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 16 }}>
            <label style={{ display: 'block', fontWeight: 700, marginBottom: 8 }} htmlFor="primary-cta">Primary “Get the app” destination</label>
            <select id="primary-cta" value={form.primaryCta} onChange={(e) => update('primaryCta', e.target.value as websiteApi.WebsitePlatform)} style={{ width: '100%' }}>
              <option value="play">Google Play</option><option value="apk">Direct APK</option><option value="ios">App Store</option>
            </select>
            <p className="nb-muted" style={{ marginTop: 8 }}>The selected platform must be enabled and have a valid HTTPS URL when you save.</p>
          </div>

          <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 16 }}>
            <label style={{ display: 'block', fontWeight: 700, marginBottom: 8 }}>Business onboarding URL</label>
            <input type="url" inputMode="url" placeholder="https://..." value={form.businessOnboardingUrl} onChange={(e) => update('businessOnboardingUrl', e.target.value)} style={{ width: '100%' }} />
            <p className="nb-muted" style={{ marginTop: 8 }}>Optional. If empty, “List your business” stays disabled instead of pointing to a fake destination.</p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button type="submit" className="nb-btn" disabled={saving}>{saving ? 'Saving…' : 'Save website settings'}</button>
            {saved ? <Badge value="SAVED" tone="ok" /> : null}
            {config?.updatedAt ? <span className="nb-muted">Last updated {fmtDateTime(config.updatedAt)}</span> : null}
          </div>
        </div>
      </form>
    </Card>
  );
}

export function AuditLog() {
  const { data, loading, error, reload } = useAsync<AuditEntry[]>(() => api.listAuditLog(''), []);
  const [query, setQuery] = React.useState('');
  const [actionFilter, setActionFilter] = React.useState('');
  const [visible, setVisible] = React.useState(INITIAL_VISIBLE);
  const entries = data ?? [];
  const actionOptions = React.useMemo(() => {
    const seen = new Set<string>();
    for (const e of entries) seen.add(e.action);
    return [{ value: '', label: 'All actions' }].concat(Array.from(seen).sort((a, b) => a.localeCompare(b)).map((a) => ({ value: a, label: statusLabel(a) })));
  }, [entries]);
  const filtered = React.useMemo(() => entries.filter((e) => (actionFilter === '' || e.action === actionFilter) && matchesSearch(e, query)), [entries, actionFilter, query]);
  const shown = filtered.slice(0, visible);
  const remaining = filtered.length - shown.length;
  const clearFilters = () => { setQuery(''); setActionFilter(''); setVisible(INITIAL_VISIBLE); };

  return (
    <>
      <PageHeader kicker="System" title="System" subtitle="Website configuration and platform audit history." />
      <WebsiteAppSettings />
      <Card title={`Recent admin activity (${filtered.length})`}>
        <Toolbar>
          <SearchInput value={query} onChange={(v) => { setQuery(v); setVisible(INITIAL_VISIBLE); }} placeholder="Search actor, action, or target" label="Search audit log" />
          <FilterSelect label="Filter by action" value={actionFilter} onChange={(v) => { setActionFilter(v); setVisible(INITIAL_VISIBLE); }} options={actionOptions} />
          <span className="nb-toolbar-end"><span className="nb-result-count" aria-live="polite">{loading ? 'Loading…' : `${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'}`}</span></span>
        </Toolbar>
        {loading ? <Skeleton rows={8} height={56} /> : error ? <ErrorState message={error} onRetry={reload} /> : entries.length === 0 ? <EmptyState title="No audit entries yet." /> : filtered.length === 0 ? <EmptyState title="No entries match your search." action={<button type="button" className="nb-btn nb-btn-secondary" onClick={clearFilters}>Clear search</button>} /> : (
          <>
            <ul className="nb-timeline">
              {shown.map((entry) => {
                const meta = metadataSummary(entry.metadata);
                return <li key={entry.id} className="nb-timeline-item"><span className="nb-timeline-time nb-mono">{fmtDateTime(entry.createdAt)}</span><div className="nb-timeline-body"><span className="nb-timeline-actor">{entry.actor ? entry.actor.email || entry.actor.id : 'system'}</span>{' '}<Badge value={entry.action} tone="info" />{' '}<span className="nb-timeline-target nb-mono">{entry.entityType}/{entry.entityId.slice(0, 8)}</span>{meta ? <div className="nb-timeline-target">{meta}</div> : null}</div></li>;
              })}
            </ul>
            {remaining > 0 ? <div className="nb-state-action"><button type="button" className="nb-btn nb-btn-secondary" onClick={() => setVisible((v) => v + INITIAL_VISIBLE)}>Show more ({remaining} more)</button></div> : null}
          </>
        )}
      </Card>
    </>
  );
}
