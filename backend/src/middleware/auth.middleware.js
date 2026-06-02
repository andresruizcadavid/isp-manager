import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../config/database.js';

export const authMiddleware = async (req, res, next) => {
  try {
    // Read token from signed cookie first, then from Authorization header
    let token = req.signedCookies?.token;
    const authHeader = req.headers.authorization;

    if (!token && authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'NO_TOKEN',
          message: 'Token de autenticación requerido'
        }
      });
    }

    // Verify JWT signature/expiration
    jwt.verify(token, env.JWT_SECRET);

    // Validate that the session still exists in DB (logout revokes it)
    const session = await prisma.session.findUnique({
      where: { token },
      include: {
        user: {
          select: {
            id: true, email: true, name: true, role: true,
            isActive: true, createdAt: true
          }
        }
      }
    });

    if (!session || !session.user) {
      return res.status(401).json({
        success: false,
        error: { code: 'SESSION_EXPIRED', message: 'Sesión expirada' }
      });
    }

    if (session.expiresAt < new Date()) {
      await prisma.session.delete({ where: { token } }).catch(() => {});
      return res.status(401).json({
        success: false,
        error: { code: 'SESSION_EXPIRED', message: 'Sesión expirada' }
      });
    }

    // Deactivated users cannot use the system — kill their session.
    if (!session.user.isActive) {
      await prisma.session.deleteMany({ where: { userId: session.user.id } }).catch(() => {});
      return res.status(403).json({
        success: false,
        error: { code: 'USER_DEACTIVATED', message: 'Tu cuenta está desactivada. Contacta a un administrador.' }
      });
    }

    // Attach user to request
    req.user = session.user;
    req.token = token;

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Token inválido'
        }
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Token expirado'
        }
      });
    }

    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_ERROR',
        message: 'Error en autenticación'
      }
    });
  }
};

export const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Usuario no autenticado'
        }
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: 'Permisos insuficientes'
        }
      });
    }

    next();
  };
};

// Role constants. ADMIN+OPERATOR are admin-tier (legacy OPERATOR kept for
// existing rows). TECHNICIAN is the field-user role for operational tasks.
export const ROLES = {
  ADMIN:      'ADMIN',
  OPERATOR:   'OPERATOR',
  TECHNICIAN: 'TECHNICIAN',
  VIEWER:     'VIEWER'
};

// Role-based middleware helpers
export const requireAdmin = requireRole([ROLES.ADMIN, ROLES.OPERATOR]);
export const requireOperatorOrAdmin = requireRole([ROLES.OPERATOR, ROLES.ADMIN]);
// Operational tier: admins + technicians (read + write to clients, evidence)
export const requireOperational = requireRole([ROLES.ADMIN, ROLES.OPERATOR, ROLES.TECHNICIAN]);
// Any authenticated role
export const requireAnyRole = requireRole([ROLES.ADMIN, ROLES.OPERATOR, ROLES.TECHNICIAN, ROLES.VIEWER]);
