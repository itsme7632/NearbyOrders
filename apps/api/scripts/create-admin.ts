/**
 * Secure production ADMIN provisioning. Operator-invoked only — nothing in the
 * app, build, migrations, CI, or seed runs this. Public registration keeps
 * rejecting role ADMIN (registerSchema accepts only CUSTOMER | BUSINESS_OWNER).
 *
 * Reuses the repository's single authentication infrastructure — no second
 * hashing or validation implementation:
 *   - Argon2id hashing, identical parameters to register/login
 *   - registerSchema's email/password rules from src/lib.ts
 *   - Prisma User model; role is always created as ADMIN
 *
 * Behavior:
 *   - New email        → ADMIN user is created. Password comes from a hidden
 *                        interactive prompt (never echoed) or, for
 *                        non-interactive runs, ADMIN_EMAIL/ADMIN_PASSWORD env
 *                        vars whose values are never printed.
 *   - Existing email   → ABORTS. The script never silently changes a user's
 *                        role or password: converting an existing customer or
 *                        business owner into an admin must be a separate,
 *                        explicit decision by someone who already has
 *                        production database access. See docs/admin-provisioning.md.
 *
 * Safety:
 *   - The password is never echoed, logged, or stored in plaintext.
 *   - Every run writes an AuditLog entry (ADMIN_CREATED / ADMIN_INVITE_EXISTS)
 *     so provisioning is attributable.
 *   - Exits non-zero on any failure with a clear message.
 *
 * Usage (from apps/api, with DATABASE_URL pointing at the target database —
 * see docs/admin-provisioning.md):
 *   pnpm exec tsx scripts/create-admin.ts
 * Non-interactive:
 *   ADMIN_EMAIL=ops@yourdomain.com ADMIN_PASSWORD=... pnpm exec tsx scripts/create-admin.ts
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stderr } from 'node:process';
import { pathToFileURL } from 'node:url';
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

/** Same email/password rules as public registration; ADMIN is never accepted there. */
const adminCredentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(12).max(128),
});

const prisma = new PrismaClient();

function fail(message: string): never {
  stderr.write(`\n✗ ${message}\n`);
  process.exit(1);
}

/** Reads one line with echo (fine for the email — it is not a secret). */
function readLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stderr, terminal: true });
  return rl.question(prompt).finally(() => rl.close());
}

/**
 * Reads a password in raw terminal mode without echoing it. Characters are
 * collected silently; backspace edits; Ctrl-C cancels. Raw mode is restored
 * in a cleanup handler so the next prompt still works.
 */
function readHiddenPassword(prompt: string): Promise<string> {
  if (!stdin.isTTY) {
    fail('Interactive password entry requires a TTY. Run interactively, or provide ADMIN_EMAIL and ADMIN_PASSWORD (their values are never printed).');
  }
  stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  const chars: string[] = [];
  return new Promise<string>((resolve) => {
    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString()) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          stderr.write('\n');
          resolve(chars.join(''));
          return;
        }
        if (ch === '\x7f' || ch === '\b') {
          chars.pop();
          continue;
        }
        if (ch === '\x03') {
          cleanup();
          stderr.write('\n✗ Cancelled.\n');
          process.exit(130);
        }
        if (ch >= ' ') chars.push(ch);
      }
    };
    stdin.on('data', onData);
  });
}

/** Non-interactive source: env vars are read but their values are never printed. */
function credentialsFromEnv(): { email: string; password: string } | null {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email && !password) return null;
  if (!email || !password) {
    fail('ADMIN_EMAIL and ADMIN_PASSWORD must be provided together (their values are never printed).');
  }
  return { email: email!, password: password! };
}

function validationError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; ');
}

/**
 * Core provisioning operation, exported so tests can exercise it without the
 * CLI surface. The password is accepted only as an argument and is hashed
 * immediately — callers must never log or persist it in plaintext.
 */
export async function createAdminAccount(
  email: string,
  password: string,
): Promise<{ created: boolean; email: string; role: 'ADMIN'; existingRole?: string }> {
  const parsed = adminCredentialsSchema.safeParse({ email, password });
  if (!parsed.success) throw new Error(`Validation failed: ${validationError(parsed.error)}`);

  const exists = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, role: true },
  });
  if (exists) {
    await prisma.auditLog.create({
      data: {
        action: 'ADMIN_INVITE_EXISTS',
        entityType: 'User',
        entityId: exists.id,
        metadata: { email: parsed.data.email, existingRole: exists.role },
      },
    });
    return { created: false, email: parsed.data.email, role: 'ADMIN', existingRole: exists.role };
  }

  // Identical hashing to register/login: argon2id with library defaults.
  const passwordHash = await argon2.hash(parsed.data.password, { type: argon2.argon2id });
  const user = await prisma.user.create({
    data: { email: parsed.data.email, passwordHash, role: 'ADMIN' },
    select: { id: true, email: true, role: true },
  });
  await prisma.auditLog.create({
    data: {
      action: 'ADMIN_CREATED',
      entityType: 'User',
      entityId: user.id,
      metadata: { email: user.email },
    },
  });
  return { created: true, email: user.email, role: user.role as 'ADMIN' };
}

/** CLI flow: gather credentials (hidden prompt or env), then provision. */
async function main(): Promise<void> {
  let email: string;
  let password: string;

  const fromEnv = credentialsFromEnv();
  if (fromEnv) {
    email = fromEnv.email;
    password = fromEnv.password;
  } else if (stdin.isTTY) {
    email = (await readLine('Admin email: ')).trim();
    const first = await readHiddenPassword('Admin password (min 12 chars, input hidden): ');
    const second = await readHiddenPassword('Confirm password: ');
    if (first !== second) fail('Passwords do not match.');
    password = first;
    if (!email) fail('An email is required.');
    if (!password) fail('A password is required.');
  } else {
    fail('No TTY and no ADMIN_EMAIL/ADMIN_PASSWORD provided. Run interactively, or export ADMIN_EMAIL and ADMIN_PASSWORD (their values are never printed).');
  }

  let result: Awaited<ReturnType<typeof createAdminAccount>>;
  try {
    result = await createAdminAccount(email, password);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (result.created) {
    stderr.write(`\n✓ ADMIN user created: ${result.email} (role: ${result.role})\n`);
    stderr.write('  Audit trail: ADMIN_CREATED recorded. Log in to the Admin Control Center now.\n');
  } else {
    fail(
      `A user with email ${result.email} already exists (role: ${result.existingRole}). ` +
        'This script never overwrites an account. Promoting an existing user or resetting its ' +
        'password is a separate, explicit database action — see docs/admin-provisioning.md.',
    );
  }
}

/**
 * Runs the CLI only when this file is the entry point. Imported by tests, the
 * module exports createAdminAccount without touching stdin or exiting.
 */
const invokedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (invokedDirectly) {
  main()
    .then(() => prisma.$disconnect())
    .catch((error: unknown) => {
      stderr.write(`\n✗ Admin provisioning failed: ${error instanceof Error ? error.message : String(error)}\n`);
      void prisma.$disconnect();
      process.exit(1);
    });
}
