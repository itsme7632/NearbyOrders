CREATE TABLE "website_app_settings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "google_play_url" TEXT,
  "direct_apk_url" TEXT,
  "app_store_url" TEXT,
  "primary_cta" TEXT NOT NULL DEFAULT 'play',
  "google_play_enabled" BOOLEAN NOT NULL DEFAULT false,
  "direct_apk_enabled" BOOLEAN NOT NULL DEFAULT false,
  "app_store_enabled" BOOLEAN NOT NULL DEFAULT false,
  "business_onboarding_url" TEXT,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "website_app_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "website_app_settings_singleton_check" CHECK ("id" = 1),
  CONSTRAINT "website_app_settings_primary_check" CHECK ("primary_cta" IN ('play', 'apk', 'ios'))
);

INSERT INTO "website_app_settings" ("id") VALUES (1);