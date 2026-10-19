import type { ReactNode, SVGProps } from 'react';
import { useTheme } from '../theme.js';

/**
 * Minimal inline icon set (stroke-based, 24x24 grid, inherits currentColor).
 * Hand-picked shapes so the app stays dependency-free; sized via the `size` prop.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 22, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </Icon>
  );
}

export function ExploreIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </Icon>
  );
}

export function OrdersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M9 16h3" />
    </Icon>
  );
}

export function BookingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="m9.5 15 2 2 3.5-3.5" />
    </Icon>
  );
}

export function ProfileIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c1.3-3.4 4.1-5 7.5-5s6.2 1.6 7.5 5" />
    </Icon>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
    </Icon>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
      <path d="M12 14.5v2.5" />
    </Icon>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 21s-6.5-5.4-6.5-10a6.5 6.5 0 0 1 13 0c0 4.6-6.5 10-6.5 10Z" />
      <circle cx="12" cy="10.5" r="2.4" />
    </Icon>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 4l16 16" />
      <path d="M9.9 5.9A9.5 9.5 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.6 17.6 0 0 1-3.2 3.9" />
      <path d="M6.6 6.9A16.7 16.7 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </Icon>
  );
}

export function StoreIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 9.5 5.5 4h13L20 9.5" />
      <path d="M4 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0" />
      <path d="M5.5 12v8h13v-8" />
      <path d="M9.5 20v-5h5v5" />
    </Icon>
  );
}

export function UserPlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 20c1.1-3 3.6-4.5 6.5-4.5 1.3 0 2.5.3 3.5.9" />
      <path d="M18 14v6" />
      <path d="M15 17h6" />
    </Icon>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V13" />
      <path d="M12 16.5h.01" />
    </Icon>
  );
}

/** Notification bell: the recognizable header glyph for the notifications flow. */
export function BellIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 10a6 6 0 1 0-12 0c0 4.2-1.6 5.8-2.5 6.7-.3.3-.1.8.3.8h16.4c.4 0 .6-.5.3-.8-.9-.9-2.5-2.5-2.5-6.7Z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Icon>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m6 19 5.5-5.5a1.5 1.5 0 0 1 2.2 0L19 19" />
    </Icon>
  );
}

/* ---- Warm Proximity tab icons (Phase 2) ---- */

/** Activity (pulse line): the Warm Proximity Activity tab glyph. */
export function ActivityIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h4l2.5-6.5 4 13 2.5-6.5H21" />
    </Icon>
  );
}

/* --------- account-hub row icons (Profile settings hub) --------- */

export function UserIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c1.3-3.4 4.1-5 7.5-5s6.2 1.6 7.5 5" />
    </Icon>
  );
}

export function KeyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="14.5" r="4.5" />
      <path d="m11.5 11 8-8" />
      <path d="m16 7 2.5 2.5" />
      <path d="m18.5 4.5 2 2" />
    </Icon>
  );
}

export function HelpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.9c-.8.4-1 .9-1 1.9" />
      <path d="M12 16.8h.01" />
    </Icon>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.6h.01" />
    </Icon>
  );
}

export function StarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9.5 6.5 6 5.5-6 5.5" />
    </Icon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m14.5 6.5-6 5.5 6 5.5" />
    </Icon>
  );
}

export function HeartIcon(props: IconProps & { filled?: boolean }) {
  // Destructure before spreading so `filled` never reaches the DOM
  // (React would warn about a non-boolean attribute otherwise).
  const { filled, ...rest } = props;
  return (
    <Icon {...rest}>
      <path
        d="M12 20.5S4 15.1 4 9.6C4 6.9 6.1 5 8.5 5c1.5 0 2.8.8 3.5 2 .7-1.2 2-2 3.5-2C17.9 5 20 6.9 20 9.6c0 5.5-8 10.9-8 10.9Z"
        fill={filled ? 'currentColor' : 'none'}
      />
    </Icon>
  );
}


export function MoonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 13.5A8 8 0 1 1 10.5 4 6.5 6.5 0 0 0 20 13.5Z" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

/**
 * The NearbyOrders N+O mark — the final brand identity (Phase 9 geometry,
 * approved and frozen 2026-09-30; Phase 9B production color application).
 * Vector geometry mirrors brand/mark.svg exactly (viewBox 0 0 120 120);
 * never substitute a raster image.
 *
 * `tone="light"` (default): slate N — for light / porcelain surfaces.
 * `tone="dark"`: porcelain N — for dark surfaces. The ember O/tie and the
 * geometry never change between tones.
 */

/**
 * Theme-aware N+O mark. Renders the exact approved geometry; the N strokes
 * follow the resolved theme (slate on light, porcelain-white on dark) while
 * the ember O ring and welds never change. Light-mode rendering is untouched.
 */
export function ThemedMark(props: SVGProps<SVGSVGElement> & { size?: number }) {
  const { resolvedTheme } = useTheme();
  const { size = 30, ...rest } = props;
  return <NearbyOrdersMark size={size} tone={resolvedTheme === 'dark' ? 'dark' : 'light'} {...rest} />;
}

const NO_LEFT_D = 'M29 90 L29 30 L52.17 52.42';
const NO_RIGHT_D = 'M67.83 67.58 L91 90 L91 30';
const NO_RING_D =
  'M50 60 A10 10 0 1 1 70 60 A10 10 0 1 1 50 60 Z';
const NO_WELDS = [
  'M49.09 39.70 L57.00 47.35 L55.69 47.74 L54.43 48.25 L53.23 48.90 L52.11 49.67 L51.07 50.55 L50.14 51.53 L49.30 52.61 L48.59 53.77 L48.00 55.00 L47.54 56.28 C50.12 47.65 55.56 45.96 49.09 39.70 Z',
  'M39.36 49.76 L47.26 57.41 L47.60 56.09 L48.08 54.82 L48.68 53.60 L49.41 52.45 L50.26 51.39 L51.21 50.42 L52.26 49.55 L53.40 48.80 L54.61 48.17 L55.87 47.67 C47.34 50.53 45.82 56.02 39.36 49.76 Z',
  'M70.91 80.30 L63.00 72.65 L64.31 72.26 L65.57 71.75 L66.77 71.10 L67.89 70.33 L68.93 69.45 L69.86 68.47 L70.70 67.39 L71.41 66.23 L72.00 65.00 L72.46 63.72 C69.88 72.35 64.44 74.04 70.91 80.30 Z',
  'M80.64 70.24 L72.74 62.59 L72.40 63.91 L71.92 65.18 L71.32 66.40 L70.59 67.55 L69.74 68.61 L68.79 69.58 L67.74 70.45 L66.60 71.20 L65.39 71.83 L64.13 72.33 C72.66 69.47 74.18 63.98 80.64 70.24 Z',
];

export function NearbyOrdersMark({
  size = 30,
  tone = 'light',
  ...rest
}: SVGProps<SVGSVGElement> & { size?: number; tone?: 'light' | 'dark' }) {
  const n = tone === 'dark' ? '#F2F5F7' : '#16222E';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="NearbyOrders"
      {...rest}
    >
      <path d={NO_LEFT_D} stroke={n} strokeWidth={14} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <path d={NO_RIGHT_D} stroke={n} strokeWidth={14} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <path d={NO_RING_D} fill="none" stroke="#E23A2E" strokeWidth={6} />
      {NO_WELDS.map((d) => (
        <path key={d.slice(0, 12)} d={d} fill="#E23A2E" />
      ))}
    </svg>
  );
}
