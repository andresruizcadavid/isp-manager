import { Router } from 'express';
import { prisma } from '../config/database.js';
import { requireAdmin } from '../middleware/auth.middleware.js';

const router = Router();

// GET all plans
router.get('/', async (req, res) => {
  try {
    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: plans });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST create plan
router.post('/', async (req, res) => {
  try {
    const plan = await prisma.plan.create({ data: req.body });
    res.status(201).json({ success: true, data: plan });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// PUT update plan
router.put('/:id', async (req, res) => {
  try {
    const plan = await prisma.plan.update({
      where: { id: req.params.id },
      data: req.body
    });
    res.json({ success: true, data: plan });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// DELETE plan
router.delete('/:id', async (req, res) => {
  try {
    await prisma.plan.delete({ 
      where: { id: req.params.id } 
    });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

export default router;
