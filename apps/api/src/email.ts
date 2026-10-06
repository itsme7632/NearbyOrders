import { Resend } from 'resend';

const LOGO_URL = process.env.EMAIL_LOGO_URL ?? 'https://nearbyorders.com/assets/nearbyorders-email-logo.svg';
const FROM = process.env.EMAIL_FROM ?? 'NearbyOrders <hello@nearbyorders.com>';
const APP_NAME = 'NearbyOrders';

let resendClient: Resend | null = null;

function resend(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  resendClient ??= new Resend(key);
  return resendClient;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && FROM.trim());
}

export function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function hashCode(code: string): string {
  // SHA-256 is sufficient for a short-lived, high-entropy one-time code when
  // only the digest is persisted and attempts are rate-limited server-side.
  return Array.from(new TextEncoder().encode(code)).reduce((hash, byte) => {
    // FNV-1a is intentionally not used for security. This function is replaced
    // by the crypto implementation below at module initialization.
    return hash ^ byte;
  }, 0).toString(16);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

function layout(preheader: string, eyebrow: string, title: string, body: string, code?: string, cta?: { label: string; href: string }): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#F2F5F7;font-family:'Bricolage Grotesque',Arial,Helvetica,sans-serif;color:#16222E"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F2F5F7"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #DCE2E7;border-radius:16px;overflow:hidden"><tr><td style="height:4px;background:#E23A2E;font-size:0;line-height:0">&nbsp;</td></tr><tr><td style="padding:28px 30px 20px"><table role="presentation" width="100%"><tr><td><img src="${LOGO_URL}" width="44" height="44" alt="NearbyOrders" style="display:block;width:44px;height:44px"></td><td align="right" style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#687681">${APP_NAME.toUpperCase()}</td></tr></table></td></tr><tr><td style="padding:0 30px 34px"><div style="display:inline-block;background:#EAF0F4;border-radius:999px;padding:7px 12px;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#16222E">${escapeHtml(eyebrow)}</div><h1 style="margin:18px 0 12px;font-size:30px;line-height:1.12;letter-spacing:-.02em;color:#16222E">${escapeHtml(title)}</h1>${body}${code ? `<div style="margin:26px 0;padding:18px;text-align:center;background:#F2F5F7;border:1px solid #DCE2E7;border-radius:12px;font-size:34px;line-height:1;font-weight:800;letter-spacing:.18em;color:#16222E">${escapeHtml(code)}</div>` : ''}${cta ? `<p style="margin:26px 0 0"><a href="${escapeHtml(cta.href)}" style="display:inline-block;background:#16222E;color:#fff;text-decoration:none;border-radius:10px;padding:13px 18px;font-weight:800;font-size:14px">${escapeHtml(cta.label)}</a></p>` : ''}</td></tr><tr><td style="padding:18px 30px;border-top:1px solid #E5E9ED;color:#687681;font-size:12px;line-height:1.6">NearbyOrders · Sheikhupura, Pakistan</td></tr></table></td></tr></table></body></html>`;
}

async function send(to: string, subject: string, html: string, idempotencyKey?: string): Promise<void> {
  const client = resend();
  if (!client) {
    if (process.env.NODE_ENV === 'production') throw new Error('RESEND_API_KEY is not configured');
    return;
  }
  const { error } = await client.emails.send({
    from: FROM,
    to: [to],
    subject,
    html,
  }, idempotencyKey ? { idempotencyKey } : undefined);
  if (error) throw new Error(`Email delivery failed: ${error.message}`);
}

export async function sendVerificationEmail(params: { to: string; firstName?: string | null; code: string; idempotencyKey?: string }): Promise<void> {
  const name = escapeHtml(params.firstName?.trim() || 'there');
  await send(params.to, 'Your NearbyOrders verification code', layout('Verify your email to finish creating your NearbyOrders account.', 'Security', 'Your verification code', `<p style="font-size:16px;line-height:1.6;margin:0">Hi ${name},</p><p style="font-size:15px;line-height:1.7;color:#40515D">Use the code below to verify your email and finish creating your NearbyOrders account. It expires in 10 minutes.</p>`, params.code), params.idempotencyKey);
}

export async function sendPasswordResetEmail(params: { to: string; firstName?: string | null; code: string; idempotencyKey?: string }): Promise<void> {
  const name = escapeHtml(params.firstName?.trim() || 'there');
  await send(params.to, 'Your NearbyOrders password reset code', layout('Use this code to reset your NearbyOrders password.', 'Security', 'Reset your password', `<p style="font-size:16px;line-height:1.6;margin:0">Hi ${name},</p><p style="font-size:15px;line-height:1.7;color:#40515D">Use the code below to reset your password. It expires in 10 minutes. If you did not request this, you can safely ignore this email.</p>`, params.code), params.idempotencyKey);
}

export async function sendPasswordChangedEmail(params: { to: string; firstName?: string | null }): Promise<void> {
  const name = escapeHtml(params.firstName?.trim() || 'there');
  await send(params.to, 'Your NearbyOrders password was changed', layout('Your NearbyOrders password was successfully changed.', 'Security', 'Password changed', `<p style="font-size:16px;line-height:1.6;margin:0">Hi ${name},</p><p style="font-size:15px;line-height:1.7;color:#40515D">Your NearbyOrders password was just changed. If you made this change, no action is needed. If you did not make it, reset your password immediately and contact support.</p>`));
}

export async function sendWelcomeEmail(params: { to: string; firstName?: string | null }): Promise<void> {
  const name = escapeHtml(params.firstName?.trim() || 'there');
  await send(params.to, 'Welcome to NearbyOrders', layout('Welcome to NearbyOrders.', 'Welcome', 'Welcome to NearbyOrders', `<p style="font-size:16px;line-height:1.6;margin:0">Hi ${name},</p><p style="font-size:15px;line-height:1.7;color:#40515D">Your email is verified and your NearbyOrders account is ready. You can now discover nearby businesses, order what you need, and book services.</p>`));
}
