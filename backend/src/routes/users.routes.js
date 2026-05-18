import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';

const router = Router();
const prisma = new PrismaClient();

const ROLE_ENUM = z.enum(['ADMIN', 'OPERATOR', 'TECHNICIAN', 'VIEWER']);

const createUserSchema = z.object({
  email:    z.string().email('Email inválido'),
  name:     z.string().min(2, 'Nombre debe tener al menos 2 caracteres'),
  password: z.string().min(6, 'Contraseña debe tener al menos 6 caracteres'),
  role:     ROLE_ENUM.default('TECHNICIAN'),
  isActive: z.boolean().optional()
});

const updateUserSchema = z.object({
  email:    z.string().email('Email inválido').optional(),
  name:     z.string().min(2).optional(),
  password: z.string().min(6).optional(),
  role:     ROLE_ENUM.optional(),
  isActive: z.boolean().optional()
});

// All endpoints below require admin (ADMIN or legacy OPERATOR).
// authMiddleware is already applied at the app.use mount.
router.use(requireAdmin);

// GET — list all users
router.get('/', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true, email: true, name: true, role: true,
        isActive: true, createdAt: true, updatedAt: true
      }
    });
    res.json({ success: true, data: users });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST — create a new user
router.post('/', validateBody(createUserSchema), async (req, res) => {
  try {
    const { email, name, password, role, isActive = true } = req.body;
    const dup = await prisma.user.findUnique({ where: { email } });
    if (dup) {
      return res.status(409).json({
        success: false,
        error: 'Ya existe un usuario con ese email.'
      });
    }
    const hashed = await bcrypt.hash(password, 12);
    const created = await prisma.user.create({
      data: { email, name, password: hashed, role, isActive },
      select: {
        id: true, email: true, name: true, role: true,
        isActive: true, createdAt: true, updatedAt: true
      }
    });
    res.status(201).json({ success: true, data: created });
  } catch (e) {
    console.error('[users.create] failed:', e);
    res.status(500).json({ success: false, error: 'No se pudo crear el usuario.' });
  }
});

// PUT — update a user. Self-protection: an admin cannot demote or
// deactivate THEIR OWN account in a single shot (avoid lockout footgun).
router.put('/:id', validateBody(updateUserSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    }

    const isSelf = req.user?.id === id;
    if (isSelf && req.body.role && req.body.role !== existing.role) {
      return res.status(400).json({
        success: false,
        error: 'No puedes cambiar tu propio rol. Pide a otro administrador que lo haga.'
      });
    }
    if (isSelf && req.body.isActive === false) {
      return res.status(400).json({
        success: false,
        error: 'No puedes desactivar tu propia cuenta.'
      });
    }

    if (req.body.email && req.body.email !== existing.email) {
      const dup = await prisma.user.findUnique({ where: { email: req.body.email } });
      if (dup) {
        return res.status(409).json({
          success: false,
          error: 'Ya existe un usuario con ese email.'
        });
      }
    }

    const data = {
      ...(req.body.email    !== undefined && { email:    req.body.email }),
      ...(req.body.name     !== undefined && { name:     req.body.name }),
      ...(req.body.role     !== undefined && { role:     req.body.role }),
      ...(req.body.isActive !== undefined && { isActive: req.body.isActive }),
      ...(req.body.password               && { password: await bcrypt.hash(req.body.password, 12) }),
    };

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true, email: true, name: true, role: true,
        isActive: true, createdAt: true, updatedAt: true
      }
    });

    // If we just deactivated the user, kill their sessions.
    if (req.body.isActive === false) {
      await prisma.session.deleteMany({ where: { userId: id } }).catch(() => {});
    }

    res.json({ success: true, data: updated });
  } catch (e) {
    console.error('[users.update] failed:', e);
    res.status(500).json({ success: false, error: 'No se pudo actualizar el usuario.' });
  }
});

// DELETE — soft-delete by deactivating; full deletion would orphan
// sessions and historic actions. Reject self-delete.
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user?.id === id) {
      return res.status(400).json({
        success: false,
        error: 'No puedes eliminar tu propia cuenta.'
      });
    }
    await prisma.user.update({ where: { id }, data: { isActive: false } });
    await prisma.session.deleteMany({ where: { userId: id } }).catch(() => {});
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
