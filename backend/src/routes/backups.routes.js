// Backup routes — admin-tier only (backups contain credentials).

import { Router } from 'express';
import { backupsController } from '../controllers/backups.controller.js';

const router = Router();

// Backups
router.get('/',                  backupsController.list);
router.get('/schedules',         backupsController.listSchedules);
router.get('/:id',               backupsController.get);
router.get('/:id/download',      backupsController.download);
router.delete('/:id',            backupsController.delete);

router.post('/run/:routerId',    backupsController.run);
router.post('/rotate/:routerId', backupsController.rotate);

router.get('/schedules/:routerId',    backupsController.getSchedule);
router.put('/schedules/:routerId',    backupsController.upsertSchedule);
router.delete('/schedules/:routerId', backupsController.deleteSchedule);

export default router;
