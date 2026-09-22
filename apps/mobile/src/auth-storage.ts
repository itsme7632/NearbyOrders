import { SecureStorage } from '@aparajita/capacitor-secure-storage';

/** Storage key for the auth refresh token. The access token is never stored. */
export const REFRESH_TOKEN_KEY = 'nearbyorders.refreshToken';

/**
 * Minimal contract for the refresh-token store. The default implementation
 * is backed by the Capacitor secure-storage plugin: Android KeyStore /
 * iOS keychain on a real device (never plaintext, never beside the session).
 * The plugin's own web fallback stores unencrypted in localStorage and is
 * for debugging only — production target is the device APK. Tests inject a
 * mock through setRefreshTokenStorage().
 */
export interface RefreshTokenStorage {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string): Promise<void>;
  clearRefreshToken(): Promise<void>;
}

class SecurePluginStorage implements RefreshTokenStorage {
  async getRefreshToken(): Promise<string | null> {
    try {
      const value = await SecureStorage.getItem(REFRESH_TOKEN_KEY);
      return typeof value === 'string' && value.length > 0 ? value : null;
    } catch {
      // No stored token, or the store is unreachable: treat as signed out.
      return null;
    }
  }

  async setRefreshToken(token: string): Promise<void> {
    await SecureStorage.setItem(REFRESH_TOKEN_KEY, token);
  }

  async clearRefreshToken(): Promise<void> {
    try {
      await SecureStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch {
      // Already gone — clearing is idempotent.
    }
  }
}

const defaultStorage: RefreshTokenStorage = new SecurePluginStorage();
let override: RefreshTokenStorage | null = null;

/** Inject a mock storage (tests) — pass null to restore the default. */
export function setRefreshTokenStorage(storage: RefreshTokenStorage | null): void {
  override = storage;
}

export function getRefreshTokenStorage(): RefreshTokenStorage {
  return override ?? defaultStorage;
}
