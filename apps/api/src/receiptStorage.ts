import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/**
 * Receipt file storage (Phase 7B).
 *
 * Payment receipts are REAL uploaded files, not user-typed URLs. The client
 * uploads the picked image to `/subscription/payment-receipts` and receives an
 * opaque storage key (`receipts/<uuid>.<ext>`) that it submits with its
 * payment request. Files are readable only through authorized endpoints
 * (owner of the request / ADMIN) — never a public URL.
 *
 * The on-disk implementation is intentionally the only place that knows where
 * bytes live, so a bucket provider (S3-compatible) can replace it later by
 * re-implementing these two functions.
 */

/** Accepted receipt image types — mirrors the mobile upload abstraction. */
export const RECEIPT_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Same cap as the product-wide image limit. */
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

const EXT_BY_TYPE: Record<(typeof RECEIPT_ACCEPTED_TYPES)[number], string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/** Storage keys are opaque, server-generated and strictly shaped (no traversal). */
export const RECEIPT_KEY_PATTERN = /^receipts\/[a-f0-9-]+\.(jpg|png|webp)$/;

/** Content type for a valid storage key, or null for an unknown key shape. */
export const receiptContentType = (storageKey: string): string | null => {
  if (!RECEIPT_KEY_PATTERN.test(storageKey)) return null;
  const ext = storageKey.slice(storageKey.lastIndexOf('.') + 1);
  return ext === 'jpg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp';
};

const receiptsDir = (): string => process.env.RECEIPTS_DIR ?? path.join(process.cwd(), '.receipts');

/**
 * Persists receipt bytes under a fresh server-generated key. Rejects unknown
 * mimetypes so only validated images ever reach storage.
 */
export async function saveReceipt(bytes: Buffer, mimetype: string): Promise<string> {
  const ext = EXT_BY_TYPE[mimetype as (typeof RECEIPT_ACCEPTED_TYPES)[number]];
  if (!ext) throw Object.assign(new Error('Unsupported receipt image type'), { statusCode: 400, publicMessage: 'Receipts must be JPG, PNG or WebP images.' });
  const key = `receipts/${randomUUID()}${ext}`;
  const target = path.join(receiptsDir(), key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return key;
}

/** Reads receipt bytes for an authorized viewer; null when missing/invalid. */
export async function readReceipt(storageKey: string): Promise<Buffer | null> {
  if (!RECEIPT_KEY_PATTERN.test(storageKey)) return null;
  try {
    return await readFile(path.join(receiptsDir(), storageKey));
  } catch {
    return null;
  }
}
