import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Ensures a real PostgreSQL is reachable for the API test suite.
 * - If DATABASE_URL is exported (CI), it is used as-is and migrations are applied.
 * - Otherwise a throwaway embedded PostgreSQL (devDependency `embedded-postgres`)
 *   is booted on 127.0.0.1:54330 and used for the run.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

async function waitForPostgres(url: string, timeoutMs = 30_000): Promise<void> {
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
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`PostgreSQL not reachable at ${host}:${port} within ${timeoutMs}ms`);
}

async function runMigrations(url: string): Promise<void> {
  execFileSync(path.resolve(here, '../node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', path.join(here, '../prisma/schema.prisma')], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}

let databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');

  const dataDir = path.resolve(here, '../../.local-dev/test-pgdata');
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

    mkdirSync(dataDir, { recursive: true });
    execFileSync('chown', ['-R', `${osUser}:${osUser}`, path.dirname(dataDir)]);
    const asUser = (file: string, args: string[]) =>
      execFileSync('runuser', ['-u', osUser, '--', file, ...args], { stdio: 'pipe' });

    if (!existsSync(path.join(dataDir, 'PG_VERSION'))) {
      asUser(bin('initdb'), ['-D', dataDir, '-U', user, '-A', 'trust', '-E', 'utf8']);
    }
    if (!existsSync(path.join(dataDir, 'postmaster.pid')) || os.platform() === 'win32') {
      // `-l` detaches the postmaster's stdio; without it execFileSync can hang on the inherited pipe.
      asUser(bin('pg_ctl'), [
        '-D', dataDir,
        '-o', `-p ${port} -k ${path.dirname(dataDir)} -c listen_addresses=127.0.0.1`,
        '-l', path.join(path.dirname(dataDir), 'test-postgres.log'),
        '-w', '-t', '30',
        'start',
      ]);
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
    if (!existsSync(path.join(dataDir, 'PG_VERSION'))) {
      await pg.initialise();
    }
    try {
      await pg.start();
      await pg.createDatabase(user);
    } catch {
      // Already running/created from a previous run in the same session.
    }
    process.on('exit', () => {
      try {
        pg.stop();
      } catch {
        /* already stopped */
      }
    });
    databaseUrl = `postgresql://${user}:unused-local-only@127.0.0.1:${port}/${user}`;
    console.log(`[setup] using embedded PostgreSQL at 127.0.0.1:${port}`);
  }
}

process.env.DATABASE_URL = databaseUrl;
await waitForPostgres(databaseUrl);
await runMigrations(databaseUrl);
console.log('[setup] migrations applied');
