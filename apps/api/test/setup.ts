import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Ensures a real PostgreSQL is reachable for the API test suite.
 * - If DATABASE_URL is exported (CI), it is used as-is and migrations are applied.
 * - Otherwise a throwaway embedded PostgreSQL (devDependency `embedded-postgres`)
 *   is booted on 127.0.0.1:54330 and used for the run.
 *
 * Vitest runs this setup file once per test file in parallel workers, so all
 * boot operations are serialized with a filesystem lock and re-check whether
 * the server is already up before touching anything.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForPostgres(url: string, timeoutMs = 60_000): Promise<void> {
  const parsed = new URL(url);
  const port = Number(parsed.port || 5432);
  const host = parsed.hostname;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host, port, timeout: 1000 });
      socket.once('connect', () => {
        socket.end();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await sleep(500);
  }
  throw new Error(`PostgreSQL not reachable at ${host}:${port} within ${timeoutMs}ms`);
}

async function runMigrations(url: string): Promise<void> {
  execFileSync(path.resolve(here, '../node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', path.join(here, '../prisma/schema.prisma')], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}

/**
 * Serializes concurrent workers. Returns false immediately if another worker
 * already holds the lock (the caller then waits for readiness instead).
 */
function acquireBootLock(dataDir: string, timeoutMs = 120_000): boolean {
  const lockDir = `${dataDir}.lock`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(lockDir);
      return true;
    } catch {
      if (Date.now() > deadline) throw new Error('Timed out waiting for test PostgreSQL boot lock');
      return false;
    }
  }
}

function releaseBootLock(dataDir: string): void {
  rmSync(`${dataDir}.lock`, { recursive: true, force: true });
}

let databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');

  // here = <root>/apps/api/test → repo root is three levels up.
  const dataDir = path.resolve(here, '../../../.local-dev/test-pgdata');
  const socketDir = path.dirname(dataDir);
  const port = 54330;
  const user = 'nearbyorders_test';

  // The embedded-postgres JS API cannot run as root (PostgreSQL requirement),
  // so in root environments we drive the bundled binaries via runuser instead.
  if (process.getuid?.() === 0) {
    // Locate the native binaries by scanning node_modules/.pnpm up the tree
    // (pnpm hoists to the workspace root in some layouts).
    const nativeDir = (() => {
      let dir = here;
      for (let i = 0; i < 8; i++) {
        const pnpmDir = path.join(dir, 'node_modules/.pnpm');
        if (existsSync(pnpmDir)) {
          const hit = readdirSync(pnpmDir).find((d) => d.startsWith('@embedded-postgres+linux-x64@'));
          if (hit) return path.join(pnpmDir, hit, 'node_modules/@embedded-postgres/linux-x64/native');
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      throw new Error('embedded-postgres native binaries not found; run pnpm install');
    })();
    const bin = (name: string) => path.join(nativeDir, 'bin', name);
    const osUser = process.env.SUDO_USER || process.env.PG_OS_USER || 'daytona';

    if (acquireBootLock(dataDir)) {
      try {
        mkdirSync(dataDir, { recursive: true });
        execFileSync('chown', ['-R', `${osUser}:${osUser}`, socketDir]);
        const asUser = (file: string, args: string[]) => {
          try {
            return execFileSync('runuser', ['-u', osUser, '--', file, ...args], { stdio: 'pipe' });
          } catch (err) {
            const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
            const detail = [e.stdout?.toString(), e.stderr?.toString(), e.message].filter(Boolean).join('\n');
            throw new Error(`${path.basename(file)} failed:\n${detail}`);
          }
        };

        if (!existsSync(path.join(dataDir, 'PG_VERSION'))) {
          asUser(bin('initdb'), ['-D', dataDir, '-U', user, '-A', 'trust', '-E', 'utf8']);
        }
        if (!existsSync(path.join(dataDir, 'postmaster.pid'))) {
          // Remove socket files left behind by a previously killed server; they
          // would otherwise make the new postmaster fail to bind its socket.
          for (const stale of [`.s.PGSQL.${port}`, `.s.PGSQL.${port}.lock`]) {
            rmSync(path.join(socketDir, stale), { force: true });
          }
          // `-l` detaches the postmaster's stdio; without it execFileSync can hang on the inherited pipe.
          asUser(bin('pg_ctl'), [
            '-D', dataDir,
            '-o', `-p ${port} -k ${socketDir} -c listen_addresses=127.0.0.1`,
            '-l', path.join(dataDir, 'test-postgres.log'),
            '-w', '-t', '60',
            'start',
          ]);
        }
      } finally {
        releaseBootLock(dataDir);
      }
    }
    // The minimal binary distribution ships no createdb/psql, so we use the
    // always-present "postgres" database for the throwaway test run.
    databaseUrl = `postgresql://${user}@127.0.0.1:${port}/postgres`;
    console.log(`[setup] using embedded PostgreSQL (root mode) at 127.0.0.1:${port}`);
  } else {
    const pg = new EmbeddedPostgres({
      databaseDir: dataDir,
      user,
      password: 'unused-local-only',
      port,
      persistent: false,
    });
    if (acquireBootLock(dataDir)) {
      try {
        if (!existsSync(path.join(dataDir, 'PG_VERSION'))) {
          await pg.initialise();
        }
        if (!existsSync(path.join(dataDir, 'postmaster.pid'))) {
          for (const stale of [`.s.PGSQL.${port}`, `.s.PGSQL.${port}.lock`]) {
            rmSync(path.join(socketDir, stale), { force: true });
          }
          await pg.start();
        }
        try {
          await pg.createDatabase(user);
        } catch {
          // Already created from a previous run in the same session.
        }
      } finally {
        releaseBootLock(dataDir);
      }
    }
    // Left running across parallel workers and sessions (dev-only, throwaway).
    databaseUrl = `postgresql://${user}:unused-local-only@127.0.0.1:${port}/${user}`;
    console.log(`[setup] using embedded PostgreSQL at 127.0.0.1:${port}`);
  }
}

process.env.DATABASE_URL = databaseUrl;
await waitForPostgres(databaseUrl);
await runMigrations(databaseUrl);
console.log('[setup] migrations applied');
