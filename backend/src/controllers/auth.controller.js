import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../server.js';
import { env } from '../config/env.js';
import { AppError, asyncHandler } from '../middleware/error.middleware.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

class AuthController {
  login = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    // Find user with password
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        role: true,
        isActive: true,
        createdAt: true
      }
    });

    if (!user) {
      throw new AppError('Credenciales inválidas', 401, 'INVALID_CREDENTIALS');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new AppError('Credenciales inválidas', 401, 'INVALID_CREDENTIALS');
    }

    if (!user.isActive) {
      throw new AppError(
        'Tu cuenta está desactivada. Contacta a un administrador.',
        403,
        'USER_DEACTIVATED'
      );
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN }
    );

    // Store session in database (optional)
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 8); // 8 hours from now

    await prisma.session.create({
      data: {
        token,
        userId: user.id,
        expiresAt
      }
    });

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      success: true,
      data: {
        user: userWithoutPassword,
        token,
        expiresIn: env.JWT_EXPIRES_IN
      }
    });
  });

  register = asyncHandler(async (req, res) => {
    const { email, name, password, role = 'OPERATOR' } = req.body;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      throw new AppError('El email ya está registrado', 409, 'EMAIL_ALREADY_EXISTS');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        role
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true
      }
    });

    res.status(201).json({
      success: true,
      data: {
        user,
        message: 'Usuario creado exitosamente'
      }
    });
  });

  logout = asyncHandler(async (req, res) => {
    const token = req.token;

    if (token) {
      // Remove session from database
      await prisma.session.deleteMany({
        where: { token }
      });
    }

    res.json({
      success: true,
      data: {
        message: 'Sesión cerrada exitosamente'
      }
    });
  });

  getProfile = asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.json({
      success: true,
      data: { user }
    });
  });

  updateProfile = asyncHandler(async (req, res) => {
    const { name, email } = req.body;
    const userId = req.user.id;

    // Check if email is being changed and if it's already taken
    if (email && email !== req.user.email) {
      const existingUser = await prisma.user.findUnique({
        where: { email }
      });

      if (existingUser) {
        throw new AppError('El email ya está registrado', 409, 'EMAIL_ALREADY_EXISTS');
      }
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(name && { name }),
        ...(email && { email })
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.json({
      success: true,
      data: {
        user,
        message: 'Perfil actualizado exitosamente'
      }
    });
  });

  changePassword = asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    // Get user with password
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        password: true
      }
    });

    if (!user) {
      throw new AppError('Usuario no encontrado', 404, 'USER_NOT_FOUND');
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      throw new AppError('Contraseña actual incorrecta', 400, 'INVALID_CURRENT_PASSWORD');
    }

    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedNewPassword
      }
    });

    // Invalidate all sessions except current one
    const currentToken = req.token;
    await prisma.session.deleteMany({
      where: {
        userId,
        token: {
          not: currentToken
        }
      }
    });

    res.json({
      success: true,
      data: {
        message: 'Contraseña cambiada exitosamente'
      }
    });
  });
}

export const authController = new AuthController();
