import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { authMiddleware, requireAdmin } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { z } from 'zod';

const router = Router();

// Validation schemas
const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Contraseña debe tener al menos 6 caracteres')
});

const registerSchema = z.object({
  email: z.string().email('Email inválido'),
  name: z.string().min(2, 'Nombre debe tener al menos 2 caracteres'),
  password: z.string().min(6, 'Contraseña debe tener al menos 6 caracteres'),
  role: z.enum(['ADMIN', 'OPERATOR', 'VIEWER']).default('OPERATOR')
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Contraseña actual es requerida'),
  newPassword: z.string().min(6, 'Nueva contraseña debe tener al menos 6 caracteres')
});

// Public routes
router.post('/login', validateBody(loginSchema), authController.login);
// /register is admin-only — for general user management use /api/v1/users.
router.post('/register', authMiddleware, requireAdmin, validateBody(registerSchema), authController.register);

// Protected routes
router.post('/logout', authMiddleware, authController.logout);
router.post('/change-password', authMiddleware, validateBody(changePasswordSchema), authController.changePassword);
router.get('/me', authMiddleware, authController.getProfile);
router.put('/profile', authMiddleware, authController.updateProfile);

export default router;
