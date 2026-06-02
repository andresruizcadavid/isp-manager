import { config } from 'dotenv';
import { z } from 'zod';

// Load environment variables
config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3001'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('8h'),
  COOKIE_SECRET: z.string().min(32),
  FRONTEND_URL: z.string().url(),
  
  // Wompi
  WOMPI_PUBLIC_KEY: z.string().min(1),
  WOMPI_PRIVATE_KEY: z.string().min(1),
  WOMPI_EVENTS_KEY: z.string().min(1),
  WOMPI_API_URL: z.string().url().default('https://api.wompi.co/v1'),
  
  // Email
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.string().transform(Number).default('587'),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  
  // WhatsApp — real credentials live in the WhatsAppConfig DB row and are
  // hot-reloaded from there (so the operator can rotate tokens without a
  // restart). These env vars are optional bootstrap fallbacks only.
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_ID: z.string().optional(),
  WHATSAPP_VERSION: z.string().default('v18.0'),

  // Twilio — scaffold only. SMS channel not implemented yet; the
  // notification service no-ops when these are missing.
  TWILIO_SID: z.string().optional(),
  TWILIO_AUTH: z.string().optional(),
  TWILIO_PHONE: z.string().optional(),

  // Company
  COMPANY_NAME: z.string().min(1),
  COMPANY_NIT: z.string().min(1),
  COMPANY_CITY: z.string().min(1),
  COMPANY_ADDRESS: z.string().min(1),
  COMPANY_PHONE: z.string().min(1),
  COMPANY_EMAIL: z.string().email(),

  // File Uploads
  UPLOADS_PATH: z.string().default('./uploads'),
  MAX_FILE_SIZE: z.string().transform(Number).default('10485760'),

  // Mikrotik — global default kept for legacy callers. The canonical
  // per-router config now lives in the `routers` table, so these are
  // optional and only consumed when a code path explicitly asks for them.
  MIKROTIK_HOST: z.string().optional(),
  MIKROTIK_USER: z.string().optional(),
  MIKROTIK_PASSWORD: z.string().optional(),
  MIKROTIK_PORT: z.string().transform(Number).default('8728'),
  
  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('900000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('1000'),
});

function validateEnv() {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    console.error('❌ Invalid environment variables:');
    console.error(error.errors);
    process.exit(1);
  }
}

export const env = validateEnv();
export default env;
