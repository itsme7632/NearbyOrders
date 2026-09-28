# Screen Sources: Real NearbyOrders App UI

Every phone visual in this website is drawn from the **actual implemented
NearbyOrders customer app**, not from marketing mockups.

Source of truth: `apps/mobile/src` in the NearbyOrders repository
(React + TypeScript + Capacitor; Atlas Refined design system).

## Slot inventory

| # | File (`assets/screens/`) | Real app screen | Source file |
|---|--------------------------|-----------------|-------------|
| 1 | `hero-home.png` | Customer Home: location context row, daypart greeting, "Find the best near you" hero, search entry, category rail, open-now spotlight, business rows, support-local strip, bottom tab bar | `src/screens/Home.tsx` |
| 2 | `product-discover.png` | Customer Explore: "Explore" hero, pill search bar, Near-you toggle + category chips, business discovery list | `src/screens/Explore.tsx` |
| 3 | `product-order.png` | Order flow: "Your cart" with item step, quantity steppers, price summary (subtotal, delivery fee, total), Place order CTA | `src/screens/Cart.tsx` |
| 4 | `product-book.png` | Booking flow: business header with verified/open status, 3-step progress, service options with radio select, date chips, time slots, Continue CTA | `src/screens/BookService.tsx` |
| 5 | `experience-order.png` | Customer Orders: "My orders" with Active/All segmented tabs, order cards with 5-dot status track, status badges, placed-time strip | `src/screens/Orders.tsx` |
| 6 | `experience-book.png` | Customer Bookings: "My bookings" with Upcoming/Past groups, booking cards with calendar date block, service/business/time, price, status badge | `src/screens/Bookings.tsx` |
| 7 | `cta-explore.png` | Customer Explore (same source as #2) | `src/screens/Explore.tsx` |

## What was reproduced

- Layout, spacing rhythm, and component structure of each screen
- Design tokens from `src/styles.css` (`:root`): porcelain `#F2F5F7`,
  slate `#16222E`, ember `#E23A2E`, success `#22763F`, muted `#5C6E80`
- Real copy from the app: "Find the best near you", "Good morning,",
  "Search businesses, products & services", "Browse categories",
  "Popular near you", "Support local businesses", "My orders",
  "My bookings", "Your cart", "Ordering from", "Which service?",
  "Pick a date", "Pick a time", "Place order", "Continue"
- Real app behaviors: Active/All order tabs, 5-step order tracking dots,
  booking calendar blocks, quantity steppers, the floating bottom tab bar
  (Home / Explore / Orders / Bookings / Profile) with the ember active glyph
- Money formatting as the app renders it (`Rs 1,700` via `formatMoney`)

## Demo data

Business names, prices, ratings, distances, dates, and order numbers are
clearly fictional demo data (e.g. "Demo Bakery", "Demo Salon"). They exist
only to show the real UI in a populated state and do not represent real
users, real businesses, or real transactions.

## Regenerating

The images are produced by `render_app_screens.py` in this folder. Run it to
rebuild all seven files after any app UI change:

```
python3 render_app_screens.py
```

The script documents the exact source file per screen at the top.
