import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/**
 * Business/product image storage (P1).
 *
 * Business owners upload business logos and product photos through
 * `POST /api/v1/businesses/:id/images`; the server stores the bytes under an
 * opaque server-generated key and the client saves the returned image URL on
 * the business/product (`imageUrl`). Images are readable through the public
 * capability endpoint `GET /api/v1/images/*` — the key is an unguessable
 * UUID, so no auth is needed to render customer-facing listings, but the key
 * shape is strictly validated so the endpoint can never escape the image
 * storage directory (no generic /uploads/* filesystem exposure).
 *
 * This mirrors the receiptStorage pattern: the on-disk implementation is the
 * only place that knows where bytes live, so a bucket provider can replace
 * it later by re-implementing these two functions. Storage lives under an
 * explicit configurable directory (UPLOADS_DIR) — never inside the
 * application build directory and never a bare process.cwd()-relative path
 * in production.
 */

/** Accepted image types — mirrors the mobile upload abstraction. */
export const IMAGE_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Same cap as the product-wide image limit (and the multipart fileSize limit). */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const EXT_BY_TYPE: Record<(typeof IMAGE_ACCEPTED_TYPES)[number], string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/**
 * Storage keys are opaque, server-generated and strictly shaped (no
 * traversal). saveImage only ever generates UUID v4 keys, so the pattern
 * requires the exact v4 layout — not just "36 hex/hyphen characters".
 */
export const IMAGE_KEY_PATTERN =
  /^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;

/** Content type for a valid storage key, or null for an unknown key shape. */
export const imageContentType = (storageKey: string): string | null => {
  if (!IMAGE_KEY_PATTERN.test(storageKey)) return null;
  const ext = storageKey.slice(storageKey.lastIndexOf('.') + 1);
  return ext === 'jpg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp';
};

/** API-relative URL path served by GET /api/v1/images/* for a storage key. */
export const imageUrlForKey = (storageKey: string): string => `/api/v1/images/${storageKey}`;

/**
 * True when the value is a server-generated image URL path (imageUrlForKey
 * output) rather than an arbitrary string. Used to validate `imageUrl` fields
 * without opening them to arbitrary relative paths.
 */
export const isServerImagePath = (value: string): boolean => {
  const prefix = '/api/v1/images/';
  return value.startsWith(prefix) && IMAGE_KEY_PATTERN.test(value.slice(prefix.length));
};

const uploadsDir = (): string => process.env.UPLOADS_DIR ?? path.join(process.cwd(), '.uploads');

/**
 * Persists image bytes under a fresh server-generated key. Rejects unknown
 * mimetypes so only validated images ever reach storage. The original client
 * filename is never trusted as a storage path.
 */
export async function saveImage(bytes: Buffer, mimetype: string): Promise<string> {
  const ext = EXT_BY_TYPE[mimetype as (typeof IMAGE_ACCEPTED_TYPES)[number]];
  if (!ext) throw Object.assign(new Error('Unsupported image type'), { statusCode: 400, publicMessage: 'Images must be JPG, PNG or WebP.' });
  const key = `uploads/${randomUUID()}${ext}`;
  const target = path.join(uploadsDir(), key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return key;
}

/** Reads image bytes for a validated storage key; null when missing/invalid. */
export async function readImage(storageKey: string): Promise<Buffer | null> {
  if (!IMAGE_KEY_PATTERN.test(storageKey)) return null;
  try {
    return await readFile(path.join(uploadsDir(), storageKey));
  } catch {
    return null;
  }
}
