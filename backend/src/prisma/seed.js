import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Create default admin user
  const hashedPassword = await bcrypt.hash('admin123', 10);
  
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@demo.com' },
    update: {},
    create: {
      email: 'admin@demo.com',
      name: 'Administrador del Sistema',
      password: hashedPassword,
      role: 'ADMIN',
    },
  });

  console.log('✅ Created admin user:', adminUser.email);

  // Create demo zones
  const zone1 = await prisma.zone.upsert({
    where: { name: 'La Estrella' },
    update: {},
    create: {
      name: 'La Estrella',
      description: 'Zona norte de la ciudad',
      color: '#3b82f6',
    },
  });

  const zone2 = await prisma.zone.upsert({
    where: { name: 'Centro' },
    update: {},
    create: {
      name: 'Centro',
      description: 'Zona centro de la ciudad',
      color: '#10b981',
    },
  });

  const zone3 = await prisma.zone.upsert({
    where: { name: 'Sur' },
    update: {},
    create: {
      name: 'Sur',
      description: 'Zona sur de la ciudad',
      color: '#f59e0b',
    },
  });

  console.log('✅ Created zones:', [zone1.name, zone2.name, zone3.name].join(', '));

  // Create demo routers
  const router1 = await prisma.router.create({
    data: {
      name: 'Router Principal',
      ipAddress: '192.168.1.1',
      apiPort: 80,
      apiSslPort: 443,
      useSSL: false,
      username: 'admin',
      password: 'admin123',
      location: 'Torre Centro',
      model: 'CCR1036',
    },
  });

  const router2 = await prisma.router.create({
    data: {
      name: 'Router Secundario',
      ipAddress: '192.168.2.1',
      apiPort: 80,
      apiSslPort: 443,
      useSSL: false,
      username: 'admin',
      password: 'admin123',
      location: 'Torre Norte',
      model: 'RB4011',
    },
  });

  console.log('✅ Created routers:', [router1.name, router2.name].join(', '));

  // Create demo plans
  const basicPlan = await prisma.plan.upsert({
    where: { id: 'basic-plan' },
    update: {},
    create: {
      id: 'basic-plan',
      name: 'Plan Básico',
      description: 'Internet básico para uso residencial',
      price: 35000 * 100, // $35.000 in cents
      monthlyPrice: 35000 * 100, // $35.000 in cents
      downloadSpeed: 5000, // 5 Mbps
      uploadSpeed: 1000, // 1 Mbps
      dataLimit: 100, // 100 GB
    },
  });

  const standardPlan = await prisma.plan.upsert({
    where: { id: 'standard-plan' },
    update: {},
    create: {
      id: 'standard-plan',
      name: 'Plan Estándar',
      description: 'Internet estándar para uso familiar',
      price: 60000 * 100, // $60.000 in cents
      monthlyPrice: 60000 * 100, // $60.000 in cents
      downloadSpeed: 10000, // 10 Mbps
      uploadSpeed: 2000, // 2 Mbps
      dataLimit: null, // Unlimited
    },
  });

  const premiumPlan = await prisma.plan.upsert({
    where: { id: 'premium-plan' },
    update: {},
    create: {
      id: 'premium-plan',
      name: 'Plan Premium',
      description: 'Internet premium para gamers y streamers',
      price: 100000 * 100, // $100.000 in cents
      monthlyPrice: 100000 * 100, // $100.000 in cents
      downloadSpeed: 20000, // 20 Mbps
      uploadSpeed: 5000, // 5 Mbps
      dataLimit: null, // Unlimited
    },
  });

  console.log('✅ Created plans:', [basicPlan.name, standardPlan.name, premiumPlan.name].join(', '));

  // Create demo clients
  const demoClient1 = await prisma.client.upsert({
    where: { email: 'juan.perez@email.com' },
    update: {},
    create: {
      name: 'Juan Pérez',
      email: 'juan.perez@email.com',
      phone: '3001234567',
      address: 'Cra 50 #45-67',
      neighborhood: 'La Flora',
      city: 'Cali',
      documentType: 'CC',
      documentNumber: '12345678',
      nit: '123456789-0',
      status: 'ACTIVE',
      planId: basicPlan.id,
      zoneId: zone1.id,
      contractDate: new Date(),
      notes: 'Cliente residencial',
    },
  });

  const demoClient2 = await prisma.client.upsert({
    where: { email: 'maria.rodriguez@email.com' },
    update: {},
    create: {
      name: 'María Rodríguez',
      email: 'maria.rodriguez@email.com',
      phone: '3109876543',
      address: 'Clle 24 #67-89',
      neighborhood: 'San Antonio',
      city: 'Cali',
      documentType: 'CC',
      documentNumber: '98765432',
      nit: '987654321-1',
      status: 'ACTIVE',
      planId: standardPlan.id,
      zoneId: zone2.id,
      contractDate: new Date(),
      notes: 'Cliente empresarial',
    },
  });

  console.log('✅ Created demo clients:', [demoClient1.name, demoClient2.name].join(', '));

  // Create demo devices
  await prisma.device.upsert({
    where: { mac: '00:11:22:33:44:55' },
    update: {},
    create: {
      clientId: demoClient1.id,
      mac: '00:11:22:33:44:55',
      ip: '192.168.1.100',
      type: 'router',
      model: 'TP-Link Archer C50',
    },
  });

  await prisma.device.upsert({
    where: { mac: 'AA:BB:CC:DD:EE:FF' },
    update: {},
    create: {
      clientId: demoClient2.id,
      mac: 'AA:BB:CC:DD:EE:FF',
      ip: '192.168.1.101',
      type: 'router',
      model: 'Tenda AC1200',
    },
  });

  console.log('✅ Created demo devices');

  // Create system configurations
  await prisma.systemConfig.createMany({
    data: [
      { key: 'company_name', value: 'Mi ISP SAS', type: 'string' },
      { key: 'company_nit', value: '900.000.000-0', type: 'string' },
      { key: 'company_city', value: 'Cali, Valle del Cauca', type: 'string' },
      { key: 'company_address', value: 'Cr 123 #45-67', type: 'string' },
      { key: 'company_phone', value: '+57 2 555 1234', type: 'string' },
      { key: 'company_email', value: 'contacto@miisp.com', type: 'string' },
      { key: 'invoice_prefix', value: 'INV-', type: 'string' },
      { key: 'invoice_sequence', value: '1', type: 'number' },
      { key: 'tax_rate', value: '19', type: 'number' },
      { key: 'late_fee_rate', value: '10', type: 'number' },
      { key: 'grace_period_days', value: '5', type: 'number' },
    ],
    skipDuplicates: true,
  });

  console.log('✅ Created system configurations');

  console.log('🎉 Database seeding completed successfully!');
  console.log('');
  console.log('📝 Demo credentials:');
  console.log('   Email: admin@demo.com');
  console.log('   Password: admin123');
  console.log('');
  console.log('👥 Demo clients created:');
  console.log(`   - ${demoClient1.name} (${demoClient1.email})`);
  console.log(`   - ${demoClient2.name} (${demoClient2.email})`);
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
