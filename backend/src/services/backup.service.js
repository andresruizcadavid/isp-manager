// MikroTik backup service.
//
// Flow per runBackup(routerId):
//   1. Lookup the router + SSH credentials (sshUser/sshPass fall back to
//      the RouterOS API username/password when not set explicitly).
//   2. Create a RouterBackup row with status='pending' so the UI shows
//      the in-flight operation immediately.
//   3. Open an SSH connection. Run `/export file=<name>` — RouterOS
//      writes <name>.rsc to its filesystem.
//   4. Open SFTP on the same connection and download <name>.rsc to
//      /opt/isp-manager/backups/router-<id>/<ts>.rsc.
//   5. Run `/file remove <name>.rsc` so the router doesn't accumulate
//      junk in /flash.
//   6. Update the row: status='success', sizeBytes, completedAt.
//   7. Rotate — keep only the latest N rows + files for this router
//      (N comes from the schedule or defaults to 30).
//
// On any error the row is updated to status='failed' with errorMessage
// and the partial file (if any) is removed from the local disk.

import { Client } from 'ssh2';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';

const BACKUP_ROOT = path.resolve(env.UPLOADS_PATH || '/opt/isp-manager/uploads', '..', 'backups');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function tsLabel(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function sshConfig(router) {
  // Pre-flight: the router needs a reachable IP. We pick the first active
  // route (priority asc) so the SSH attempt mirrors how the API client
  // reaches the box. If routes are empty we fall back to legacy fields.
  const ip = router.routes?.find(r => r.status === 'ACTIVE')?.ip
          || router.routes?.[0]?.ip
          || router.ipAddress
          || router.location;
  if (!ip) throw new Error('Router sin IP/route configurada');
  return {
    host:     ip,
    port:     router.sshPort || 22,
    username: router.sshUser || router.username || 'admin',
    password: router.sshPass || router.password,
    readyTimeout: 15000,
    // RouterOS uses older ciphers/algorithms; let ssh2 negotiate freely.
    algorithms: {
      kex: ['curve25519-sha256','curve25519-sha256@libssh.org','ecdh-sha2-nistp256','ecdh-sha2-nistp384','ecdh-sha2-nistp521','diffie-hellman-group14-sha256','diffie-hellman-group14-sha1','diffie-hellman-group1-sha1'],
      cipher: ['aes128-ctr','aes192-ctr','aes256-ctr','aes128-gcm','aes128-gcm@openssh.com','aes256-gcm','aes256-gcm@openssh.com','aes128-cbc','3des-cbc']
    }
  };
}

/**
 * Run one `.rsc` export against `routerId`. Returns the persisted
 * RouterBackup row.
 *
 * @param {number} routerId
 * @param {object} [opts]
 * @param {'manual'|'cron'} [opts.triggeredBy='manual']
 * @param {string|null}     [opts.userId]
 */
export async function runBackup(routerId, { triggeredBy = 'manual', userId = null } = {}) {
  const router = await prisma.router.findUnique({
    where: { id: routerId },
    include: { routes: { orderBy: { priority: 'asc' } } }
  });
  if (!router) throw new Error('Router no encontrado');

  const routerDir = path.join(BACKUP_ROOT, `router-${routerId}`);
  ensureDir(routerDir);
  const stamp    = tsLabel();
  const fileName = `${stamp}.rsc`;
  const filePath = path.join(routerDir, fileName);
  // Files on RouterOS live in /flash; the `/export file=<name>` command
  // doesn't prefix paths — the name is just the leaf.
  const remoteName = `isp-mgr-${stamp}`;
  const remoteFile = `${remoteName}.rsc`;

  // 1. Persist the in-flight row so the UI sees the attempt immediately.
  const row = await prisma.routerBackup.create({
    data: {
      routerId,
      fileName,
      filePath,
      status: 'pending',
      triggeredBy,
      createdById: userId
    }
  });

  const finish = async (patch) => prisma.routerBackup.update({ where: { id: row.id }, data: patch });

  let conn;
  try {
    conn = new Client();
    await new Promise((resolve, reject) => {
      conn.on('ready', resolve).on('error', reject).connect(sshConfig(router));
    });

    // 2. Trigger the export. RouterOS prints the rendered config to stdout
    //    AND writes it to disk when `file=` is given. We discard stdout —
    //    we only care about the file we'll SFTP down next.
    await new Promise((resolve, reject) => {
      conn.exec(`/export file=${remoteName} compact`, (err, stream) => {
        if (err) return reject(err);
        stream.on('close', () => resolve());
        stream.on('error', reject);
        // Drain stdout/stderr so the channel can close cleanly.
        stream.on('data', () => {});
        stream.stderr.on('data', () => {});
      });
    });
    // RouterOS writes the file asynchronously; wait briefly so SFTP finds it.
    await new Promise(r => setTimeout(r, 800));

    // 3. SFTP download.
    const sizeBytes = await new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) return reject(err);
        const reader = sftp.createReadStream(remoteFile);
        const writer = fs.createWriteStream(filePath);
        let size = 0;
        reader.on('data', (chunk) => { size += chunk.length; });
        reader.on('error', reject);
        writer.on('error', reject);
        writer.on('finish', () => resolve(size));
        reader.pipe(writer);
      });
    });

    if (sizeBytes === 0) throw new Error('Backup vacío (router devolvió 0 bytes)');

    // 4. Cleanup remote file — fire-and-forget. If it fails, the next
    //    backup will overwrite it; not a hard error.
    try {
      await new Promise((resolve) => {
        conn.exec(`/file remove ${remoteFile}`, (err, stream) => {
          if (err) return resolve();
          stream.on('close', resolve).on('error', resolve);
          stream.on('data', () => {});
          stream.stderr.on('data', () => {});
        });
      });
    } catch { /* ignored */ }

    await finish({
      status:      'success',
      sizeBytes,
      completedAt: new Date()
    });

    // 5. Retention: trim oldest beyond N.
    await rotateBackups(routerId);

    return prisma.routerBackup.findUnique({ where: { id: row.id } });
  } catch (e) {
    // Best-effort cleanup of partial file on failure.
    try { await fsp.unlink(filePath); } catch { /* ignored */ }
    await finish({
      status:       'failed',
      errorMessage: String(e?.message || e).slice(0, 500),
      completedAt:  new Date()
    });
    throw e;
  } finally {
    try { conn?.end(); } catch { /* ignored */ }
  }
}

