import type { ReactNode } from 'react';
import { ChevronRightIcon } from '../components/icons.js';

/**
 * Shared building blocks for the Business Dashboard: plain document-flow
 * sections and rows that scroll with the page. Nothing here is fixed or
 * overlay-positioned, so it can never cover page content.
 */

/** One tappable management row (or a static one when disabled). */
export function OwnerHubRow(props: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  badge?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="hub-row-icon" aria-hidden>
        {props.icon}
      </span>
      <span className="hub-row-text">
        <span className="hub-row-title">{props.title}</span>
        {props.subtitle ? <span className="hub-row-sub">{props.subtitle}</span> : null}
      </span>
      {props.badge ? <span className="hub-row-soon">{props.badge}</span> : null}
      <span className="hub-row-chevron" aria-hidden>
        <ChevronRightIcon size={18} />
      </span>
    </>
  );
  if (!props.onClick) return <div className="hub-row hub-row-disabled">{body}</div>;
  return (
    <button type="button" className="hub-row" onClick={props.onClick}>
      {body}
    </button>
  );
}

/** A labelled group of hub rows that scrolls in the normal page flow. */
export function OwnerHubSection(props: { label: string; children: ReactNode }) {
  return (
    <section className="hub-section" aria-label={props.label}>
      <h3 className="hub-section-label">{props.label}</h3>
      <div className="hub-card">{props.children}</div>
    </section>
  );
}

/**
 * Standard chrome for a dedicated owner screen: normal scrolling content with
 * a back link and page title — no tab bar, no overlay.
 */
export function OwnerScreen(props: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="screen">
      <button className="back-link" onClick={props.onBack}>
        ‹ Back
      </button>
      <header className="owner-head">
        <h1>{props.title}</h1>
      </header>
      {props.children}
    </div>
  );
}
