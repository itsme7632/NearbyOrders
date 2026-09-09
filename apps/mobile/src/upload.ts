/**
 * Image upload abstraction (product-wide rule).
 *
 * NearbyOrders uses real "Upload image" experiences — never "paste an image
 * URL" fields. This module is the seam between the UI and the future storage
 * provider:
 *
 * - `pickImageFile` + `PickedImage`: real device file selection with preview,
 *   type and size validation. The preview is a local object URL for display
 *   only; it is never persisted and never sent to the API.
 * - `ImageStorageProvider`: the contract a storage backend (S3-compatible
 *   bucket, Supabase Storage, Cloudinary, …) must implement in the dedicated
 *   image-storage phase: consume a `PickedImage`, return a durable public URL.
 * - Until a provider is registered, `getImageStorageProvider()` returns null
 *   and the UI must say so honestly: the user may preview and remove images,
 *   but nothing is uploaded and no fake success is shown. A pending pick that
 *   cannot be persisted is never sent to the API — the existing saved value
 *   (or null) is what gets stored.
 *
 * Remaining integration for the storage phase (docs task):
 *   1. Implement `ImageStorageProvider.upload()` against the chosen provider.
 *   2. Register it with `setImageStorageProvider()` at app start-up.
 *   3. Wire `ImageUploader`'s pending pick through `upload()` in profile save.
 *   4. Add an API endpoint that accepts the returned URL per entity.
 */

/** Hard limits mirrored in the uploader UI; keep in one place for the provider. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Accepted image types (matches what a phone camera/gallery produces). */
export const IMAGE_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** The outcome of a real device file pick, ready for preview. */
export type PickedImage = {
  /** Original file handle — consumed later by `ImageStorageProvider.upload`. */
  file: File;
  /** Local preview URL for the current session only (object URL, never sent). */
  previewUrl: string | null;
  name: string;
  bytes: number;
  type: string;
};

/** Why a picked file was rejected (shown verbatim in the UI). */
export type ImageRejection = { reason: string };

/**
 * Validates and wraps a device file pick. Rejects non-images and oversized
 * files before anything is previewed or stored.
 */
export function pickImageFile(file: File): PickedImage | ImageRejection {
  if (!IMAGE_ACCEPTED_TYPES.includes(file.type as (typeof IMAGE_ACCEPTED_TYPES)[number]))
    return { reason: 'Choose a JPG, PNG or WebP image.' };
  if (file.size > IMAGE_MAX_BYTES) return { reason: 'Images must be 5 MB or smaller.' };
  if (file.size === 0) return { reason: 'That file is empty. Choose a different image.' };
  return { file, previewUrl: createPreviewUrl(file), name: file.name, bytes: file.size, type: file.type };
}

/** Creates a local preview URL; returns null where object URLs are unavailable (tests). */
export function createPreviewUrl(file: File): string | null {
  try {
    return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
  } catch {
    return null;
  }
}

/** Releases a preview URL created by `createPreviewUrl` (no-op in tests). */
export function disposePreviewUrl(url: string | null): void {
  if (!url) return;
  try {
    if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
  } catch {
    // Ignore — previews are session-local by definition.
  }
}

/** The contract the future image-storage phase must implement. */
export interface ImageStorageProvider {
  /** Human-readable provider name for status/debug output. */
  readonly name: string;
  /**
   * Uploads the picked image and resolves with a durable public URL that can
   * be stored on the entity. Implementations must reject (never fake-resolve)
   * when the upload fails.
   */
  upload(image: PickedImage): Promise<{ url: string }>;
}

// No provider is registered until the dedicated image-storage phase. This is
// the single, explicit point to wire one in.
let storageProvider: ImageStorageProvider | null = null;

export function setImageStorageProvider(provider: ImageStorageProvider | null): void {
  storageProvider = provider;
}

export function getImageStorageProvider(): ImageStorageProvider | null {
  return storageProvider;
}

/** Status line the UI shows while no storage provider is connected. */
export const STORAGE_NOT_CONNECTED_NOTICE =
  'Image storage is not connected yet, so this photo can be previewed but not saved with your business.';
