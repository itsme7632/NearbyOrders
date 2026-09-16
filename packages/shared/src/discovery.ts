/**
 * Discovery radius options shared by Explore (list + map) and the owner
 * location picker. One catalog feeds every radius control, so the UI can
 * never offer inconsistent envelopes.
 *
 * The server's own bounds (0 < radiusKm ≤ 50, see nearbyBusinessesQuerySchema
 * in apps/api/src/lib.ts) stay authoritative and continuous; this catalog is
 * the product-facing subset the UI exposes.
 */
export const RADIUS_OPTIONS_KM = [2, 5, 10, 25] as const;

export type RadiusOptionKm = (typeof RADIUS_OPTIONS_KM)[number];

/** Default discovery radius applied everywhere a radius is needed. */
export const DEFAULT_RADIUS_KM: RadiusOptionKm = 25;
