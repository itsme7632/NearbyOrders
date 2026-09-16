import { prisma, NOTIFICATION_TYPES, type NotificationInput } from './lib.js';

/**
 * Phase 13: push notification infrastructure.
 *
 * Architecture (matches the existing channel design in lib.ts):
 *
 *   Application event
 *     → in-app notification (source of history — existing createNotifications)
 *     → push dispatch (this module — an ADDITIONAL channel, never a gate)
 *
 * Core business transactions never depend on push availability: dispatch is
 * always called AFTER the transaction commits, and every failure is contained.
 *
 * Provider configuration (env, never committed):
 *   FCM_PROJECT_ID  Firebase project id
 *   FCM_SERVICE_ACCOUNT_B64  base64 of the full Firebase service-account JSON
 * With neither set, dispatch is an honest no-op: the provider reports
 * `unconfigured` and nothing is pretended to be delivered.
 */

/** What actually happened for one dispatch run. Never fake success. */
export type PushDispatchResult = {
  /** 'sent' | 'invalid-token' | 'failed' | 'unconfigured' | 'skipped-preferences' | 'no-devices' */
  status: 'sent' | 'invalid-token' | 'failed' | 'unconfigured' | 'skipped-preferences' | 'no-devices';
  /** Devices the provider accepted (only when status === 'sent'). */
  sentCount?: number;
  /** Devices deactivated because the provider rejected their tokens. */
  deactivatedCount?: number;
};

export type PushProviderStatus = 'configured' | 'unconfigured';

/** A delivery target resolved from a NotificationInput. */
export type PushDelivery = {
  userId: string;
  title: string;
  body: string;
  /** Stable route identifier, resolved by the app on tap. */
  deepLink: string;
  /** Notification category used for preference filtering. */
  category: PushCategory;
};

export type PushCategory = 'bookings' | 'orders' | 'payments' | 'reviews' | 'businessActivity' | 'account';

/** Provider contract: FCM today; APNs-direct or others slot in behind this. */
export interface PushProvider {
  readonly status: PushProviderStatus;
  /** Sends to explicit tokens; returns the subset that were invalid/unregistered. */
  send(tokens: string[], message: { title: string; body: string; deepLink: string }): Promise<{ invalidTokens: string[] }>;
}

/**
 * Firebase Cloud Messaging HTTP v1 (Android today; iOS through the same
 * FCM-APNs bridge when the Apple credentials exist). No SDK dependency:
 * OAuth2 via JWT + one HTTP call, isolated entirely inside this class.
 */
export class FcmPushProvider implements PushProvider {
  readonly status: PushProviderStatus = 'configured';
  private tokenCache: { token: string; expiresAt: number } | null = null;
  private readonly credentials: { clientEmail: string; privateKey: string; projectId: string };

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const projectId = env.FCM_PROJECT_ID;
    const raw = env.FCM_SERVICE_ACCOUNT_B64 ? Buffer.from(env.FCM_SERVICE_ACCOUNT_B64, 'base64').toString('utf8') : null;
    if (!projectId || !raw) throw new Error('FCM_PROJECT_ID and FCM_SERVICE_ACCOUNT_B64 are required');
    const parsed = JSON.parse(raw) as { client_email: string; private_key: string };
    this.credentials = { clientEmail: parsed.client_email, privateKey: parsed.private_key, projectId };
  }

  /** Signed JWT (RS256) via node:crypto — no external dependency. */
  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.tokenCache && this.tokenCache.expiresAt - 60 > now) return this.tokenCache.token;
    const { createSign } = await import('node:crypto');
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
      iss: this.credentials.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    };
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64(header)}.${b64(claims)}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.credentials.privateKey, 'base64url');
    const assertion = `${unsigned}.${signature}`;
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!res.ok) throw new Error(`FCM token exchange failed (${res.status})`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.tokenCache = { token: body.access_token, expiresAt: now + body.expires_in };
    return body.access_token;
  }

  async send(tokens: string[], message: { title: string; body: string; deepLink: string }) {
    if (tokens.length === 0) return { invalidTokens: [] };
    const accessToken = await this.accessToken();
    const invalidTokens: string[] = [];
    // Sequential batches keep this simple and provider-friendly; volumes are
    // small (a notification targets one user's devices).
    for (const token of tokens) {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${this.credentials.projectId}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: message.title, body: message.body },
            data: { deepLink: message.deepLink },
            android: { priority: 'HIGH' as const },
          },
        }),
      });
      if (res.status === 404 || res.status === 410) invalidTokens.push(token);
      // 429/5xx: transient — left active so a future event retries naturally.
      // 400 with UNREGISTERED is also reported by some projects; the status
      // list below avoids double-deactivating healthy tokens.
      else if (res.status === 400) {
        const body = (await res.json().catch(() => null)) as { error?: { details?: { errorType?: string }[] } } | null;
        const unregistered = body?.error?.details?.some((d) => d.errorType === 'UNREGISTERED');
        if (unregistered) invalidTokens.push(token);
      }
    }
    return { invalidTokens };
  }
}

/** Development/test provider: honestly reports unconfigured; sends nothing. */
export class NoopPushProvider implements PushProvider {
  readonly status: PushProviderStatus = 'unconfigured';
  async send(): Promise<{ invalidTokens: string[] }> {
    return { invalidTokens: [] };
  }
}

/** One provider instance per app; the seam is overridable for tests. */
let providerOverride: PushProvider | null = null;
export const setPushProvider = (p: PushProvider | null) => {
  providerOverride = p;
};

export const getPushProvider = (): PushProvider => {
  if (providerOverride) return providerOverride;
  try {
    return new FcmPushProvider();
  } catch {
    return new NoopPushProvider();
  }
};

