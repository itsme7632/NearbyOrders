import * as React from 'react';
import * as api from './api.js';
import type { AuditEntry } from './api.js';
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

/** How many entries render before the "Show more" button. */
const INITIAL_VISIBLE = 100;
/** Max characters shown for the metadata key=value summary. */
const META_MAX_LEN = 140;

function isScalar(v: unknown): v is string | number | boolean {
  const t = typeof v;
  return t === 'string' || t === 'number' || t === 'boolean';
}

/**
 * Compact key=value summary of an audit entry's metadata.
 * Defensive: metadata may be any JSON. Only short scalar pairs are shown,
 * nested objects and arrays are skipped, output length is capped.
 */
function metadataSummary(metadata: unknown): string | null {
  if (metadata === null || metadata === undefined) return null;
  if (isScalar(metadata)) {
    const s = String(metadata);
    return s.length > META_MAX_LEN ? `${s.slice(0, META_MAX_LEN)}...` : s;
  }
  if (typeof metadata !== 'object') return null;
  if (Array.isArray(metadata)) return null;
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
  const haystacks = [
    entry.action,
    entry.entityType,
    entry.entityId,
    entry.actor ? entry.actor.email : '',
    entry.actor ? entry.actor.id : '',
    metadataSummary(entry.metadata) ?? '',
  ];
  return haystacks.some((h) => h.toLowerCase().includes(needle));
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
    return [{ value: '', label: 'All actions' }].concat(
      Array.from(seen)
        .sort((a, b) => a.localeCompare(b))
        .map((a) => ({ value: a, label: statusLabel(a) })),
    );
  }, [entries]);

  const filtered = React.useMemo(
    () =>
      entries.filter(
        (e) => (actionFilter === '' || e.action === actionFilter) && matchesSearch(e, query),
      ),
    [entries, actionFilter, query],
  );

  const isFiltering = query.trim() !== '' || actionFilter !== '';
  const shown = filtered.slice(0, visible);
  const remaining = filtered.length - shown.length;

  const clearFilters = () => {
    setQuery('');
    setActionFilter('');
    setVisible(INITIAL_VISIBLE);
  };

  const onQueryChange = (v: string) => {
    setQuery(v);
    setVisible(INITIAL_VISIBLE);
  };
  const onActionChange = (v: string) => {
    setActionFilter(v);
    setVisible(INITIAL_VISIBLE);
  };

  return (
    <>
      <PageHeader
        kicker="System"
        title="Audit log"
        subtitle="What happened across the platform, and who did it."
      />
      <Card title={`Recent admin activity (${filtered.length})`}>
        <Toolbar>
          <SearchInput
            value={query}
            onChange={onQueryChange}
            placeholder="Search actor, action, or target"
            label="Search audit log"
          />
          <FilterSelect
            label="Filter by action"
            value={actionFilter}
            onChange={onActionChange}
            options={actionOptions}
          />
          <span className="nb-toolbar-end">
            <span className="nb-result-count" aria-live="polite">
              {loading ? 'Loading…' : `${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'}`}
            </span>
          </span>
        </Toolbar>
        {loading ? (
          <Skeleton rows={8} height={56} />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : entries.length === 0 ? (
          <EmptyState title="No audit entries yet." />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No entries match your search."
            action={
              <button type="button" className="nb-btn nb-btn-secondary" onClick={clearFilters}>
                Clear search
              </button>
            }
          />
        ) : (
          <>
            <ul className="nb-timeline">
              {shown.map((entry) => {
                const meta = metadataSummary(entry.metadata);
                return (
                  <li key={entry.id} className="nb-timeline-item">
                    <span className="nb-timeline-time nb-mono">{fmtDateTime(entry.createdAt)}</span>
                    <div className="nb-timeline-body">
                      <span className="nb-timeline-actor">
                        {entry.actor ? entry.actor.email || entry.actor.id : 'system'}
                      </span>{' '}
                      <Badge value={entry.action} tone="info" />{' '}
                      <span className="nb-timeline-target nb-mono">
                        {entry.entityType}/{entry.entityId.slice(0, 8)}
                      </span>
                      {meta ? <div className="nb-timeline-target">{meta}</div> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            {remaining > 0 ? (
              <div className="nb-state-action">
                <button
                  type="button"
                  className="nb-btn nb-btn-secondary"
                  onClick={() => setVisible((v) => v + INITIAL_VISIBLE)}
                >
                  Show more ({remaining} more)
                </button>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
