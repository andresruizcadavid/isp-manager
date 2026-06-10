import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../config/database.js';

export const clientAuthMiddleware = async (req, res, next) => {
  try {
    let token = req.signedCookies?.client_token;
    const authHeader = req.headers.authorization;

    if (!token && authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: { code: 'NO_TOKEN', message: 'Token de autenticación requerido' }
      });
    }

    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (decoded.type !== 'client') {
      return res.status(403).json({
        success: false,
        error: { code: 'INVALID_TOKEN_TYPE', message: 'Token no válido para portal de cliente' }
      });
    }

    const session = await prisma.clientSession.findUnique({
      where: { token },
      include: {
        clientUser: {
          include: {
            client: {
              select: {
                id: true, name: true, email: true, phone: true,
                status: true, documentNumber: true, documentType: true,
                planId: true, monthlyFee: true, balance: true,
                address: true, city: true, neighborhood: true,
                createdAt: true
              }
            }
          }
        }
      }
    });

    if (!session || !session.clientUser) {
      return res.status(401).json({
        success: false,
        error: { code: 'SESSION_EXPIRED', message: 'Sesión expirada' }
      });
    }

    if (session.expiresAt < new Date()) {
      await prisma.clientSession.delete({ where: { token } }).catch(() => {});
      return res.status(401).json({
        success: false,
        error: { code: 'SESSION_EXPIRED', message: 'Sesión expirada' }
      });
    }

    if (!session.clientUser.isActive) {
      await prisma.clientSession.deleteMany({
        where: { clientUserId: session.clientUser.id }
      }).catch(() => {});
      return res.status(403).json({
        success: false,
        error: { code: 'ACCOUNT_DISABLED', message: 'Tu cuenta está desactivada' }
      });
    }

    req.client = session.clientUser.client;
    req.clientUser = session.clientUser;
    req.clientToken = token;

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Token inválido o expirado' }
      });
    }
    console.error('Client auth middleware error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'AUTH_ERROR', message: 'Error en autenticación' }
    });
  }
};