/**
 * Trim RouterBackup rows + their files for one router, keeping only the
 * `keep` most recent successful backups. Failed rows are pruned alongside
 * successes — they have no file on disk anyway.
 */
export async function rotateBackups(routerId, keep = null) {
  if (keep == null) {
    const sched = await prisma.routerBackupSchedule.findUnique({ where: { routerId } });
    keep = sched?.retentionCount ?? 30;
  }
  const rows = await prisma.routerBackup.findMany({
    where: { routerId },
    orderBy: { startedAt: 'desc' }
  });
  const toDelete = rows.slice(keep);
  for (const r of toDelete) {
    try { await fsp.unlink(r.filePath); } catch { /* ignored — file may not exist on failed rows */ }
  }
  if (toDelete.length > 0) {
    await prisma.routerBackup.deleteMany({ where: { id: { in: toDelete.map(r => r.id) } } });
  }
  return toDelete.length;
}

/** Delete one backup row + its file. */
export async function deleteBackup(id) {
  const row = await prisma.routerBackup.findUnique({ where: { id } });
  if (!row) return;
  try { await fsp.unlink(row.filePath); } catch { /* ignored */ }
  await prisma.routerBackup.delete({ where: { id } });
}

/** Read a backup file from disk. Returns { stream, size, fileName }. */
export async function openBackupFile(id) {
  const row = await prisma.routerBackup.findUnique({ where: { id } });
  if (!row) throw new Error('Backup no encontrado');
  if (row.status !== 'success') throw new Error('Backup no completado');
  const stat = await fsp.stat(row.filePath);
  return {
    stream: fs.createReadStream(row.filePath),
    size:   stat.size,
    fileName: row.fileName
  };
}
