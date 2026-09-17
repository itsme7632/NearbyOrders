# Admin provisioning (production)

How an operator creates the first (or additional) ADMIN accounts for the Admin
Control Center in **production**. There is no public ADMIN registration: the
API's registration schema accepts only `CUSTOMER` and `BUSINESS_OWNER`, and
every `/api/v1/admin/*` route is guarded server-side by an ADMIN role check.

## What this is not

- **Not a preview/demo account.** The development/preview seed creates
  `demo-admin@nearbyorders.test` (documented in `README.md`) **only** when
  `SEED_DEMO_DATA=1` is set, and `scripts/dev-preview.sh` sets it. Demo
  accounts share a publicly committed password and must never exist in
  production. Production deployments do not set `SEED_DEMO_DATA`, and the seed
  creates no users there.
- **Not automatic.** Nothing in app startup, builds, migrations, CI, or the
  seed invokes provisioning. It runs only when an operator explicitly runs it
  against a database they control.

## The script

`apps/api/scripts/create-admin.ts` (run via `pnpm --filter @nearbyorders/api create-admin`).

It reuses the application's single authentication infrastructure:

- Argon2id password hashing with the exact parameters used by register/login
- The same email/password validation rules as public registration
  (email normalized to lowercase/trimmed; password 12–128 characters)
- The production `User` table via Prisma; the created row always has
  `role: ADMIN`

Security behavior:

- The password is never echoed, logged, or stored in plaintext — only its
  Argon2id hash is written.
- Interactive mode reads the password through a hidden raw-terminal prompt
  with confirmation; nothing appears on screen.
- Non-interactive mode reads `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the
  environment. The values are consumed and never printed.
- If the email already exists, the script **aborts** and writes an
  `ADMIN_INVITE_EXISTS` audit entry. It never changes an existing user's role
  or password — promoting an existing customer/business-owner account is a
  separate, explicit decision made directly in the database by someone who
  already has production database access (and should be recorded in your
  operations log).
- Successful creation writes an `ADMIN_CREATED` audit entry with the acting
  email in its metadata.
- Any failure exits non-zero with a clear message.

## Production workflow

1. **Deploy** the API and database as usual (`prisma migrate deploy` included)
   following `README.md` § Deployment. Do **not** set `SEED_DEMO_DATA`.
2. **Connect** to the production environment with a shell that has the
   production `DATABASE_URL` available (deployment platform console, or your
   secret manager's session). Never put production secrets in the repository,
   documentation, or shell history.
3. **Provide the email securely**, either interactively when prompted or via
   `ADMIN_EMAIL`.
4. **Provide the password securely**: type it at the hidden prompt, or supply
   `ADMIN_PASSWORD` through your platform's secret injection (a one-time
   value). If you set it in a shell, prefix the command so it is not kept in
   history.
5. **Run the script** from the repository root:

   ```sh
   pnpm --filter @nearbyorders/api create-admin
   ```

   Non-interactive equivalent:

   ```sh
   pnpm --filter @nearbyorders/api exec tsx scripts/create-admin.ts
   # with ADMIN_EMAIL / ADMIN_PASSWORD injected by your platform
   ```

6. **Log in** to the Admin Control Center with that email and password. In
   production the panel is served at its own origin/host per your deployment
   topology (`apps/admin` build output behind the same reverse proxy that
   fronts the API).
7. **Verify access**: the dashboard loads with real counts, and the Audit log
   section shows the `ADMIN_CREATED` entry for the new account.

Repeat for additional admins. Each admin gets their own account — sharing one
admin login defeats the audit trail.

## If a password must be rotated

The script never overwrites an existing account, by design. To reset an ADMIN
password, perform an explicit one-row database update (replace the
`passwordHash` with a freshly generated Argon2id hash) under your normal
production change-management process, then verify login. Hashing must use the
same Argon2id parameters as the application (`argon2.hash(password, { type:
argon2.argon2id })`).
