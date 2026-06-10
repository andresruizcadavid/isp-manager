import { Router } from 'express';
import { clientAuthService } from '../services/client-auth.service.js';
import { clientAuthMiddleware } from '../middleware/client-auth.middleware.js';

const router = Router();

// POST /api/v1/client-auth/register-password — first-time password setup
router.post('/register-password', async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'token y password son requeridos' }
      });
    }
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: { code: 'WEAK_PASSWORD', message: 'La contraseña debe tener al menos 6 caracteres' }
      });
    }
    const result = await clientAuthService.registerPassword(token, password);
    res.json({ success: true, data: result });
  } catch (e) { next(e); }
});

// POST /api/v1/client-auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'email y password son requeridos' }
      });
    }
    const ip = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];
    const result = await clientAuthService.login(email, password, { ip, userAgent });

    res.cookie('client_token', result.token, {
      httpOnly: true,
      signed: true,
      sameSite: 'lax',
      maxAge: 8 * 3600 * 1000,
      path: '/'
    });

    res.json({ success: true, data: { client: result.client } });
  } catch (e) { next(e); }
});

// POST /api/v1/client-auth/logout
router.post('/logout', async (req, res, next) => {
  try {
    const token = req.signedCookies?.client_token;
    if (token) {
      await clientAuthService.logout(token);
    }
    res.clearCookie('client_token', { path: '/' });
    res.json({ success: true });
  } catch (e) { next(e); }
});

// POST /api/v1/client-auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const oldToken = req.signedCookies?.client_token;
    if (!oldToken) {
      return res.status(401).json({
        success: false,
        error: { code: 'NO_TOKEN', message: 'No hay sesión activa' }
      });
    }
    const result = await clientAuthService.refresh(oldToken);
    res.cookie('client_token', result.token, {
      httpOnly: true,
      signed: true,
      sameSite: 'lax',
      maxAge: 8 * 3600 * 1000,
      path: '/'
    });
    res.json({ success: true });
  } catch (e) { next(e); }
});

// POST /api/v1/client-auth/forgot-password
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'email es requerido' }
      });
    }
    await clientAuthService.forgotPassword(email);
    res.json({ success: true, message: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña' });
  } catch (e) { next(e); }
});

// POST /api/v1/client-auth/reset-password
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'token y password son requeridos' }
      });
    }
    await clientAuthService.resetPassword(token, password);
    res.json({ success: true, message: 'Contraseña actualizada correctamente' });
  } catch (e) { next(e); }
});

// GET /api/v1/client-auth/me — current client profile
router.get('/me', clientAuthMiddleware, async (req, res) => {
  const { client } = req;
  res.json({
    success: true,
    data: {
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      address: client.address,
      neighborhood: client.neighborhood,
      city: client.city,
      documentType: client.documentType,
      documentNumber: client.documentNumber,
      status: client.status,
      planId: client.planId,
      monthlyFee: client.monthlyFee,
      balance: client.balance,
      memberSince: client.createdAt
    }
  });
});

export default router;
