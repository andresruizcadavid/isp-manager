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
  
  // WhatsApp
  WHATSAPP_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_ID: z.string().min(1),
  WHATSAPP_VERSION: z.string().default('v18.0'),
  
  // Twilio
  TWILIO_SID: z.string().min(1),
  TWILIO_AUTH: z.string().min(1),
  TWILIO_PHONE: z.string().min(1),
  
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
  
  // Mikrotik
  MIKROTIK_HOST: z.string().min(1),
  MIKROTIK_USER: z.string().min(1),
  MIKROTIK_PASSWORD: z.string().min(1),
  MIKROTIK_PORT: z.string().transform(Number).default('8728'),
  
  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('900000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('100'),
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
