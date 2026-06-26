// One-off, idempotent updater: sets client.email and client.balance from a
// reviewed JSON file. Used for the 2026-06 migration of the old payment
// spreadsheet (correo + deuda) onto matched clients.
//
// The JSON (passed as argv[2]) is an array of:
//   { id, csv_name, db_name, ip, email_old, email_new, balance_old, balance_new }
// - email is updated only when email_new is non-empty AND differs (never
//   overwrites a real email with blank).
// - balance is updated only when balance_new is not null AND differs.
//
// Usage:
//   node scripts/import-client-balance-email.mjs <updates.json>            # DRY (default, no writes)
//   node scripts/import-client-balance-email.mjs <updates.json> --apply    # writes
import { readFileSync } from 'node:fs';
import { prisma } from '../src/config/database.js';

const path  = process.argv[2];
const apply = process.argv.includes('--apply');
if (!path) { console.error('Falta la ruta del JSON de updates'); process.exit(1); }

const rows = JSON.parse(readFileSync(path, 'utf8'));
let mail = 0, bal = 0, missing = 0, noop = 0;
const emailConflicts = [];

for (const r of rows) {
  const c = await prisma.client.findUnique({
    where: { id: r.id },
    select: { id: true, name: true, email: true, balance: true }
  });
  if (!c) { console.log(`  ⚠️ MISSING id=${r.id} (${r.csv_name})`); missing++; continue; }

  const data = {};
  if (r.email_new && r.email_new.toLowerCase() !== (c.email || '').toLowerCase()) data.email = r.email_new;
  if (r.balance_new != null && r.balance_new !== c.balance) data.balance = r.balance_new;
  if (Object.keys(data).length === 0) { noop++; continue; }

  console.log(`  ${apply ? 'APPLY' : 'DRY '} ${c.name.slice(0,24).padEnd(24)} ${JSON.stringify(data)}`);
  if (apply) {
    try {
      await prisma.client.update({ where: { id: c.id }, data });
      if ('email' in data)   mail++;
      if ('balance' in data) bal++;
    } catch (e) {
      // Client.email is @unique. A duplicate email in the source (same owner,
      // several services) collides. Skip just the email, still apply balance,
      // and report it — never abort the whole run.
      if (e.code === 'P2002' && 'email' in data) {
        emailConflicts.push({ name: c.name, email: data.email });
        delete data.email;
        if (Object.keys(data).length > 0) { await prisma.client.update({ where: { id: c.id }, data }); bal++; }
        console.log(`  ⚠️  EMAIL en conflicto (único), omitido: ${c.name} → ${r.email_new}${'balance' in data ? ' (balance sí aplicado)' : ''}`);
      } else { throw e; }
    }
  } else {
    if ('email' in data)   mail++;
    if ('balance' in data) bal++;
  }
}

console.log(`\n${apply ? '✅ APLICADO' : '🔎 DRY-RUN'}: correos=${mail} balances=${bal} sin-cambio=${noop} faltantes=${missing} (de ${rows.length})`);
if (emailConflicts.length) {
  console.log(`\n⚠️  ${emailConflicts.length} correo(s) NO asignados por choque de unicidad (revisar — mismo correo en varios clientes):`);
  for (const x of emailConflicts) console.log(`     ${x.email}  (${x.name})`);
}
await prisma.$disconnect();
