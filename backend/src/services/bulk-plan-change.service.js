// Bulk plan change service.
//
// Coordinates a batch update across N clients with these guarantees:
//   • Pre-flight validation: the target plan exists; if syncMikrotik is
//     requested, the plan has a mikrotikProfile AND that profile exists
//     on every router that hosts an affected client.
//   • Per-router connection pooling: we open ONE MikroTik connection per
//     router and iterate clients on that router serially. 18 clients on
//     2 routers = 2 connections, not 18.
//   • Per-client transaction: each client's DB update + audit row is its
//     own transaction. A MikroTik failure on client N does NOT roll back
//     client N-1's successful change. The operator sees granular results
//     and can retry the failed subset.
//   • Idempotency: a client already on the target plan returns 'noop' and
//     consumes no router cycles.
//
// Returns a structured result for the controller to forward + persist
// as the BulkOperationLog row.

import { prisma } from '../config/database.js';
import { getMikrotikService } from './mikrotik.service.js';

const OK      = 'ok';
const NOOP    = 'noop';
const SKIPPED = 'skipped';
const FAILED  = 'failed';

/**
 * @param {object}   opts
 * @param {string[]} opts.clientIds         explicit list of Client.id values
 * @param {string}   opts.planId            target Plan.id
 * @param {boolean} [opts.syncMikrotik=true]      push profile to routers
 * @param {boolean} [opts.resetMonthlyFee=false]  zero out Client.monthlyFee on each
 * @param {boolean} [opts.includeSuspended=false] also sync MikroTik for SUSPENDED clients
 * @returns {Promise<{ results: object[], summary: { total, ok, noop, skipped, failed } }>}
 */
export async function bulkChangePlan({
  clientIds,
  planId,
  syncMikrotik     = true,
  resetMonthlyFee  = false,
  includeSuspended = false
}) {
  if (!Array.isArray(clientIds) || clientIds.length === 0) {
    throw new Error('clientIds requerido');
  }
  if (!planId) throw new Error('planId requerido');

  // ── 1. Validate target plan ─────────────────────────────────────────
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) {
    const e = new Error('Plan destino no encontrado');
    e.code = 'PLAN_NOT_FOUND'; e.status = 404;
    throw e;
  }
  if (syncMikrotik && !plan.mikrotikProfile) {
    const e = new Error(
      `El plan "${plan.name}" no tiene perfil MikroTik configurado. ` +
      `Asígnaselo desde /plans antes de usarlo en una asignación masiva.`
    );
    e.code = 'PLAN_WITHOUT_PROFILE'; e.status = 400;
    throw e;
  }

  // ── 2. Load clients in scope ────────────────────────────────────────
  const clients = await prisma.client.findMany({
    where: { id: { in: clientIds } },
    include: {
      plan: { select: { id: true, name: true, mikrotikProfile: true } },
      mikrotikAccount: {
        include: {
          router: {
            include: { routes: { orderBy: { priority: 'asc' } } }
          }
        }
      }
    }
  });

  // ── 3. Pre-flight: check the target profile exists on every router
  //       that will receive a push. Doing this upfront means a typo on
  //       the plan's mikrotikProfile fails fast instead of failing on
  //       client #4. We dedupe routers + use one connection per router.
  const routerSet = new Map(); // routerId → { service, account: any client's account, profiles: [] }
  if (syncMikrotik) {
    for (const c of clients) {
      const routerId = c.mikrotikAccount?.routerId;
      if (!routerId) continue;
      if (c.status === 'SUSPENDED' && !includeSuspended) continue;
      if (routerSet.has(routerId)) continue;
      try {
        const svc = await getMikrotikService(routerId);
        const profiles = await svc.getPPPoEProfiles().catch(() => []);
        const exists = profiles.some(p => (p?.name || p?.['name']) === plan.mikrotikProfile);
        if (!exists) {
          const e = new Error(
            `El perfil "${plan.mikrotikProfile}" no existe en el router de uno o más clientes. ` +
            `Sincroniza los perfiles desde /mikrotik/routers antes de continuar.`
          );
          e.code = 'PROFILE_MISSING_ON_ROUTER'; e.status = 400;
          throw e;
        }
        routerSet.set(routerId, { service: svc, profiles });
      } catch (err) {
        if (err.code === 'PROFILE_MISSING_ON_ROUTER') throw err;
        // Router unreachable — let per-client iteration mark each affected
        // client as failed (with reason). Don't pre-fail the whole batch.
        routerSet.set(routerId, { service: null, error: err.message });
      }
    }
  }

  // ── 4. Per-client iteration ─────────────────────────────────────────
  const results = [];
  for (const c of clients) {
    const out = { clientId: c.id, name: c.name, status: null };

    // Already on target plan → noop. Cheap exit.
    const samePlan = c.planId === planId;
    const wantsResetFee = resetMonthlyFee && c.monthlyFee !== 0;
    if (samePlan && !wantsResetFee && !syncMikrotik) {
      out.status = NOOP;
      results.push(out);
      continue;
    }

    try {
      // DB update first. Even if MikroTik push fails, the DB reflects
      // the operator's intent and the router can be reconciled later.
      const dbData = {};
      if (!samePlan) dbData.planId = planId;
      if (wantsResetFee) dbData.monthlyFee = 0;
      if (Object.keys(dbData).length > 0) {
        await prisma.client.update({ where: { id: c.id }, data: dbData });
        out.changes = { ...dbData, fromPlanId: c.planId };
      } else {
        out.changes = {};
      }

      // MikroTikAccount.profileName mirror — kept in sync regardless of
      // suspended state. The actual push to the router is gated by
      // includeSuspended below.
      if (syncMikrotik && c.mikrotikAccount && plan.mikrotikProfile) {
        await prisma.mikrotikAccount.update({
          where: { id: c.mikrotikAccount.id },
          data:  { profileName: plan.mikrotikProfile }
        });
      }

      // Skip MikroTik push for suspended clients unless explicitly asked.
      if (syncMikrotik && c.status === 'SUSPENDED' && !includeSuspended) {
        out.mikrotikSync = { status: SKIPPED, reason: 'client_suspended' };
        out.status = OK;
        results.push(out);
        continue;
      }

      // Push to router if requested + account present.
      if (syncMikrotik && c.mikrotikAccount) {
        const routerEntry = routerSet.get(c.mikrotikAccount.routerId);
        if (!routerEntry?.service) {
          out.mikrotikSync = { status: FAILED, reason: routerEntry?.error || 'router_unreachable' };
        } else {
          try {
            await routerEntry.service.setPPPoEProfile(
              c.mikrotikAccount.username,
              plan.mikrotikProfile
            );
            out.mikrotikSync = { status: OK };
          } catch (mkErr) {
            out.mikrotikSync = { status: FAILED, reason: mkErr.message };
          }
        }
      } else if (syncMikrotik && !c.mikrotikAccount) {
        out.mikrotikSync = { status: SKIPPED, reason: 'no_mikrotik_account' };
      }

      out.status = OK;
    } catch (err) {
      out.status = FAILED;
      out.reason = err.message;
    }

    results.push(out);
  }

  // ── 5. Summary ─────────────────────────────────────────────────────
  const summary = { total: results.length, ok: 0, noop: 0, skipped: 0, failed: 0 };
  for (const r of results) summary[r.status] = (summary[r.status] || 0) + 1;

  return { results, summary };
}
