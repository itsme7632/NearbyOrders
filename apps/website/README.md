# NearbyOrders: Final Production Website (Design Prototype)

**Status:** Final design direction, locked on **Concept 01 "Product First"** with restrained local-discovery influence from Concept 02. No further concepts or alternatives.

**File:** `index.html`: one complete, standalone, production-translatable prototype (no build step, no dependencies beyond Google Fonts).

## Real app screens

The website shows the **actual NearbyOrders customer app** inside every phone
frame and experience visual. The seven images in `assets/screens/` are drawn
from the real implemented app in `apps/mobile/src` (screens, components,
design tokens, and copy), not from marketing mockups:

| # | File (`assets/screens/`) | Real app screen |
|---|--------------------------|-----------------|
| 1 | `hero-home.png` | Customer Home: greeting, search, categories, nearby businesses |
| 2 | `product-discover.png` | Customer Explore: search, filters, business discovery list |
| 3 | `product-order.png` | Order flow: cart, quantities, price summary, Place order |
| 4 | `product-book.png` | Booking flow: services, date and time pickers, Continue |
| 5 | `experience-order.png` | My orders: Active/All tabs, status tracking dots, badges |
| 6 | `experience-book.png` | My bookings: Upcoming/Past, calendar blocks, status badges |
| 7 | `cta-explore.png` | Customer Explore |

Business names, prices, ratings, and dates in the images are clearly fictional
demo data. Full source mapping lives in `assets/screens/SCREEN_SOURCES.md`,
and each visual is marked in the HTML with an `<!-- App screen: ... -->`
comment naming its source file. Rebuild all seven with
`python3 render_app_screens.py`.

Notes:
- The phone frames keep their composition and layout; only the screen content
  changed. There is no fake notch, so Android status bars show without double
  chrome.
- The business owner dashboard (For Businesses section) remains a labeled
  product mockup; it was not in the app-screen replacement list.
- The mobile app itself was not altered. The website represents the app.

## Polish pass (final)

A dedicated human-design-quality pass refined the locked direction without changing its structure or identity:

- **Zero em dashes** anywhere: headings, copy, buttons, labels, nav, footer, metadata, aria labels, mockup text, comments.
- **De-templated the layout rhythm**: the "three cards in a grid" product section became editorial numbered rows with alternating composition and hairline dividers; dark sections (local discovery, final CTA) went full-bleed while the business section stays an inset panel, so sections no longer feel like repeated containers.
- **Removed decoration without a job**: the hero gradient glow, the redundant pulsing dot on the order card, the CTA badge pills, and the admin-panel chip cloud (now a quiet mono list) are gone. Float animation softened.
- **Copy rewritten by a human standard**: short, direct sentences, no startup-isms ("seamlessly", "revolutionizing", "all-in-one", "next-generation" and friends all absent).
- Accessibility, SEO, responsive behavior, and reduced-motion support preserved and re-verified.

## Page flow

1. **Hero**: "Everything nearby. One place to order and book." Large Android phone mockup (Home/discovery), floating order-status and booking cards, dual CTAs (Get the App / For Businesses).
2. **Product introduction**: three product moments (Discover nearby / Order what you need / Book when you need it) with mini UI visuals.
3. **Local discovery**: restrained Concept-02 influence: dark panel with stylized SVG map, pulsing location pins, selectable category chips, and three location-first proof points.
4. **Orders + Bookings**: the two core customer actions as side-by-side panels with realistic UI (order progress steps, booking slot picker).
5. **For Businesses**: "Your business, connected to nearby customers." Five business value points + owner dashboard mockup (orders, bookings, earnings) + "Join NearbyOrders" CTA.
6. **One connected platform**: Customer ↓ NearbyOrders ↓ Business diagram with the **unified admin panel** shown as infrastructure beneath (one admin for app + website, never two systems).
7. **App CTA**: "Nearby is just the beginning." with Explore-screen phone mockup and Android badges.
8. **Footer**: Customer / Business / Company columns, domain structure (nearbyorders.com, admin., api.), Privacy/Terms/Support/About.

## Brand & rules honored

- N+O / Atlas Refined: porcelain `#F2F5F7`, slate `#16222E`, ember `#E23A2E`; Bricolage Grotesque + Inter + JetBrains Mono.
- No gradients, glassmorphism, neon, or generic startup illustration.
- No fake statistics, testimonials, business names, ratings, or app-store claims. The phone screens are the real customer app; the business dashboard is labeled as an illustrative preview.
- Android-only CTAs throughout; no iOS mentions.
- Responsive at 1024 / 768 / 520px; mobile nav, stacked layouts, no horizontal overflow, 44px+ touch targets.
- Accessibility: semantic landmarks, skip link, one h1, aria labels on mockups, focus-visible styles, keyboard-operable menu and chips, `prefers-reduced-motion` support.
- SEO: title, meta description, Open Graph with real `og-cover.png` at the site root, canonical `https://nearbyorders.com/`.
- JS is minimal and syntax-checked: mobile nav toggle, IntersectionObserver reveals, category chip select, footer year. No console errors.

## Translating to production

CSS uses variables (`:root` tokens), reusable classes (`.btn`, `.phone`, `.eyebrow`, `.reveal`), and commented section blocks: structured so a developer can port it directly into the production codebase.
