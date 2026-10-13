import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from './lib.js';

type Platform = 'play' | 'apk' | 'ios';

type SettingsRow = {
  google_play_url: string | null;
  direct_apk_url: string | null;
  app_store_url: string | null;
  primary_cta: Platform;
  google_play_enabled: boolean;
  direct_apk_enabled: boolean;
  app_store_enabled: boolean;
  business_onboarding_url: string | null;
  updated_at: Date;
};

const httpsUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => new URL(value).protocol === 'https:', 'URL must use HTTPS')
  .nullable();

const updateSchema = z
  .object({
    googlePlayUrl: httpsUrl,
    directApkUrl: httpsUrl,
    appStoreUrl: httpsUrl,
    primaryCta: z.enum(['play', 'apk', 'ios']),
    googlePlayEnabled: z.boolean(),
    directApkEnabled: z.boolean(),
    appStoreEnabled: z.boolean(),
    businessOnboardingUrl: httpsUrl,
  })
  .strict();

const platformConfig = (row: SettingsRow) => [
  { platform: 'play' as const, url: row.google_play_url, enabled: row.google_play_enabled && Boolean(row.google_play_url) },
  { platform: 'apk' as const, url: row.direct_apk_url, enabled: row.direct_apk_enabled && Boolean(row.direct_apk_url) },
  { platform: 'ios' as const, url: row.app_store_url, enabled: row.app_store_enabled && Boolean(row.app_store_url) },
];

async function getSettings(): Promise<SettingsRow> {
  const rows = await prisma.$queryRaw<SettingsRow[]>`
    SELECT
      google_play_url,
      direct_apk_url,
      app_store_url,
      primary_cta,
      google_play_enabled,
      direct_apk_enabled,
      app_store_enabled,
      business_onboarding_url,
      updated_at
    FROM website_app_settings
    WHERE id = 1
  `;

  if (rows[0]) return rows[0];

  await prisma.$executeRaw`
    INSERT INTO website_app_settings (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `;

  const created = await prisma.$queryRaw<SettingsRow[]>`
    SELECT
      google_play_url,
      direct_apk_url,
      app_store_url,
      primary_cta,
      google_play_enabled,
      direct_apk_enabled,
      app_store_enabled,
      business_onboarding_url,
      updated_at
    FROM website_app_settings
    WHERE id = 1
  `;
  return created[0]!;
}

function publicConfig(row: SettingsRow) {
  return {
    primaryCta: row.primary_cta,
    buttons: platformConfig(row),
    businessOnboardingUrl: row.business_onboarding_url,
    updatedAt: row.updated_at.toISOString(),
  };
}

function validateEnabledState(data: z.infer<typeof updateSchema>): string | null {
  const platforms: Record<Platform, { enabled: boolean; url: string | null }> = {
    play: { enabled: data.googlePlayEnabled, url: data.googlePlayUrl },
    apk: { enabled: data.directApkEnabled, url: data.directApkUrl },
    ios: { enabled: data.appStoreEnabled, url: data.appStoreUrl },
  };
  for (const [platform, config] of Object.entries(platforms)) {
    if (config.enabled && !config.url) return `${platform} must have a URL when enabled`;
  }
  const primary = platforms[data.primaryCta];
  if (!primary.enabled || !primary.url) return 'Primary CTA must point to an enabled platform with a URL';
  return null;
}

export async function registerWebsiteAppLinkRoutes(app: FastifyInstance, roles: (...roles: string[]) => any, currentUser: (request: any) => { id: string }) {
  app.get('/api/v1/website/app-links', async (_q, r) => {
    const row = await getSettings();
    r.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=300');
    return { data: publicConfig(row) };
  });

  app.get('/api/v1/admin/website/app-links', { preHandler: roles('ADMIN') }, async () => {
    const row = await getSettings();
    return { data: publicConfig(row) };
  });

  app.patch('/api/v1/admin/website/app-links', { preHandler: roles('ADMIN') }, async (q, r) => {
    const data = updateSchema.parse(q.body);
    const invalid = validateEnabledState(data);
    if (invalid) return r.status(400).send({ error: { code: 'INVALID_APP_LINK_CONFIG', message: invalid } });

    const rows = await prisma.$queryRaw<SettingsRow[]>`
      INSERT INTO website_app_settings (
        id,
        google_play_url,
        direct_apk_url,
        app_store_url,
        primary_cta,
        google_play_enabled,
        direct_apk_enabled,
        app_store_enabled,
        business_onboarding_url,
        updated_at
      ) VALUES (
        1,
        ${data.googlePlayUrl},
        ${data.directApkUrl},
        ${data.appStoreUrl},
        ${data.primaryCta},
        ${data.googlePlayEnabled},
        ${data.directApkEnabled},
        ${data.appStoreEnabled},
        ${data.businessOnboardingUrl},
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (id) DO UPDATE SET
        google_play_url = EXCLUDED.google_play_url,
        direct_apk_url = EXCLUDED.direct_apk_url,
        app_store_url = EXCLUDED.app_store_url,
        primary_cta = EXCLUDED.primary_cta,
        google_play_enabled = EXCLUDED.google_play_enabled,
        direct_apk_enabled = EXCLUDED.direct_apk_enabled,
        app_store_enabled = EXCLUDED.app_store_enabled,
        business_onboarding_url = EXCLUDED.business_onboarding_url,
        updated_at = CURRENT_TIMESTAMP
      RETURNING
        google_play_url,
        direct_apk_url,
        app_store_url,
        primary_cta,
        google_play_enabled,
        direct_apk_enabled,
        app_store_enabled,
        business_onboarding_url,
        updated_at
    `;

    const updated = rows[0]!;
    const admin = currentUser(q);
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: 'WEBSITE_APP_LINKS_UPDATED',
        entityType: 'WebsiteAppSettings',
        entityId: '1',
        metadata: {
          primaryCta: data.primaryCta,
          googlePlayEnabled: data.googlePlayEnabled,
          directApkEnabled: data.directApkEnabled,
          appStoreEnabled: data.appStoreEnabled,
          hasBusinessOnboardingUrl: Boolean(data.businessOnboardingUrl),
        },
      },
    });

    return r.send({ data: publicConfig(updated) });
  });
}
