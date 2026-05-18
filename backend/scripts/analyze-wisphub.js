import fs from 'fs';

// Read token from environment variable (safer than hardcoding)
const TOKEN   = process.env.WISPHUB_TOKEN;
const API_URL = process.env.WISPHUB_API_URL || 'https://api.wisphub.app';

if (!TOKEN) {
  console.error('Missing WISPHUB_TOKEN env variable');
  console.error('Usage: WISPHUB_TOKEN=xxx [WISPHUB_API_URL=https://api.wisphub.app] node analyze-wisphub.js');
  process.exit(1);
}

const BASE = API_URL.replace(/\/$/, '') + '/api';

const headers = {
  'Authorization': `Api-Key ${TOKEN}`,
  'Content-Type':  'application/json'
};

async function get(path) {
  try {
    const res = await fetch(`${BASE}${path}`, { headers });
    const ct  = res.headers.get('content-type') || '';
    if (!res.ok) return { error: `HTTP ${res.status}`, path };
    if (!ct.includes('application/json')) {
      const text = await res.text();
      return { error: `Non-JSON response (content-type: ${ct})`, path, snippet: text.slice(0, 200) };
    }
    return await res.json();
  } catch (e) {
    return { error: e.message, path };
  }
}

async function analyze() {
  console.log('🔍 Analyzing WispHub structure (read-only)...\n');

  const results = {};

  // 1. Clients
  console.log('📋 Fetching clients...');
  results.clients = await get('/clientes/?limit=5');

  // 2. Routers (singular en WispHub)
  console.log('🔧 Fetching routers...');
  results.routers = await get('/router/?limit=5');

  // 3. Invoices
  console.log('💰 Fetching invoices...');
  results.invoices = await get('/facturas/?limit=5');

  // 4. Payments — WispHub no expone endpoint dedicado.
  //    Los datos de pago viven embebidos en /facturas/ (forma_pago,
  //    fecha_pago, comprobante_pago, id_mercadopago, total_cobrado, etc.)
  results.payments = { note: 'No dedicated endpoint. Payment data lives inside /facturas/.' };

  // 5. Plans (singular: plan-internet)
  console.log('📦 Fetching plans...');
  results.plans = await get('/plan-internet/?limit=10');

  // 6. Zones
  console.log('🗺️  Fetching zones...');
  results.zones = await get('/zonas/?limit=10');

  // 7. Tickets (en lugar de "services" — el módulo de soporte de WispHub)
  console.log('🎫 Fetching tickets...');
  results.tickets = await get('/tickets/?limit=5');

  // 8. Staff
  console.log('👥 Fetching staff...');
  results.staff = await get('/staff/?limit=5');

  // ── Build analysis report ──────────────────────────────
  const report = [];
  report.push('# WispHub Analysis — ISP Manager Reference');
  report.push(`\n> Generated: ${new Date().toISOString()}`);
  report.push('> Purpose: Understand data models to build a better minimal ISP system\n');

  // Clients
  report.push('## 1. Client Data Model');
  if (results.clients?.results?.[0]) {
    const sample = results.clients.results[0];
    report.push('### Fields found:');
    Object.keys(sample).forEach(k => {
      report.push(`- \`${k}\`: ${typeof sample[k] === 'object' ? JSON.stringify(sample[k]).slice(0,60) : sample[k]}`);
    });
    report.push(`\n**Total clients:** ${results.clients.count || 'unknown'}`);
  } else {
    report.push('```json\n' + JSON.stringify(results.clients, null, 2).slice(0,300) + '\n```');
  }

  // Routers
  report.push('\n## 2. Router Data Model');
  if (results.routers?.results?.[0]) {
    const sample = results.routers.results[0];
    report.push('### Fields found:');
    Object.keys(sample).forEach(k => {
      report.push(`- \`${k}\`: ${typeof sample[k] === 'object' ? JSON.stringify(sample[k]).slice(0,60) : sample[k]}`);
    });
  } else {
    report.push('```json\n' + JSON.stringify(results.routers, null, 2).slice(0,300) + '\n```');
  }

  // Invoices
  report.push('\n## 3. Invoice Data Model');
  if (results.invoices?.results?.[0]) {
    const sample = results.invoices.results[0];
    report.push('### Fields found:');
    Object.keys(sample).forEach(k => {
      report.push(`- \`${k}\`: ${typeof sample[k] === 'object' ? JSON.stringify(sample[k]).slice(0,60) : sample[k]}`);
    });
    report.push(`\n**Total invoices:** ${results.invoices.count || 'unknown'}`);
  } else {
    report.push('```json\n' + JSON.stringify(results.invoices, null, 2).slice(0,300) + '\n```');
  }

  // Payments
  report.push('\n## 4. Payment Data Model');
  report.push(`> ${results.payments.note}`);
  report.push('> Payment-related fields visible inside an invoice include:');
  report.push('> `forma_pago`, `fecha_pago`, `comprobante_pago`, `total_cobrado`,');
  report.push('> `referencia`, `referencia_oxxo`, `id_mercadopago`, `id_payu`,');
  report.push('> `url_payu`, `total_pasarela`, `total_openpay`.');

  // Plans
  report.push('\n## 5. Service Plans');
  if (results.plans?.results?.[0]) {
    report.push('### Fields found (first plan):');
    Object.keys(results.plans.results[0]).forEach(k => {
      const v = results.plans.results[0][k];
      report.push(`- \`${k}\`: ${typeof v === 'object' ? JSON.stringify(v).slice(0,60) : v}`);
    });
    report.push(`\n**All plans (${results.plans.count || results.plans.results.length}):**`);
    results.plans.results.forEach(p => {
      report.push(`- **${p.nombre || p.name}**: ${JSON.stringify(p).slice(0,140)}`);
    });
  } else {
    report.push('```json\n' + JSON.stringify(results.plans, null, 2).slice(0,300) + '\n```');
  }

  // Zones
  report.push('\n## 6. Zones');
  if (results.zones?.results?.[0]) {
    report.push('### Fields found (first zone):');
    Object.keys(results.zones.results[0]).forEach(k => {
      const v = results.zones.results[0][k];
      report.push(`- \`${k}\`: ${typeof v === 'object' ? JSON.stringify(v).slice(0,60) : v}`);
    });
    report.push(`\n**All zones (${results.zones.count || results.zones.results.length}):**`);
    results.zones.results.forEach(z => {
      report.push(`- **${z.nombre || z.name}** (id=${z.id})`);
    });
  } else {
    report.push('```json\n' + JSON.stringify(results.zones, null, 2).slice(0,300) + '\n```');
  }

  // Tickets
  report.push('\n## 6.1 Tickets / Soporte');
  if (results.tickets?.results?.[0]) {
    report.push('### Fields found:');
    Object.keys(results.tickets.results[0]).forEach(k => {
      const v = results.tickets.results[0][k];
      report.push(`- \`${k}\`: ${typeof v === 'object' ? JSON.stringify(v).slice(0,60) : v}`);
    });
    report.push(`\n**Total tickets:** ${results.tickets.count || 'unknown'}`);
  } else {
    report.push('```json\n' + JSON.stringify(results.tickets, null, 2).slice(0,300) + '\n```');
  }

  // Staff
  report.push('\n## 6.2 Staff');
  if (results.staff?.results?.[0]) {
    report.push('### Fields found:');
    Object.keys(results.staff.results[0]).forEach(k => {
      const v = results.staff.results[0][k];
      report.push(`- \`${k}\`: ${typeof v === 'object' ? JSON.stringify(v).slice(0,60) : v}`);
    });
    report.push(`\n**Total staff:** ${results.staff.count || 'unknown'}`);
  } else {
    report.push('```json\n' + JSON.stringify(results.staff, null, 2).slice(0,300) + '\n```');
  }

  // Raw JSON for deep analysis
  report.push('\n## 7. Raw API Responses (first record each)');
  report.push('```json');
  report.push(JSON.stringify({
    client_sample:  results.clients?.results?.[0]  || results.clients,
    router_sample:  results.routers?.results?.[0]  || results.routers,
    invoice_sample: results.invoices?.results?.[0] || results.invoices,
    payment_sample: results.payments,
    plan_sample:    results.plans?.results?.[0]    || results.plans,
    zone_sample:    results.zones?.results?.[0]    || results.zones,
    ticket_sample:  results.tickets?.results?.[0]  || results.tickets,
    staff_sample:   results.staff?.results?.[0]    || results.staff,
  }, null, 2));
  report.push('```');

  report.push('\n## 8. Improvements for our ISP Manager');
  report.push('*(To be filled after reviewing the data models above)*');
  report.push('- Fields we are missing vs WispHub');
  report.push('- Simplifications we can make');
  report.push('- Payment flow differences');

  // Save report
  const outDir = '../docs';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(`${outDir}/wisphub-analysis.md`, report.join('\n'));
  console.log('\n✅ Report saved to docs/wisphub-analysis.md');
  console.log('📖 Review it to plan ISP Manager improvements');
}

analyze().catch(console.error);
