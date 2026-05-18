import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

router.get('/', async (req, res) => {
  try {
    const { search, status } = req.query;
    const where = {};
    if (search) {
      where.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { client: { name: { contains: search, mode: 'insensitive' } } }
      ];
    }
    if (status) where.status = status;

    const accounts = await prisma.mikrotikAccount.findMany({
      where,
      include: { client: true, router: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: accounts });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const acc = await prisma.mikrotikAccount.findUniqueOrThrow({
      where: { id: Number(req.params.id) },
      include: { client: true, router: true }
    });
    res.json({ success: true, data: acc });
  } catch (e) {
    res.status(404).json({ success: false, error: 'Cuenta no encontrada' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const acc = await prisma.mikrotikAccount.update({
      where: { id: Number(req.params.id) },
      data: { status }
    });
    res.json({ success: true, data: acc });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await prisma.mikrotikAccount.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

export default router;