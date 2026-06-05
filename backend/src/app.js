import express        from 'express';
import cors           from 'cors';
import helmet         from 'helmet';
import cookieParser   from 'cookie-parser';
import morgan         from 'morgan';
import path           from 'path';
import { authMiddleware, requireAdmin, requireOperational } from './middleware/auth.middleware.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { globalRateLimiter } from './middleware/rateLimit.middleware.js';
import { env }        from './config/env.js';
import authRoutes     from './routes/auth.routes.js';
import clientRoutes   from './routes/clients.routes.js';
import zoneRoutes     from './routes/zones.routes.js';
import planRoutes     from './routes/plans.routes.js';
import routerRoutes   from './routes/routers.routes.js';
import invoiceRoutes  from './routes/invoices.routes.js';
import paymentRoutes, { webhookRouter as paymentWebhookRouter } from './routes/payments.routes.js';
import reportRoutes   from './routes/reports.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import accountsRoutes from './routes/accounts.routes.js';
import evidenceRoutes from './routes/evidence.routes.js';
import usersRoutes from './routes/users.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import smtpRoutes from './routes/smtp.routes.js';
import networkRoutes from './routes/network.routes.js';
import telegramRoutes from './routes/telegram.routes.js';
import whatsappRoutes, { webhookRouter as whatsappWebhookRouter } from './routes/whatsapp.routes.js';
import publicClientUpdatesRoutes from './routes/public.client-updates.routes.js';
import { makeOriginGuard } from './middleware/origin-guard.middleware.js';

const app = express();

// ── Middleware ────────────────────────────────────────────
// CORS allowlist: derived from FRONTEND_URL plus the local Vite dev origins
// so a developer running `npm run dev` against a containerized backend isn't
// blocked. Comma-separated additional origins via CORS_EXTRA_ORIGINS are
// also honored so a staging/preview host can be added without a code change.
const corsAllowlist = [
  env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:5174',
  ...(process.env.CORS_EXTRA_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
];
app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin / curl / health checks (no Origin header).
    if (!origin) return cb(null, true);
    if (corsAllowlist.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true
}));
// Trust Nginx proxy so req.secure reflects X-Forwarded-Proto
app.set('trust proxy', 1);

app.use(helmet({
  // Disable HSTS until HTTPS is configured (browsers enforce it permanently)
  strictTransportSecurity: false
}));
app.use(cookieParser(env.COOKIE_SECRET));
app.use(express.json());
app.use(morgan('dev'));

// ── Auth routes are mounted BEFORE the global rate limiter ──
// They have their own dedicated authRateLimiter (10 req / 15 min).
// Keeping them outside the global limiter ensures that a user blocked
// by the global limit (e.g. heavy API usage) can still log in.
app.use('/api/v1/auth',              authRoutes);

// PUBLIC — customer self-service update flow. No auth: the random token in
// the URL is the credential. Has its own per-token rate limiter.
app.use('/api/v1/public/client-updates', publicClientUpdatesRoutes);

// PUBLIC — payment provider webhooks. Wompi and any future PSP. Auth is
// signature-based inside the controller; MUST NOT sit behind authMiddleware.
app.use('/api/v1/payments/webhooks', paymentWebhookRouter);

// CSRF defense-in-depth: reject mutating cookie-auth requests whose Origin
// doesn't match the allowlist. Bearer-token requests pass through. See the
// middleware file for the threat model.
app.use('/api/', makeOriginGuard(corsAllowlist));

// Global rate limiter for all remaining API routes
app.use('/api/', globalRateLimiter);

// ── Auth middleware imported from middleware/auth.middleware.js ──

// ── Routes ────────────────────────────────────────────────
// Permission tiers (enforced server-side, never trust the client):
//   • requireOperational  → clients, zones, dashboard, evidence (ADMIN + TECHNICIAN)
//   • requireAdmin        → plans, routers, invoices, payments, reports, users,
//                           mikrotik accounts (ADMIN / legacy OPERATOR only)
app.use('/api/v1/zones',             authMiddleware, requireOperational, zoneRoutes);
app.use('/api/v1/clients',           authMiddleware, requireOperational, clientRoutes);
app.use('/api/v1/clients/:id/evidence-photos', authMiddleware, requireOperational, evidenceRoutes);
app.use('/api/v1/dashboard',         authMiddleware, requireOperational, dashboardRoutes);
app.use('/api/v1/plans',             authMiddleware, requireAdmin,       planRoutes);
app.use('/api/v1/mikrotik/routers',  authMiddleware, requireAdmin,       routerRoutes);
app.use('/api/v1/mikrotik/accounts', authMiddleware, requireAdmin,       accountsRoutes);
app.use('/api/v1/invoices',          authMiddleware, requireAdmin,       invoiceRoutes);
app.use('/api/v1/payments',          authMiddleware, requireOperational, paymentRoutes);
app.use('/api/v1/reports',           authMiddleware, requireAdmin,       reportRoutes);
app.use('/api/v1/users',             authMiddleware,                     usersRoutes);
app.use('/api/v1/notifications',     authMiddleware, requireAdmin,       notificationsRoutes);
app.use('/api/v1/smtp',              authMiddleware, requireAdmin,       smtpRoutes);
app.use('/api/v1/network',           authMiddleware, requireOperational, networkRoutes);
app.use('/api/v1/telegram',          authMiddleware, requireAdmin,       telegramRoutes);
// WhatsApp webhook MUST be public (Meta calls it without our auth header).
// Mount it BEFORE the admin router so the path matches first.
app.use('/api/v1/whatsapp/webhook',                                     whatsappWebhookRouter);
app.use('/api/v1/whatsapp',          authMiddleware, requireAdmin,       whatsappRoutes);

// ── Static serving of uploaded files ──────────────────────
// Files are saved under <UPLOADS_PATH> by routes that use multer; expose
// them as plain GET requests under /uploads/* (auth-free so <img> tags work).
app.use('/uploads', express.static(path.resolve(env.UPLOADS_PATH), {
  fallthrough: true,
  maxAge: '7d'
}));

// ── Health check ──────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    message: 'ISP Manager API running',
    timestamp: new Date().toISOString()
  });
});

// ── 404 handler ───────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    error: `Endpoint not found: ${req.method} ${req.path}` 
  });
});

// ── Error handler (from middleware) ────────────────────────
app.use(errorMiddleware);

export default app;
