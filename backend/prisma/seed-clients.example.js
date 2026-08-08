/**
 * Seed de clientes — PLANTILLA DE EJEMPLO (datos ficticios).
 *
 * El seed real (`seed-clients.js`) contiene datos personales de clientes
 * reales y está en .gitignore — nunca debe subirse al repositorio.
 *
 * Uso:
 *   cp seed-clients.example.js seed-clients.js
 *   # editá CLIENTS, ROUTER_IP y los nombres de zona/plan con tus datos
 *   node prisma/seed-clients.js
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// IP de administración del router MikroTik. Preferí variable de entorno:
// nunca dejes la IP real de un router de producción en el repositorio.
const ROUTER_IP = process.env.MIKROTIK_HOST || '192.168.88.1';

const ZONE_NAME = 'ZONA DE EJEMPLO';
const PLAN_NAME = 'Plan_basico';

const CLIENTS = [
  { name: "Cliente Demo Uno",    pppoe: "0001_cliente_demo_uno",    ip: "172.16.60.3" },
  { name: "Cliente Demo Dos",    pppoe: "0002_cliente_demo_dos",    ip: "172.16.60.4" },
  { name: "Cliente Demo Tres",   pppoe: "0003_cliente_demo_tres",   ip: "172.16.60.5" },
  { name: "Cliente Demo Cuatro", pppoe: "0004_cliente_demo_cuatro", ip: "172.16.60.6" },
  { name: "Cliente Demo Cinco",  pppoe: "0005_cliente_demo_cinco",  ip: "172.16.60.7" },
];

async function main() {
  const zone = await prisma.zone.upsert({
    where:  { name: ZONE_NAME },
    update: {},
    create: { name: ZONE_NAME, color: '#3b82f6' }
  });

  const plan = await prisma.plan.upsert({
    where:  { name: PLAN_NAME },
    update: {},
    create: { name: PLAN_NAME, price: 0, monthlyPrice: 0, downloadSpeed: 10, uploadSpeed: 5 }
  });

  const router = await prisma.router.upsert({
    where:  { name: ZONE_NAME },
    update: {},
    create: {
      name: ZONE_NAME,
      ipAddress: ROUTER_IP,
      apiPort: 80,
      username: process.env.MIKROTIK_USER || 'admin',
      password: process.env.MIKROTIK_PASSWORD || '',
      isActive: true
    }
  });

  let imported = 0, skipped = 0;

  for (const c of CLIENTS) {
    const exists = await prisma.mikrotikAccount.findUnique({
      where: { username: c.pppoe }
    });
    if (exists) { skipped++; continue; }

    await prisma.$transaction(async tx => {
      const client = await tx.client.create({
        data: {
          name:           c.name,
          email:          `${c.pppoe}@imported.local`,
          phone:          '0000000000',
          address:        `Importado - ${ZONE_NAME}`,
          city:           'N/A',
          documentType:   'CC',
          documentNumber: `TEMP-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
          status:         'ACTIVE',
          zoneId:         zone.id,
          planId:         plan.id,
          notes:          `Importado - ${ZONE_NAME}`
        }
      });
      await tx.mikrotikAccount.create({
        data: {
          username:      c.pppoe,
          password:      '',
          remoteAddress: c.ip,
          profileName:   PLAN_NAME,
          status:        'ACTIVE',
          routerId:      router.id,
          clientId:      client.id
        }
      });
    });
    imported++;
  }

  console.log(`Importados: ${imported} | Omitidos: ${skipped}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
