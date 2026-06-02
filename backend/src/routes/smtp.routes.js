import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import nodemailer from 'nodemailer';
import { authMiddleware, requireAdmin } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';

const router = Router();

const createSchema = z.object({
  provider:  z.string().nullish(),
  host:      z.string().min(1, 'host requerido'),
  port:      z.union([z.number(), z.string()]).transform(v => Number(v)),
  secure:    z.boolean().optional(),
  username:  z.string().min(1, 'username requerido'),
  password:  z.string().min(1, 'password requerido'),
  fromEmail: z.string().email('email remitente inválido'),
  fromName:  z.string().nullish(),
  replyTo:   z.string().nullish()
});

const updateSchema = createSchema.extend({
  password: z.string().optional() // empty = keep existing
});

const PUBLIC_FIELDS = {
  id: true, provider: true, host: true, port: true, secure: true,
  username: true, fromEmail: true, fromName: true, replyTo: true,
  isActive: true, isVerified: true, lastTestedAt: true, lastTestResult: true,
  createdAt: true, updatedAt: true
};

// GET — current active config (without password)
router.get('/', async (req, res) => {
  try {
    const config = await prisma.smtpConfig.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      select: PUBLIC_FIELDS
    });
    res.json({ success: true, data: config || null });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST — create a new active config (deactivates any previous one)
router.post('/', validateBody(createSchema), async (req, res) => {
  try {
    await prisma.smtpConfig.updateMany({
      where: { isActive: true },
      data:  { isActive: false }
    });
    const created = await prisma.smtpConfig.create({
      data: {
        provider:  req.body.provider || null,
        host:      req.body.host,
        port:      Number(req.body.port),
        secure:    !!req.body.secure,
        username:  req.body.username,
        password:  req.body.password,
        fromEmail: req.body.fromEmail,
        fromName:  req.body.fromName || 'ISP Manager',
        replyTo:   req.body.replyTo || null,
        isActive:  true,
        isVerified: false
      },
      select: PUBLIC_FIELDS
    });
    notificationService.invalidateTransporter();
    res.status(201).json({ success: true, data: created });
  } catch (e) {
    console.error('[smtp.create] failed:', e);
    res.status(400).json({ success: false, error: e.message });
  }
});

// PUT — update existing config. Empty password keeps current.
router.put('/:id', validateBody(updateSchema), async (req, res) => {
  try {
    const existing = await prisma.smtpConfig.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Config no encontrada' });

    const passwordChanged = !!(req.body.password && req.body.password.trim() !== '');
    const port = Number(req.body.port);
    const secure = !!req.body.secure;

    // Only invalidate "isVerified" if connection-related fields changed.
    const connChanged = req.body.host !== existing.host
                     || port            !== existing.port
                     || secure          !== existing.secure
                     || req.body.username !== existing.username
                     || passwordChanged;

    const data = {
      provider:  req.body.provider || null,
      host:      req.body.host,
      port,
      secure,
      username:  req.body.username,
      fromEmail: req.body.fromEmail,
      fromName:  req.body.fromName || 'ISP Manager',
      replyTo:   req.body.replyTo || null,
      isVerified: connChanged ? false : existing.isVerified
    };
    if (passwordChanged) data.password = req.body.password;

    const updated = await prisma.smtpConfig.update({
      where: { id: req.params.id },
      data,
      select: PUBLIC_FIELDS
    });
    notificationService.invalidateTransporter();
    res.json({ success: true, data: updated });
  } catch (e) {
    console.error('[smtp.update] failed:', e);
    res.status(400).json({ success: false, error: e.message });
  }
});

// POST /test — try a real SMTP connection and send a test email.
// Updates lastTestedAt + lastTestResult on the row if configId is given.
router.post('/test', async (req, res) => {
  const body = req.body || {};
  try {
    let { host, port, secure, username, password, fromEmail, fromName, testEmail, configId } = body;

    // If no password in payload, pull it from the stored config (UI never
    // re-sends the password unless the operator typed a new one).
    if (configId && (!password || password.trim() === '')) {
      const existing = await prisma.smtpConfig.findUnique({ where: { id: configId } });
      if (existing) {
        password = existing.password;
        // Also fill missing connection params from the stored row.
        host      = host      || existing.host;
        port      = port      || existing.port;
        secure    = secure    ?? existing.secure;
        username  = username  || existing.username;
        fromEmail = fromEmail || existing.fromEmail;
        fromName  = fromName  || existing.fromName;
      }
    }

    if (!host || !port || !username || !password || !fromEmail) {
      return res.status(400).json({ success: false, error: 'Configuración SMTP incompleta.' });
    }

    const recipient = testEmail || req.user?.email;
    if (!recipient) {
      return res.status(400).json({ success: false, error: 'Indica un email de prueba (testEmail).' });
    }

    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(port),
      secure: !!secure,
      auth: { user: username, pass: password },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10000,
      greetingTimeout:   10000,
      socketTimeout:     10000
    });

    await transporter.verify();
    const html = renderEmailTemplate({
      icon:  EMAIL_PRESETS.smtp_test.icon,
      title: EMAIL_PRESETS.smtp_test.title,
      body:  'Tu configuración SMTP está funcionando correctamente. Si recibiste este correo, tu servidor está listo para enviar notificaciones.',
      fields: [
        { label: 'Servidor',  value: `${host}:${port}` },
        { label: 'Remitente', value: fromEmail },
        { label: 'Fecha',     value: new Date().toLocaleString('es-CO') }
      ],
      companyName:   fromName || 'ISP Manager',
      companyDomain: (fromEmail || '').split('@')[1]
    });
    const info = await transporter.sendMail({
      from: `"${fromName || 'ISP Manager'}" <${fromEmail}>`,
      to: recipient,
      subject: '✅ Prueba de configuración SMTP — ISP Manager',
      text: `Tu configuración SMTP funciona. Servidor: ${host}:${port}. Remitente: ${fromEmail}.`,
      html
    });

    if (configId) {
      await prisma.smtpConfig.update({
        where: { id: configId },
        data: {
          isVerified: true,
          lastTestedAt: new Date(),
          lastTestResult: `Éxito · enviado a ${recipient}`
        }
      });
    }

    res.json({
      success: true,
      data: { message: `Correo de prueba enviado a ${recipient}`, messageId: info.messageId }
    });
  } catch (e) {
    console.error('[smtp.test] failed:', e.message);
    const msg = e?.message || 'Error desconocido';
    if (body?.configId) {
      try {
        await prisma.smtpConfig.update({
          where: { id: body.configId },
          data: {
            isVerified: false,
            lastTestedAt: new Date(),
            lastTestResult: `Error · ${msg.slice(0, 240)}`
          }
        });
      } catch { /* ignore */ }
    }
    res.status(400).json({ success: false, error: `Error SMTP: ${msg}` });
  }
});

export default router;
