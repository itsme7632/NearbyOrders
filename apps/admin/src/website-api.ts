import { API_BASE, ApiError, getSession } from './api.js';

export type WebsitePlatform = 'play' | 'apk' | 'ios';

export type WebsiteAppLinkConfig = {
  primaryCta: WebsitePlatform;
  buttons: { platform: WebsitePlatform; url: string | null; enabled: boolean }[];
  businessOnboardingUrl: string | null;
  updatedAt: string;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const session = getSession();
  const headers = new Headers(options.headers);
  headers.set('accept', 'application/json');
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (session) headers.set('authorization', `Bearer ${session.accessToken}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the NearbyOrders API.');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    if (response.status === 401) throw new ApiError(401, 'UNAUTHORIZED', error?.message ?? 'Authentication required');
    throw new ApiError(response.status, error?.code ?? 'ERROR', error?.message ?? 'Request failed');
  }
  return payload as T;
}

export const getWebsiteAppLinks = () =>
  request<{ data: WebsiteAppLinkConfig }>('/admin/website/app-links').then((response) => response.data);

export const updateWebsiteAppLinks = (input: {
  googlePlayUrl: string | null;
  directApkUrl: string | null;
  appStoreUrl: string | null;
  primaryCta: WebsitePlatform;
  googlePlayEnabled: boolean;
  directApkEnabled: boolean;
  appStoreEnabled: boolean;
  businessOnboardingUrl: string | null;
}) => request<{ data: WebsiteAppLinkConfig }>('/admin/website/app-links', {
  method: 'PATCH',
  body: JSON.stringify(input),
}).then((response) => response.data);