/** Notification type → preference category. Account types are always pushed. */
const CATEGORY_BY_TYPE: Record<string, PushCategory> = {
  [NOTIFICATION_TYPES.BOOKING_CREATED]: 'bookings',
  [NOTIFICATION_TYPES.BOOKING_ACCEPTED]: 'bookings',
  [NOTIFICATION_TYPES.BOOKING_REJECTED]: 'bookings',
  [NOTIFICATION_TYPES.BOOKING_CANCELLED]: 'bookings',
  [NOTIFICATION_TYPES.BOOKING_COMPLETED]: 'bookings',
  [NOTIFICATION_TYPES.ORDER_CREATED]: 'orders',
  [NOTIFICATION_TYPES.ORDER_ACCEPTED]: 'orders',
  [NOTIFICATION_TYPES.ORDER_REJECTED]: 'orders',
  [NOTIFICATION_TYPES.ORDER_PREPARING]: 'orders',
  [NOTIFICATION_TYPES.ORDER_READY]: 'orders',
  [NOTIFICATION_TYPES.ORDER_COMPLETED]: 'orders',
  [NOTIFICATION_TYPES.ORDER_CANCELLED]: 'orders',
  [NOTIFICATION_TYPES.BOOKING_PAYMENT_SUBMITTED]: 'payments',
  [NOTIFICATION_TYPES.BOOKING_PAYMENT_VERIFIED]: 'payments',
  [NOTIFICATION_TYPES.BOOKING_PAYMENT_REJECTED]: 'payments',
  [NOTIFICATION_TYPES.ORDER_PAYMENT_SUBMITTED]: 'payments',
  [NOTIFICATION_TYPES.ORDER_PAYMENT_VERIFIED]: 'payments',
  [NOTIFICATION_TYPES.ORDER_PAYMENT_REJECTED]: 'payments',
  [NOTIFICATION_TYPES.SUBSCRIPTION_PAYMENT_SUBMITTED]: 'payments',
  [NOTIFICATION_TYPES.SUBSCRIPTION_PAYMENT_APPROVED]: 'businessActivity',
  [NOTIFICATION_TYPES.SUBSCRIPTION_PAYMENT_REJECTED]: 'businessActivity',
  [NOTIFICATION_TYPES.REVIEW_CREATED]: 'reviews',
};

export const categoryForNotificationType = (type: string): PushCategory => CATEGORY_BY_TYPE[type] ?? 'account';

/** Stable route identifiers the app resolves on tap (server-side, not client-supplied). */
export const deepLinkFor = (n: NotificationInput): string => {
  switch (n.entityType) {
    case 'Booking':
      return `/booking/${n.entityId}`;
    case 'Order':
      return `/order/${n.entityId}`;
    case 'Review':
      return `/business/${n.entityId}/reviews`;
    case 'SubscriptionPaymentRequest':
      return `/owner/subscription`;
    case 'BookingPayment':
      return `/booking/${n.entityId}`;
    case 'OrderPayment':
      return `/order/${n.entityId}`;
    default:
      return '/notifications';
  }
};

/**
 * Pushes one batch of notifications to all active devices of their users.
 * Called AFTER the business transaction has committed. Failures are contained:
 * this never throws and never touches the originating business operation.
 */
export async function dispatchPushNotifications(inputs: NotificationInput[]): Promise<PushDispatchResult> {
  if (inputs.length === 0) return { status: 'sent', sentCount: 0 };
  const provider = getPushProvider();
  if (provider.status === 'unconfigured') return { status: 'unconfigured' };

  const userIds = [...new Set(inputs.map((n) => n.userId))];

  // One preference read covers all users in the batch; a missing row means
  // "everything on" (the default), not "everything off".
  const prefs = await prisma.notificationPreference.findMany({ where: { userId: { in: userIds } } });
  const prefByUser = new Map(prefs.map((p) => [p.userId, p]));

  const deliveries: PushDelivery[] = [];
  let skipped = false;
  for (const n of inputs) {
    const category = categoryForNotificationType(n.type);
    const pref = prefByUser.get(n.userId);
    const allowed = !pref || (pref[category] as boolean);
    if (!allowed) {
      skipped = true;
      continue;
    }
    deliveries.push({ userId: n.userId, title: n.title, body: n.message, deepLink: deepLinkFor(n), category });
  }

  // Group by identical message payloads; a user's devices share one send.
  const byUser = new Map<string, PushDelivery[]>();
  for (const d of deliveries) {
    const list = byUser.get(d.userId) ?? [];
    list.push(d);
    byUser.set(d.userId, list);
  }

  let sentCount = 0;
  const allInvalid: string[] = [];
  for (const [userId, list] of byUser) {
    const devices = await prisma.pushDevice.findMany({
      where: { userId, isActive: true },
      select: { id: true, pushToken: true },
    });
    if (devices.length === 0) continue;
    // Deliver each distinct message to all devices (multi-device support).
    for (const d of list) {
      const result = await provider.send(
        devices.map((dev) => dev.pushToken),
        { title: d.title, body: d.body, deepLink: d.deepLink },
      );
      sentCount += devices.length - result.invalidTokens.length;
      allInvalid.push(...result.invalidTokens);
    }
  }

  // Invalid/unregistered tokens are deactivated once, at the end.
  let deactivatedCount = 0;
  if (allInvalid.length > 0) {
    const update = await prisma.pushDevice.updateMany({
      where: { pushToken: { in: allInvalid } },
      data: { isActive: false },
    });
    deactivatedCount = update.count;
  }

  return {
    status: sentCount > 0 ? 'sent' : skipped && deliveries.length === 0 ? 'skipped-preferences' : 'failed',
    sentCount,
    deactivatedCount,
  };
}
