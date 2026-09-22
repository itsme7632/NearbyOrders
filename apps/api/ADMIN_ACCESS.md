# Admin Access (API)

How to provision and use administrator accounts for the NearbyOrders API.
No test or placeholder accounts are created by any of these commands.

## Provision the first admin

From the repository root:

```bash
pnpm --filter @nearbyorders/api create-admin
```

Or from `apps/api`:

```bash
pnpm exec tsx scripts/create-admin.ts
```

Non-interactive (CI / VPS provisioning):

```bash
ADMIN_EMAIL=ops@yourdomain.com ADMIN_PASSWORD='<strong-password>' pnpm exec tsx scripts/create-admin.ts
```

Safety rules (enforced by the script):

- It refuses to overwrite an existing user and refuses to promote an
  existing non-admin user to admin. If the email already exists, it exits
  with a message stating the existing role — run it with a fresh,
  dedicated admin email instead.
- The password is never printed, logged, or written to disk by the script.
- Every provisioning writes an audit log row (`ADMIN_CREATED`).

## Sign in as admin

`POST /api/v1/auth/login` with the admin email and password returns
`{ data: { accessToken, refreshToken, user } }`. Admin-only routes require
the `ADMIN` role on the access token (`Authorization: Bearer <accessToken>`).

## Admin route groups

- Business review: `GET/PATCH /api/v1/admin/businesses`, `PATCH /api/v1/admin/businesses/:id/verification`
- Verification queue: `/api/v1/admin/verifications` (list, get, approve, reject, request-changes)
- Subscription plans: `/api/v1/admin/subscription/plans` (CRUD; delete blocked while `usageCount > 0`)
- Payment methods: `/api/v1/admin/subscription/payment-methods` (legacy `/api/v1/admin/payment-methods` still works)
- Payment requests: `/api/v1/admin/subscription/payment-requests` (filterable, approve/reject)
- Promotions: `/api/v1/admin/promotions` (CRUD), `/api/v1/admin/promotion-requests` (review)
- Catalog: `/api/v1/admin/categories`, push: `/api/v1/admin/push/*`, audit: `/api/v1/admin/audit-logs`

## Seeding reference data (production)

```bash
# Core categories only (idempotent, never overwrites admin edits)
pnpm --filter @nearbyorders/api prisma:seed:categories
```

The full development seed (`prisma:seed`) also ensures the three
subscription plans exist (`starter`, `nearbyorders-business` → "Growth",
`premium`) without overwriting admin-edited prices.
