/**
 * Seed default notification templates. Idempotent — safe to re-run.
 * Run: `node scripts/seed-notification-templates.js`
 *
 * Variables supported by our renderer (see notification.campaign.service.js):
 *   {{name}} {{email}} {{phone}} {{plan}} {{zone}} {{ip}}
 *   {{balance}} {{dueDate}} {{amount}}
 *
 * Adds (or refreshes by name) one default template:
 *   "Aviso pago próximo a vencer" — EMAIL
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEMPLATES = [
  {
    name: 'Aviso pago próximo a vencer',
    channel: 'EMAIL',
    subject: 'Tu pago de internet está próximo a vencer',
    body:
`Estimado(a) {{name}},

Su pago de internet está próximo a vencer.
Favor de realizar su pago antes de la fecha de corte.

A continuación los detalles:

• Plan: {{plan}}
• Monto pendiente: {{amount}}
• Fecha de vencimiento: {{dueDate}}

Para pagar puede ingresar a su cuenta en línea.

Formas de Pago:
Banco: xxx xxxx

Datos de contacto:
WhatsApp: 323 6329425
Email: contacto@internetonline.co

Horarios de atención:
Lunes a viernes: 8:00 am a 6:00 pm
Sábado: 8:00 am a 6:00 pm

— Equipo internet-online`,
    isActive: true
  },
  {
    name: 'Recordatorio pago WhatsApp',
    channel: 'WHATSAPP',
    subject: null,
    body:
`Hola {{name}} 👋

Tu plan {{plan}} tiene un pago pendiente de {{amount}} con vencimiento el {{dueDate}}.

Para pagar, escríbenos por aquí o llámanos al 323 6329425.

— Equipo internet-online`,
    isActive: true
  }
];

async function main() {
  console.log('🌱 Seeding default notification templates...');
  for (const tpl of TEMPLATES) {
    const existing = await prisma.notificationTemplate.findFirst({
      where: { name: tpl.name }
    });
    if (existing) {
      // Refresh content + ensure it's active, but don't duplicate.
      await prisma.notificationTemplate.update({
        where: { id: existing.id },
        data: { ...tpl }
      });
      console.log(`  ↻ Updated: "${tpl.name}" (${tpl.channel})`);
    } else {
      await prisma.notificationTemplate.create({ data: tpl });
      console.log(`  ✓ Created: "${tpl.name}" (${tpl.channel})`);
    }
  }
  console.log('✅ Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
