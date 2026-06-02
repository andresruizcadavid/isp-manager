import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { prisma } from '../config/database.js';

const router = Router({ mergeParams: true });

// ── Storage configuration ─────────────────────────────────────────────
// Disk storage under <UPLOADS_PATH>/evidence/. Filenames are random to
// avoid collisions and to keep client names out of the URL.
const evidenceDir = path.resolve(env.UPLOADS_PATH, 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
]);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB hard cap per the spec

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, evidenceDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const id = crypto.randomBytes(12).toString('hex');
    cb(null, `${Date.now()}_${id}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('INVALID_MIME'));
    }
    cb(null, true);
  }
});

// ── Routes ────────────────────────────────────────────────────────────
// Mounted at /api/v1/clients/:id/evidence-photos by app.js

// GET — list all evidence for a client
router.get('/', async (req, res) => {
  try {
    const clientId = req.params.id;
    const photos = await prisma.clientEvidencePhoto.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: photos });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST — upload one or more photos
// multipart/form-data:
//   files: image/* (one or many under field "files")
//   type: installation|support|visit|other (optional, default 'other')
//   description: string (optional)
router.post('/', (req, res, next) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: 'Cada imagen debe pesar máximo 5 MB.'
        });
      }
      if (err.message === 'INVALID_MIME') {
        return res.status(400).json({
          success: false,
          error: 'Solo se permiten archivos de imagen (JPG, PNG, WEBP, HEIC).'
        });
      }
      return res.status(400).json({ success: false, error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const clientId = req.params.id;
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No se recibió ninguna imagen.' });
    }

    // Ensure the client exists; otherwise delete the just-uploaded temp files
    // so we don't leave orphans on disk.
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true }
    });
    if (!client) {
      for (const f of req.files) fs.unlink(f.path, () => {});
      return res.status(404).json({ success: false, error: 'Cliente no encontrado.' });
    }

    const allowedTypes = new Set(['installation', 'support', 'visit', 'other']);
    const type = allowedTypes.has(req.body?.type) ? req.body.type : 'other';
    const description = (req.body?.description || '').trim() || null;
    const technicianId = req.user?.id || null;

    const records = [];
    for (const f of req.files) {
      const record = await prisma.clientEvidencePhoto.create({
        data: {
          clientId,
          technicianId,
          type,
          description,
          fileUrl:  `/uploads/evidence/${path.basename(f.path)}`,
          fileName: f.originalname || null,
          mimeType: f.mimetype || null,
          sizeBytes: f.size || null
        }
      });
      records.push(record);
    }

    res.status(201).json({ success: true, data: records });
  } catch (e) {
    // If DB write fails after multer saved the files, clean them up.
    if (req.files) for (const f of req.files) fs.unlink(f.path, () => {});
    console.error('[evidence.upload] failed:', e);
    res.status(500).json({ success: false, error: 'No se pudieron guardar las evidencias.' });
  }
});

// DELETE — remove a single photo (DB row + file on disk)
router.delete('/:photoId', async (req, res) => {
  try {
    const { id: clientId, photoId } = req.params;
    const photo = await prisma.clientEvidencePhoto.findUnique({ where: { id: photoId } });
    if (!photo || photo.clientId !== clientId) {
      return res.status(404).json({ success: false, error: 'Evidencia no encontrada.' });
    }

    await prisma.clientEvidencePhoto.delete({ where: { id: photoId } });

    // Best-effort: remove file from disk. fileUrl looks like /uploads/evidence/x.jpg
    const filename = path.basename(photo.fileUrl || '');
    if (filename) {
      const fullPath = path.join(evidenceDir, filename);
      fs.unlink(fullPath, () => {});
    }
    res.json({ success: true });
  } catch (e) {
    console.error('[evidence.delete] failed:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
