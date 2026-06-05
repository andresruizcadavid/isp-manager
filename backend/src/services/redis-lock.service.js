// Small Redis-backed distributed lock for in-process schedulers.
//
// Use case: the network monitor and the router monitor both tick on a
// per-replica setTimeout loop. With multiple backend replicas behind a
// load balancer, every replica would run the sweep — wasted ICMP probes
// and duplicated NetworkEvent rows.
//
// `withLock(key, ttlSec, fn)` runs `fn` only when the current process
// acquires the named lock; otherwise it's a silent no-op. The lock is
// auto-released both on success and on failure, but the TTL is the
// safety net if the process crashes mid-task.
//
// Why ioredis SET NX EX:
//   • Atomic — no race between SETNX + EXPIRE.
//   • ioredis variadic form is exactly what we need.
//
// Why not a heavyweight library (Redlock):
//   • At single-Redis-instance scale, NX+EX is enough.
//   • Redlock targets multi-master Redis topologies; we don't run any.

import crypto from 'crypto';
import { redis } from '../server.js';

const owners = new Map(); // key → instanceId we set (so we don't delete someone else's lock)

export async function acquire(key, ttlSec) {
  const owner = crypto.randomBytes(12).toString('hex');
  // ioredis: redis.set(key, value, 'EX', seconds, 'NX')
  const ok = await redis.set(key, owner, 'EX', Math.max(1, Math.floor(ttlSec)), 'NX');
  if (ok === 'OK') {
    owners.set(key, owner);
    return owner;
  }
  return null;
}

export async function release(key) {
  const owner = owners.get(key);
  if (!owner) return false;
  // Lua so we only delete IF we still own the lock (TTL might have expired
  // and another replica may now own it).
  const script = `
    if redis.call('get', KEYS[1]) == ARGV[1] then
      return redis.call('del', KEYS[1])
    else
      return 0
    end`;
  try {
    const r = await redis.eval(script, 1, key, owner);
    owners.delete(key);
    return r === 1 || r === '1';
  } catch (e) {
    console.warn('[redis-lock] release error:', e.message);
    return false;
  }
}

/**
 * Run `fn` if we win the lock. Returns true if executed, false if another
 * replica is doing it. The lock is released after fn settles, even on
 * exception. TTL is the worst-case max runtime of fn — pick generously.
 */
export async function withLock(key, ttlSec, fn) {
  const owner = await acquire(key, ttlSec);
  if (!owner) return false;
  try {
    await fn();
    return true;
  } finally {
    await release(key);
  }
}
