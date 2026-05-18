import { chromium } from 'playwright';
import fs from 'fs';

const EMAIL    = process.env.WISPHUB_EMAIL    || 'contacto@internetonline.co';
const PASSWORD = process.env.WISPHUB_PASSWORD || 'Hackerarc09.$';
const BASE     = 'https://wisphub.app';
const report   = {};

async function scrape() {
  // Usa el Google Chrome del sistema (evita descargar el Chromium de Playwright)
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page    = await browser.newPage();

  // ── LOGIN ──────────────────────────────────────────────
  console.log('🔐 Logging in...');
  await page.goto(`${BASE}/accounts/login/?next=/panel/`);
  await page.fill('input[name="login"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"], input[type="submit"]');
  await page.waitForURL('**/panel/**', { timeout: 10000 });
  console.log('✅ Logged in successfully');

  // ── HELPER: extract table structure ───────────────────
  async function extractTable(url, label) {
    console.log(`📋 Scraping ${label}...`);
    try {
      const resp = await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
      const status = resp ? resp.status() : 0;
      const finalUrl = page.url();
      try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}

      const headers = await page.$$eval(
        'table thead th, table th',
        els => els.map(e => e.innerText.trim()).filter(Boolean)
      );
      const firstRow = await page.$$eval(
        'table tbody tr:first-child td',
        els => els.map(e => e.innerText.trim())
      );

      let formFields = [];
      try {
        await page.goto(`${BASE}${url}add/`, { waitUntil: 'domcontentloaded' });
        try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
        formFields = await page.$$eval(
          'form input, form select, form textarea',
          els => els.map(e => ({
            name:  e.getAttribute('name'),
            type:  e.tagName.toLowerCase() === 'select' ? 'select' : e.getAttribute('type'),
            label: e.getAttribute('placeholder') || e.getAttribute('name')
          })).filter(e => e.name && e.name !== 'csrfmiddlewaretoken')
        );
      } catch { /* form page may not exist */ }

      return { url, finalUrl, status, headers, firstRow, formFields };
    } catch (e) {
      console.log(`   ⚠️  ${label}: ${e.message}`);
      return { url, error: e.message };
    }
  }

  // ── DASHBOARD ─────────────────────────────────────────
  console.log('📊 Scraping dashboard...');
  await page.goto(`${BASE}/panel/`);
  await page.waitForLoadState('networkidle');
  report.dashboard = {
    widgets: await page.$$eval(
      '.card, .widget, .stat, [class*="card"], [class*="stat"]',
      els => els.slice(0, 20).map(e => e.innerText.trim().slice(0, 80))
    ),
    title: await page.title()
  };

  // ── CLIENTS ───────────────────────────────────────────
  report.clients = await extractTable('/panel/clientes/', 'Clients');

  // ── CLIENT DETAIL (first client) ─────────────────────
  try {
    await page.goto(`${BASE}/panel/clientes/`);
    const firstLink = await page.$('table tbody tr:first-child a');
    if (firstLink) {
      await firstLink.click();
      await page.waitForLoadState('networkidle');
      report.clientDetail = {
        url: page.url(),
        sections: await page.$$eval(
          'h2, h3, h4, .card-header, [class*="section"]',
          els => els.map(e => e.innerText.trim()).filter(Boolean)
        ),
        fields: await page.$$eval(
          '.form-group label, .field label, dt',
          els => els.map(e => e.innerText.trim()).filter(Boolean)
        )
      };
    }
  } catch(e) { report.clientDetail = { error: e.message }; }

  // ── ROUTERS ───────────────────────────────────────────
  report.routers = await extractTable('/panel/routers/', 'Routers');

  // ── ROUTER DETAIL ─────────────────────────────────────
  try {
    await page.goto(`${BASE}/panel/routers/`);
    const firstLink = await page.$('table tbody tr:first-child a');
    if (firstLink) {
      await firstLink.click();
      await page.waitForLoadState('networkidle');
      report.routerDetail = {
        url: page.url(),
        fields: await page.$$eval(
          'label, dt, .field-label',
          els => els.map(e => e.innerText.trim()).filter(Boolean)
        )
      };
    }
  } catch(e) { report.routerDetail = { error: e.message }; }

  // ── PAYMENTS ─────────────────────────────────────────
  report.payments = await extractTable('/panel/pagos/', 'Payments');

  // ── INVOICES ─────────────────────────────────────────
  report.invoices = await extractTable('/panel/facturas/', 'Invoices');

  // ── PLANS ────────────────────────────────────────────
  report.plans = await extractTable('/panel/planes/', 'Plans');

  // ── ZONES ────────────────────────────────────────────
  report.zones = await extractTable('/panel/zonas/', 'Zones');

  // ── SERVICES (PPPoE) ─────────────────────────────────
  report.services = await extractTable('/panel/servicios/', 'Services');

  // ── NAVIGATION MENU ──────────────────────────────────
  report.navigation = await page.$$eval(
    'nav a, .sidebar a, .menu a, [class*="nav"] a',
    els => [...new Set(els.map(e => ({
      label: e.innerText.trim(),
      href:  e.getAttribute('href')
    })).filter(e => e.label && e.href && !e.href.startsWith('#')))]
  );

  await browser.close();

  // ── GENERATE MARKDOWN REPORT ─────────────────────────
  const lines = [];
  lines.push('# WispHub Analysis — ISP Manager Reference');
  lines.push(`\n> Scraped: ${new Date().toLocaleString('es-CO')}`);
  lines.push('> Owner account — read-only analysis for ISP Manager improvements\n');

  lines.push('## 1. Dashboard Widgets');
  (report.dashboard?.widgets || []).forEach(w => {
    if (w.trim()) lines.push(`- ${w.replace(/\n/g, ' ')}`);
  });

  lines.push('\n## 2. Client List');
  lines.push(`**Columns:** ${(report.clients?.headers || []).join(' | ')}`);
  lines.push('\n**Add Client Form Fields:**');
  (report.clients?.formFields || []).forEach(f => {
    lines.push(`- \`${f.name}\` (${f.type})`);
  });

  lines.push('\n## 3. Client Detail Sections');
  (report.clientDetail?.sections || []).forEach(s => lines.push(`- ${s}`));
  lines.push('\n**Fields visible:**');
  (report.clientDetail?.fields || []).forEach(f => lines.push(`- ${f}`));

  lines.push('\n## 4. Router List');
  lines.push(`**Columns:** ${(report.routers?.headers || []).join(' | ')}`);
  lines.push('\n**Add Router Form Fields:**');
  (report.routers?.formFields || []).forEach(f => {
    lines.push(`- \`${f.name}\` (${f.type})`);
  });

  lines.push('\n## 5. Router Detail Fields');
  (report.routerDetail?.fields || []).forEach(f => lines.push(`- ${f}`));

  lines.push('\n## 6. Payments');
  lines.push(`**Columns:** ${(report.payments?.headers || []).join(' | ')}`);
  lines.push('\n**Add Payment Form Fields:**');
  (report.payments?.formFields || []).forEach(f => {
    lines.push(`- \`${f.name}\` (${f.type})`);
  });

  lines.push('\n## 7. Invoices');
  lines.push(`**Columns:** ${(report.invoices?.headers || []).join(' | ')}`);

  lines.push('\n## 8. Service Plans');
  lines.push(`**Columns:** ${(report.plans?.headers || []).join(' | ')}`);
  lines.push('\n**Fields:**');
  (report.plans?.formFields || []).forEach(f => {
    lines.push(`- \`${f.name}\` (${f.type})`);
  });

  lines.push('\n## 9. Zones');
  lines.push(`**Columns:** ${(report.zones?.headers || []).join(' | ')}`);

  lines.push('\n## 10. PPPoE Services');
  lines.push(`**Columns:** ${(report.services?.headers || []).join(' | ')}`);
  lines.push('\n**Service Form Fields:**');
  (report.services?.formFields || []).forEach(f => {
    lines.push(`- \`${f.name}\` (${f.type})`);
  });

  lines.push('\n## 11. Navigation Menu');
  (report.navigation || []).slice(0, 30).forEach(n => {
    lines.push(`- [${n.label}](${n.href})`);
  });

  lines.push('\n## 12. Raw Data');
  lines.push('```json');
  lines.push(JSON.stringify(report, null, 2).slice(0, 3000));
  lines.push('```');

  // Save
  const outDir = 'docs';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = `${outDir}/wisphub-analysis.md`;
  fs.writeFileSync(outFile, lines.join('\n'));

  console.log(`\n✅ Analysis complete → ${outFile}`);
  console.log(`   Sections analyzed: ${Object.keys(report).join(', ')}`);
}

scrape().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
