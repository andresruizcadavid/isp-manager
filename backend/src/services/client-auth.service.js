import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error.middleware.js';
import { notificationService } from './notification.service.js';

const SALT_ROUNDS = 10;
const TOKEN_BYTES = 32;
const RESET_TTL_MS = 2 * 3600 * 1000;

function randomToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function signJwt(payload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN || '8h' });
}

class ClientAuthService {

  // ── Register password (first-time setup) ──────────────────────────
  async registerPassword(token, password) {
    const resetToken = await prisma.clientResetToken.findUnique({
      where: { token },
      include: { clientUser: { include: { client: true } } }
    });
    if (!resetToken) throw new AppError('Token no encontrado', 404, 'TOKEN_NOT_FOUND');
    if (resetToken.usedAt) throw new AppError('Este enlace ya fue usado', 410, 'TOKEN_ALREADY_USED');
    if (resetToken.expiresAt < new Date()) throw new AppError('El enlace ha expirado', 410, 'TOKEN_EXPIRED');

    const hash = await bcrypt.hash(password, SALT_ROUNDS);

    await prisma.$transaction([
      prisma.clientUser.update({
        where: { id: resetToken.clientUserId },
        data: { passwordHash: hash, isActive: true }
      }),
      prisma.clientResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() }
      })
    ]);

    return { ok: true };
  }

  // ── Login ─────────────────────────────────────────────────────────
  async login(email, password, { ip, userAgent } = {}) {
    const clientUser = await prisma.clientUser.findUnique({
      where: { email },
      include: { client: true }
    });
    if (!clientUser) throw new AppError('Credenciales inválidas', 401, 'INVALID_CREDENTIALS');
    if (!clientUser.isActive) throw new AppError('Cuenta desactivada', 403, 'ACCOUNT_DISABLED');
    if (clientUser.client.status === 'INACTIVE' || clientUser.client.status === 'SUSPENDED') {
      throw new AppError('Cliente no está activo', 403, 'CLIENT_INACTIVE');
    }

    const valid = await bcrypt.compare(password, clientUser.passwordHash);
    if (!valid) throw new AppError('Credenciales inválidas', 401, 'INVALID_CREDENTIALS');

    const token = signJwt({
      clientUserId: clientUser.id,
      clientId: clientUser.clientId,
      email: clientUser.email,
      type: 'client'
    });

    const expiresAt = new Date(Date.now() + 8 * 3600 * 1000);
    await prisma.clientSession.create({
      data: {
        clientUserId: clientUser.id,
        token,
        expiresAt,
        ipAddress: ip || null,
        userAgent: (userAgent || '').slice(0, 500) || null
      }
    });

    await prisma.clientUser.update({
      where: { id: clientUser.id },
      data: { lastLoginAt: new Date(), lastIp: ip || null }
    });

    return {
      token,
      client: {
        id: clientUser.clientId,
        name: clientUser.client.name,
        email: clientUser.email
      }
    };
  }

  // ── Logout ────────────────────────────────────────────────────────
  async logout(token) {
    await prisma.clientSession.deleteMany({ where: { token } });
  }

  // ── Refresh session ───────────────────────────────────────────────
  async refresh(oldToken) {
    const session = await prisma.clientSession.findUnique({
      where: { token: oldToken },
      include: { clientUser: { include: { client: true } } }
    });
    if (!session) throw new AppError('Sesión no encontrada', 401, 'SESSION_NOT_FOUND');
    if (session.expiresAt < new Date()) {
      await prisma.clientSession.delete({ where: { id: session.id } }).catch(() => {});
      throw new AppError('Sesión expirada', 401, 'SESSION_EXPIRED');
    }

    const newToken = signJwt({
      clientUserId: session.clientUser.id,
      clientId: session.clientUser.clientId,
      email: session.clientUser.email,
      type: 'client'
    });

    const expiresAt = new Date(Date.now() + 8 * 3600 * 1000);
    await prisma.$transaction([
      prisma.clientSession.delete({ where: { id: session.id } }),
      prisma.clientSession.create({
        data: {
          clientUserId: session.clientUser.id,
          token: newToken,
          expiresAt,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent
        }
      })
    ]);

    return { token: newToken };
  }

  // ── Forgot password ───────────────────────────────────────────────
  async forgotPassword(email) {
    const clientUser = await prisma.clientUser.findUnique({
      where: { email },
      include: { client: true }
    });
    if (!clientUser) {
      return { ok: true };
    }

    const token = randomToken();
    await prisma.clientResetToken.create({
      data: {
        clientUserId: clientUser.id,
        token,
        expiresAt: new Date(Date.now() + RESET_TTL_MS)
      }
    });

    const resetUrl = `${env.FRONTEND_URL}/portal/reset-password/${token}`;
    try {
      await notificationService.sendEmailRaw({
        to: clientUser.email,
        notifyType: 'PASSWORD_RESET',
        subject: 'Restablece tu contraseña — Internet Online',
        preset: 'general_announcement',
        title: 'Restablece tu contraseña',
        body: `Hola ${clientUser.client.name?.split(/\s+/)[0] || ''},

Recibimos una solicitud para restablecer la contraseña de tu portal de cliente.

Usa el siguiente enlace para crear una nueva contraseña. Este enlace expira en 2 horas.

${resetUrl}

Si no solicitaste este cambio, ignora este mensaje.`
      });
    } catch (e) {
      console.warn('[client-auth] forgot password email failed:', e.message);
    }

    return { ok: true };
  }

  // ── Reset password (with token) ───────────────────────────────────
  async resetPassword(token, password) {
    const resetToken = await prisma.clientResetToken.findUnique({
      where: { token }
    });
    if (!resetToken) throw new AppError('Token no encontrado', 404, 'TOKEN_NOT_FOUND');
    if (resetToken.usedAt) throw new AppError('Este enlace ya fue usado', 410, 'TOKEN_ALREADY_USED');
    if (resetToken.expiresAt < new Date()) throw new AppError('El enlace ha expirado', 410, 'TOKEN_EXPIRED');

    const hash = await bcrypt.hash(password, SALT_ROUNDS);

    await prisma.$transaction([
      prisma.clientUser.update({
        where: { id: resetToken.clientUserId },
        data: { passwordHash: hash }
      }),
      prisma.clientResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() }
      }),
      prisma.clientSession.deleteMany({
        where: { clientUserId: resetToken.clientUserId }
      })
    ]);

    return { ok: true };
  }
}

export const clientAuthService = new ClientAuthService();
