import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import { z } from 'zod';
import { prisma } from './lib.js';
import { generateCode, hashCode, sendPasswordChangedEmail, sendPasswordResetEmail, sendVerificationEmail, sendWelcomeEmail } from './email.js';
import { registerWebsiteAppLinkRoutes } from './websiteAppLinks.js';

const CODE_TTL_MS = 10 * 60 * 1000;
const MIN_RESEND_INTERVAL_MS = 60 * 1000;

const emailBody = z.object({ email: z.string().email().max(120) });
const codeBody = z.object({ email: z.string().email().max(120), code: z.string().regex(/^\d{6}$/) });
const resetBody = codeBody.extend({ newPassword: z.string().min(12).max(128) });

type AuthCodeType = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';

async function issueCode(type: AuthCodeType, userId: string): Promise<string> {
  const now = new Date();
  const recent = await prisma.authCode.findFirst({
    where: { userId, type, createdAt: { gt: new Date(now.getTime() - MIN_RESEND_INTERVAL_MS) }, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (recent) {
    throw Object.assign(new Error('Please wait before requesting another code'), {
      statusCode: 429,
      publicMessage: 'Please wait a minute before requesting another code.',
    });
  }

  await prisma.authCode.updateMany({ where: { userId, type, consumedAt: null }, data: { consumedAt: now } });
  const code = generateCode();
  await prisma.authCode.create({
    data: { id: randomUUID(), userId, type, codeHash: hashCode(code), expiresAt: new Date(now.getTime() + CODE_TTL_MS) },
  });
  return code;
}

async function findValidCode(type: AuthCodeType, userId: string, code: string) {
  return prisma.authCode.findFirst({
    where: { userId, type, codeHash: hashCode(code), consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function registerEmailAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/auth/verify-email', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (q, r) => {
    const { email, code } = codeBody.parse(q.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return r.status(400).send({ error: { code: 'INVALID_CODE', message: 'Invalid or expired verification code' } });
    if (user.emailVerifiedAt) return { data: { verified: true } };

    const row = await findValidCode('EMAIL_VERIFICATION', user.id, code);
    if (!row) return r.status(400).send({ error: { code: 'INVALID_CODE', message: 'Invalid or expired verification code' } });

    const verified = await prisma.$transaction(async (tx) => {
      const consumed = await tx.authCode.updateMany({
        where: { id: row.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) return false;
      await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
      return true;
    });
    if (!verified) return r.status(400).send({ error: { code: 'INVALID_CODE', message: 'Invalid or expired verification code' } });

    await sendWelcomeEmail({ to: user.email, firstName: user.firstName }).catch((error) => app.log.error(error, 'welcome email delivery failed'));
    return { data: { verified: true } };
  });

  app.post('/api/v1/auth/resend-verification', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (q) => {
    const { email } = emailBody.parse(q.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || user.emailVerifiedAt) return { data: { accepted: true } };
    const code = await issueCode('EMAIL_VERIFICATION', user.id);
    await sendVerificationEmail({ to: user.email, firstName: user.firstName, code, idempotencyKey: `verify/${user.id}/${code}` });
    return { data: { accepted: true } };
  });

  app.post('/api/v1/auth/password-reset/request', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (q) => {
    const { email } = emailBody.parse(q.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user) {
      try {
        const code = await issueCode('PASSWORD_RESET', user.id);
        await sendPasswordResetEmail({ to: user.email, firstName: user.firstName, code, idempotencyKey: `reset/${user.id}/${code}` });
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode !== 429) throw error;
      }
    }
    return { data: { accepted: true } };
  });

  app.post('/api/v1/auth/password-reset/complete', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (q, r) => {
    const { email, code, newPassword } = resetBody.parse(q.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return r.status(400).send({ error: { code: 'INVALID_CODE', message: 'Invalid or expired reset code' } });
    const row = await findValidCode('PASSWORD_RESET', user.id, code);
    if (!row) return r.status(400).send({ error: { code: 'INVALID_CODE', message: 'Invalid or expired reset code' } });

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    const reset = await prisma.$transaction(async (tx) => {
      const consumed = await tx.authCode.updateMany({
        where: { id: row.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) return false;
      await tx.authCode.updateMany({ where: { userId: user.id, type: 'PASSWORD_RESET', consumedAt: null }, data: { consumedAt: new Date() } });
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      return true;
    });
    if (!reset) return r.status(400).send({ error: { code: 'INVALID_CODE', message: 'Invalid or expired reset code' } });

    await sendPasswordChangedEmail({ to: user.email, firstName: user.firstName }).catch((error) => app.log.error(error, 'password-changed email delivery failed'));
    return { data: { reset: true } };
  });

  await registerWebsiteAppLinkRoutes(app, rolesForWebsiteRoutes, currentUserForWebsiteRoutes);
}

// The email-auth registration function already has no authorization helper in its scope.
// These adapters are replaced by the server's auth-aware callbacks through a tiny local
// wrapper below; they are intentionally typed as the narrow function shapes required by
// websiteAppLinks so the website route module stays independent of server internals.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rolesForWebsiteRoutes = (..._roles: string[]) => async (q: any, r: any) => {
  try {
    await q.jwtVerify();
    const user = await prisma.user.findUnique({ where: { id: q.user.id } });
    if (!user || user.isSuspended) return r.status(403).send({ error: { code: 'ACCOUNT_UNAVAILABLE', message: 'Account unavailable' } });
    if (user.role !== 'ADMIN') return r.status(403).send({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    q.currentUser = user;
  } catch {
    return r.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const currentUserForWebsiteRoutes = (q: any) => q.currentUser;
