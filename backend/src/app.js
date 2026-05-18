import express        from 'express';
import cors           from 'cors';
import morgan         from 'morgan';
import path           from 'path';
import { authMiddleware, requireAdmin, requireOperational } from './middleware/auth.middleware.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { env }        from './config/env.js';
import authRoutes     from './routes/auth.routes.js';
import clientRoutes   from './routes/clients.routes.js';
import zoneRoutes     from './routes/zones.routes.js';
import planRoutes     from './routes/plans.routes.js';
import routerRoutes   from './routes/routers.routes.js';
import invoiceRoutes  from './routes/invoices.routes.js';
import paymentRoutes  from './routes/payments.routes.js';
import reportRoutes   from './routes/reports.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import accountsRoutes from './routes/accounts.routes.js';
import evidenceRoutes from './routes/evidence.routes.js';
import usersRoutes from './routes/users.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import smtpRoutes from './routes/smtp.routes.js';

const app = express();

// ── Middleware ────────────────────────────────────────────
app.use(cors({
  origin:      ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true
}));
app.use(express.json());
app.use(morgan('dev'));

// ── Auth middleware imported from middleware/auth.middleware.js ──

// ── Routes ────────────────────────────────────────────────
// Permission tiers (enforced server-side, never trust the client):
//   • requireOperational  → clients, zones, dashboard, evidence (ADMIN + TECHNICIAN)
//   • requireAdmin        → plans, routers, invoices, payments, reports, users,
//                           mikrotik accounts (ADMIN / legacy OPERATOR only)
app.use('/api/v1/auth',              authRoutes);
app.use('/api/v1/zones',             authMiddleware, requireOperational, zoneRoutes);
app.use('/api/v1/clients',           authMiddleware, requireOperational, clientRoutes);
app.use('/api/v1/clients/:id/evidence-photos', authMiddleware, requireOperational, evidenceRoutes);
app.use('/api/v1/dashboard',         authMiddleware, requireOperational, dashboardRoutes);
app.use('/api/v1/plans',             authMiddleware, requireAdmin,       planRoutes);
app.use('/api/v1/mikrotik/routers',  authMiddleware, requireAdmin,       routerRoutes);
app.use('/api/v1/mikrotik/accounts', authMiddleware, requireAdmin,       accountsRoutes);
app.use('/api/v1/invoices',          authMiddleware, requireAdmin,       invoiceRoutes);
app.use('/api/v1/payments',          authMiddleware, requireAdmin,       paymentRoutes);
app.use('/api/v1/reports',           authMiddleware, requireAdmin,       reportRoutes);
app.use('/api/v1/users',             authMiddleware,                     usersRoutes);
app.use('/api/v1/notifications',     authMiddleware, requireAdmin,       notificationsRoutes);
app.use('/api/v1/smtp',              authMiddleware, requireAdmin,       smtpRoutes);

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
