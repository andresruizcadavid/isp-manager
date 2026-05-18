import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();

async function main() {
  // Delete existing admin user
  await prisma.user.deleteMany({
    where: { email: 'admin@demo.com' }
  });
  
  // Create fresh admin user
  const hashedPassword = await bcrypt.hash('password123', 10);
  await prisma.user.create({
    data: {
      name: 'Administrador',
      email: 'admin@demo.com',
      password: hashedPassword,
      role: 'ADMIN'
    }
  });
  console.log('✅ Admin user created fresh');
}

main().catch(console.error).finally(() => prisma.$disconnect());
