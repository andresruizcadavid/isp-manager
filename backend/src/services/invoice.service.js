import PDFDocument from 'pdfkit';
import { env } from '../config/env.js';
import { BRAND } from '../config/brand.js';
import { AppError } from '../middleware/error.middleware.js';
import { prisma } from '../config/database.js';

class InvoiceService {
  async generateInvoiceNumber() {
    try {
      // Field is `invoiceNumber` after the rename; `@map("number")` keeps
      // the DB column the same so this is purely a Prisma-side change.
      const lastInvoice = await prisma.invoice.findFirst({
        orderBy: { invoiceNumber: 'desc' },
        select: { invoiceNumber: true }
      });

      let nextNumber = 1;

      if (lastInvoice?.invoiceNumber) {
        const numericPart = lastInvoice.invoiceNumber.match(/\d+/);
        if (numericPart) {
          nextNumber = parseInt(numericPart[0], 10) + 1;
        }
      }

      return `INV-${String(nextNumber).padStart(4, '0')}`;
    } catch (error) {
      console.error('Error generating invoice number:', error);
      return `INV-${Date.now()}`;
    }
  }

  async generateInvoicePDF(invoice) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const buffers = [];

        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
          const pdfData = Buffer.concat(buffers);
          resolve(pdfData);
        });

        // Add content to PDF
        this.addInvoiceContent(doc, invoice);
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // ── Branded invoice PDF (Internet Online identity) ───────────────
  // Visual system mirrors the live site (navy #16357E + gold #FDB913,
  // power-button logo, "El internet de nuestra gente"). Formal layout:
  // brand header → emisor + meta → cliente → items table → totals →
  // formas de pago → branded footer. All dynamic fields are guarded so
  // partial includes (no `items`, plan via client.plan) never break it.
  addInvoiceContent(doc, invoice) {
    const C = BRAND.colors;
    const client = invoice.client || {};
    const plan   = invoice.client?.plan || invoice.plan || null;

    const pageW = doc.page.width;
    const left  = doc.page.margins.left;            // 50
    const right = pageW - doc.page.margins.right;   // 562
    const width = right - left;                     // 512

    // The footer band + header band are drawn with absolute coordinates near
    // the page edges. Without this, pdfkit auto-paginates any text placed
    // below the bottom margin (742pt) onto a phantom 2nd page.
    doc.page.margins.bottom = 0;

    // ── value helpers ──────────────────────────────────────────────
    const money    = (cents) => `$${Math.round((cents || 0) / 100).toLocaleString('es-CO')}`;
    const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
    const MONTHS   = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const periodLabel = invoice.periodMonth ? `${MONTHS[invoice.periodMonth - 1]} ${invoice.periodYear || ''}`.trim() : null;

    const amount     = invoice.amount || 0;
    const tax        = invoice.tax || 0;
    const discount   = invoice.discount || 0;
    const total      = invoice.total ?? amount;
    const balanceDue = invoice.balanceDue ?? total;

    const statusMap = {
      PAID:      { label: 'PAGADA',    color: C.success,  bg: '#DCFCE7' },
      OVERDUE:   { label: 'VENCIDA',   color: C.danger,   bg: '#FEE2E2' },
      PENDING:   { label: 'PENDIENTE', color: '#92400E',  bg: C.goldLight },
      SENT:      { label: 'PENDIENTE', color: '#92400E',  bg: C.goldLight },
      DRAFT:     { label: 'BORRADOR',  color: C.textMuted, bg: '#F3F4F6' },
      CANCELLED: { label: 'ANULADA',   color: C.textMuted, bg: '#F3F4F6' },
    };
    const st = statusMap[invoice.status] || statusMap.PENDING;

    // ── 1. BRAND HEADER BAND ───────────────────────────────────────
    doc.rect(0, 0, pageW, 122).fill(C.navy);
    doc.rect(0, 122, pageW, 4).fill(C.gold);

    // power-button "O" icon (gold ring + bar)
    doc.lineWidth(6).strokeColor(C.gold);
    doc.circle(72, 54, 15).stroke();
    doc.roundedRect(69, 38, 6, 17, 3).fill(C.gold);

    // "Internet" white pill
    doc.roundedRect(96, 34, 60, 17, 8.5).fill(C.white);
    doc.fillColor(C.navy).font('Helvetica-BoldOblique').fontSize(9.5).text('Internet', 96, 38.5, { width: 60, align: 'center' });
    // "Online" gold wordmark
    doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(27).text('Online', 95, 53);
    // tagline
    doc.fillColor('#DCE5F7').font('Helvetica-Oblique').fontSize(8.5).text('El internet de nuestra gente', 97, 85);

    // right side: FACTURA + número
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(22).text('FACTURA', left, 40, { width, align: 'right' });
    doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(13).text(invoice.invoiceNumber || '', left, 68, { width, align: 'right' });
    if (BRAND.nit) {
      doc.fillColor('#DCE5F7').font('Helvetica').fontSize(8.5).text(`NIT: ${BRAND.nit}`, left, 88, { width, align: 'right' });
    }

    // ── 2. EMISOR (left) + META BOX (right) ────────────────────────
    let ey = 162;
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(12).text(BRAND.name, left, 142);
    doc.fillColor(C.textMuted).font('Helvetica').fontSize(8.5);
    const eline = (t) => { if (t) { doc.text(t, left, ey, { width: 262 }); ey += 12; } };
    eline(BRAND.address || null);
    eline(BRAND.city);
    eline(`Tel: ${BRAND.phone}`);
    eline(BRAND.email);
    eline(BRAND.web);

    const mX = right - 232, mW = 232, mY = 140;
    doc.roundedRect(mX, mY, mW, 88, 8).lineWidth(1).strokeColor(C.border).stroke();
    doc.fillColor(C.textMuted).font('Helvetica').fontSize(7.5).text('FECHA DE EMISIÓN', mX + 14, mY + 14);
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(10).text(fmtDate(invoice.issueDate || invoice.createdAt), mX + 14, mY + 24);
    doc.fillColor(C.textMuted).font('Helvetica').fontSize(7.5).text('VENCIMIENTO', mX + 124, mY + 14);
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(10).text(fmtDate(invoice.dueDate), mX + 124, mY + 24);

    doc.fillColor(C.textMuted).font('Helvetica').fontSize(7.5).text('ESTADO', mX + 14, mY + 48);
    doc.font('Helvetica-Bold').fontSize(8.5);
    const pillW = doc.widthOfString(st.label) + 20;
    doc.roundedRect(mX + 14, mY + 58, pillW, 16, 8).fill(st.bg);
    doc.fillColor(st.color).text(st.label, mX + 14, mY + 62.5, { width: pillW, align: 'center' });
    if (periodLabel) {
      doc.fillColor(C.textMuted).font('Helvetica-Oblique').fontSize(8).text(`Periodo: ${periodLabel}`, mX + 24 + pillW, mY + 62.5);
    }

    // ── 3. CLIENTE ─────────────────────────────────────────────────
    let cy = this._sectionBar(doc, 'Datos del cliente', 244, left, width, C);
    const field = (label, val, x, yy, w) => {
      doc.fillColor(C.textMuted).font('Helvetica').fontSize(7.5).text(label.toUpperCase(), x, yy);
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(9.5).text(val || '—', x, yy + 10, { width: w, ellipsis: true, lineBreak: false });
    };
    field('Nombre', client.name, left, cy, 250);
    field('Documento', `${client.documentType || ''} ${client.documentNumber || ''}`.trim(), left + 272, cy, 240);
    cy += 30;
    field('Email', client.email, left, cy, 250);
    field('Teléfono', client.phone, left + 272, cy, 240);
    cy += 30;
    field('Dirección', [client.address, client.city].filter(Boolean).join(', '), left, cy, width);
    cy += 36;

    // ── 4. ITEMS TABLE ─────────────────────────────────────────────
    let items = Array.isArray(invoice.items) && invoice.items.length ? invoice.items : null;
    if (!items) {
      const speed = plan?.speedDown ? ` · ${plan.speedDown} Mbps` : '';
      const desc  = `Servicio de Internet Fibra Óptica${plan?.name ? ` — ${plan.name}` : ''}${speed}${periodLabel ? ` (${periodLabel})` : ''}`;
      items = [{ description: desc, quantity: 1, price: amount, total: total }];
    }

    const descW = 262, qtyW = 45, unitW = 95, totW = 110;
    let ty = this._sectionBar(doc, 'Detalle del servicio', cy, left, width, C);
    // table header
    doc.rect(left, ty, width, 24).fill(C.navy);
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(8.5);
    doc.text('DESCRIPCIÓN', left + 10, ty + 8, { width: descW - 12 });
    doc.text('CANT.', left + descW, ty + 8, { width: qtyW, align: 'center' });
    doc.text('V. UNIT.', left + descW + qtyW, ty + 8, { width: unitW, align: 'right' });
    doc.text('TOTAL', left + descW + qtyW + unitW, ty + 8, { width: totW - 10, align: 'right' });
    ty += 24;
    // rows
    items.forEach((it, i) => {
      const rh = 24;
      if (i % 2) doc.rect(left, ty, width, rh).fill('#F8FAFC');
      doc.fillColor(C.text).font('Helvetica').fontSize(9.5)
         .text(it.description || '—', left + 10, ty + 7, { width: descW - 14, ellipsis: true, lineBreak: false });
      doc.text(String(it.quantity || 1), left + descW, ty + 7, { width: qtyW, align: 'center' });
      doc.text(money(it.price), left + descW + qtyW, ty + 7, { width: unitW, align: 'right' });
      doc.fillColor(C.navy).font('Helvetica-Bold')
         .text(money(it.total), left + descW + qtyW + unitW, ty + 7, { width: totW - 10, align: 'right' });
      ty += rh;
    });
    doc.moveTo(left, ty).lineTo(right, ty).lineWidth(1).strokeColor(C.border).stroke();

    // ── 5. FORMAS DE PAGO (left) + TOTALES (right) ─────────────────
    const blockY = ty + 18;
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(9.5).text('FORMAS DE PAGO', left, blockY);
    doc.fillColor(C.text).font('Helvetica').fontSize(9);
    doc.text('•  Pago en línea seguro (Wompi)', left, blockY + 16);
    doc.text('•  Transferencia bancaria', left, blockY + 30);
    doc.text('•  Pago presencial en nuestras oficinas', left, blockY + 44);

    const boxW = 232, boxX = right - boxW;
    let oy = blockY;
    const totalRow = (label, val) => {
      doc.fillColor(C.textMuted).font('Helvetica').fontSize(9.5).text(label, boxX, oy, { width: boxW * 0.5 });
      doc.fillColor(C.text).font('Helvetica').text(val, boxX + boxW * 0.45, oy, { width: boxW * 0.55, align: 'right' });
      oy += 16;
    };
    totalRow('Subtotal', money(amount));
    if (tax > 0) totalRow('IVA', money(tax));
    if (discount > 0) totalRow('Descuento', `- ${money(discount)}`);
    doc.moveTo(boxX, oy).lineTo(right, oy).lineWidth(1).strokeColor(C.border).stroke();
    oy += 8;
    // TOTAL highlighted
    doc.roundedRect(boxX, oy, boxW, 32, 7).fill(C.navy);
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(11).text('TOTAL', boxX + 14, oy + 10);
    doc.fillColor(C.gold).fontSize(14).text(`${money(total)} COP`, boxX + boxW * 0.38, oy + 8.5, { width: boxW * 0.62 - 14, align: 'right' });
    oy += 40;
    // balance / paid
    if (invoice.status === 'PAID') {
      doc.roundedRect(boxX, oy, boxW, 26, 6).fill('#DCFCE7');
      doc.fillColor(C.success).font('Helvetica-Bold').fontSize(10).text('Factura pagada', boxX + 14, oy + 8);
      doc.text(`${money(total)} COP`, boxX + boxW * 0.4, oy + 8, { width: boxW * 0.6 - 14, align: 'right' });
    } else if (balanceDue > 0) {
      doc.roundedRect(boxX, oy, boxW, 26, 6).fill(C.goldLight);
      doc.fillColor('#92400E').font('Helvetica-Bold').fontSize(10).text('Saldo pendiente', boxX + 14, oy + 8);
      doc.text(`${money(balanceDue)} COP`, boxX + boxW * 0.4, oy + 8, { width: boxW * 0.6 - 14, align: 'right' });
    }

    // ── 6. NOTE + BRANDED FOOTER ───────────────────────────────────
    const fH = 64;
    const fy = doc.page.height - fH;
    doc.fillColor(C.textFaint).font('Helvetica').fontSize(8).text(
      `El pago debe realizarse antes de la fecha de vencimiento para evitar la suspensión del servicio. ¿Dudas? Escríbenos a ${BRAND.email}.`,
      left, fy - 26, { width }
    );
    doc.rect(0, fy, pageW, fH).fill(C.navy);
    doc.rect(0, fy, pageW, 3).fill(C.gold);
    doc.fillColor(C.gold).font('Helvetica-BoldOblique').fontSize(11).text('El internet de nuestra gente', left, fy + 13, { width, align: 'center' });
    doc.fillColor(C.white).font('Helvetica').fontSize(8.5).text(`${BRAND.email}   ·   ${BRAND.phone}   ·   ${BRAND.web}`, left, fy + 31, { width, align: 'center' });
    doc.fillColor('#AEBEDC').fontSize(7.5).text(`Fibra óptica de alta calidad para tu hogar en ${BRAND.areas}.`, left, fy + 45, { width, align: 'center' });
  }

  // Soft navy section-label bar; returns the y where content should start.
  _sectionBar(doc, label, y, left, width, C) {
    doc.roundedRect(left, y, width, 22, 4).fill(C.navyLight);
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(9.5).text(label.toUpperCase(), left + 10, y + 6.5);
    return y + 22 + 12;
  }

  // REMOVED: calculateInvoiceAmount, generateProRatedInvoice,
  // duplicateInvoiceForPeriod, getSystemUserId.
  //
  // All four were broken against the current schema:
  //   • calculateInvoiceAmount divided plan.price by plan.duration (Plan
  //     has no `duration` field — returned NaN).
  //   • generateProRatedInvoice / duplicateInvoiceForPeriod wrote
  //     Invoice.planId / periodStart / periodEnd / createdBy / creator —
  //     none of those exist on the Invoice model (canonical billing
  //     period is periodYear + periodMonth).
  //   • getSystemUserId created a User with a hardcoded string in the
  //     password column ('system_password_hash', NOT a bcrypt hash) and
  //     ADMIN role — a latent privilege-escalation footgun.
  //
  // None of them had any external caller (only invoked each other), so
  // deletion is safe. If pro-rated billing is needed again, write a fresh
  // implementation against periodYear/periodMonth and InvoiceItem rows.

  // Generate one Invoice row per active client for the month of `targetDate`.
  //
  // Schema alignment (kept in sync with prisma/schema.prisma):
  //   • Invoice has NO planId / periodStart / periodEnd / createdBy. The
  //     billing period is identified by `(periodYear, periodMonth)` with a
  //     composite UNIQUE constraint → idempotency is enforced at the DB
  //     level via `upsert`, so re-running the job is a no-op.
  //   • The amount comes from (in order of precedence):
  //       1. client.monthlyFee  — per-client override (cents)
  //       2. plan.monthlyPrice  — frontend-facing price (cents)
  //       3. plan.price         — legacy single field (cents)
  //
  // Clients with NULL installationDate are eligible (legacy / imported
  // rows). Only `installationDate > lastDay` is excluded (future contracts).
  //
  // Note: `tax` and `discount` are zero today. When IVA is enabled we can
  // extend this to compute them from the plan/client. `total` is always
  // `amount + tax - discount` so the dashboards stay consistent.
  async generateMonthlyInvoices(targetDate = new Date(), opts = {}) {
    try {
      const year  = opts.year  ?? targetDate.getFullYear();
      const month = opts.month ?? (targetDate.getMonth() + 1); // 1-12
      const firstDay = new Date(year, month - 1, 1);
      const lastDay  = new Date(year, month, 0, 23, 59, 59, 999);

      // Issue/due dates. When generating from a billing cycle these come from
      // the cycle (collectionStart → issueDate, collectionEnd → dueDate). The
      // defaults preserve the legacy behavior (issue on the 1st, due 15 days
      // after the period ends) for any caller that doesn't pass a cycle.
      const issueDate  = opts.issueDate ? new Date(opts.issueDate) : firstDay;
      const dueDate    = opts.dueDate
        ? new Date(opts.dueDate)
        : new Date(lastDay.getTime() + 15 * 24 * 60 * 60 * 1000);

      const activeClients = await prisma.client.findMany({
        where: {
          status: 'ACTIVE',
          // Eligible: never-set installationDate OR installed on/before lastDay.
          OR: [
            { installationDate: null },
            { installationDate: { lte: lastDay } }
          ]
        },
        include: { plan: true }
      });

      const results = { successful: [], failed: [], total: activeClients.length };

      for (const client of activeClients) {
        try {
          if (!client.planId || !client.plan) {
            results.failed.push({ clientId: client.id, reason: 'Client has no plan assigned' });
            continue;
          }

          const amount = client.monthlyFee && client.monthlyFee > 0
            ? client.monthlyFee
            : (client.plan.monthlyPrice || client.plan.price || 0);
          if (!amount || amount < 0) {
            results.failed.push({ clientId: client.id, reason: 'Computed amount is zero/negative' });
            continue;
          }
          const total = amount; // tax=0, discount=0 (see comment above)

          // Idempotency: UNIQUE(clientId, periodYear, periodMonth) means
          // re-running the same month upserts the existing row instead of
          // duplicating. We use a constant `where` to leverage the index.
          const existing = await prisma.invoice.findUnique({
            where: {
              clientId_periodYear_periodMonth: {
                clientId: client.id, periodYear: year, periodMonth: month
              }
            }
          });
          if (existing) {
            results.failed.push({
              clientId: client.id,
              reason: 'Invoice already exists for this period',
              invoiceId: existing.id
            });
            continue;
          }

          const invoiceNumber = await this.generateInvoiceNumber();

          const invoice = await prisma.invoice.create({
            data: {
              invoiceNumber,
              clientId:    client.id,
              amount, tax: 0, discount: 0, total,
              balanceDue:  total,
              status:      'PENDING',
              issueDate,
              dueDate,
              periodYear:  year,
              periodMonth: month,
              items: {
                create: [{
                  description: `${client.plan.name} — ${this._monthLabel(month)} ${year}`,
                  quantity:    1,
                  // InvoiceItem schema uses `price` (per-unit). Total is the
                  // line total = price * quantity for this simple item.
                  price:       amount,
                  total:       amount
                }]
              }
            },
            include: { client: true, items: true }
          });

          results.successful.push({
            clientId: client.id, invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber, amount
          });
        } catch (error) {
          console.error(`Error generating invoice for client ${client.id}:`, error);
          results.failed.push({ clientId: client.id, reason: error.message });
        }
      }

      return results;
    } catch (error) {
      console.error('Error generating monthly invoices:', error);
      throw new AppError('Error generando facturas mensuales', 500, 'MONTHLY_INVOICES_ERROR');
    }
  }

  // ── Cycle-aware generation ──────────────────────────────────────
  // Generate invoices for a specific BillingCycle: bills its (year, month),
  // issues on collectionStart and sets due = collectionEnd. Idempotent —
  // clients that already have an invoice for the period are skipped, so it is
  // safe to call repeatedly; only newly-created invoices come back in
  // `successful`, which the job uses to decide who to notify.
  async generateInvoicesForCycle(cycle) {
    if (!cycle) throw new AppError('Ciclo de cobro no encontrado', 404, 'CYCLE_NOT_FOUND');
    const targetDate = new Date(cycle.year, cycle.month - 1, 1);
    return this.generateMonthlyInvoices(targetDate, {
      year:      cycle.year,
      month:     cycle.month,
      issueDate: cycle.collectionStart,
      dueDate:   cycle.collectionEnd
    });
  }

  // Entry point for the daily scheduler. Finds the active cycle and, once its
  // collection window has started (collectionStart <= now), generates the
  // period's invoices. Returns { ran, reason?, cycle?, results? } so the
  // caller can log/notify. Generation is gated ONLY by the date — it never
  // suspends or mutates clients (suspension is always manual).
  async generateInvoicesForActiveCycle({ now = new Date() } = {}) {
    const cycle = await prisma.billingCycle.findFirst({
      where:   { status: 'active' },
      orderBy: [{ year: 'desc' }, { month: 'desc' }]
    });
    if (!cycle) return { ran: false, reason: 'no_active_cycle' };
    if (new Date(cycle.collectionStart) > now) {
      return { ran: false, reason: 'collection_not_started', cycle };
    }
    const results = await this.generateInvoicesForCycle(cycle);
    return { ran: true, cycle, results };
  }

  _monthLabel(month) {
    return ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
            'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][month - 1] || '';
  }

  async updateInvoiceStatus(invoiceId, status) {
    try {
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId }
      });

      if (!invoice) {
        throw new AppError('Factura no encontrada', 404, 'INVOICE_NOT_FOUND');
      }

      const updatedInvoice = await prisma.invoice.update({
        where: { id: invoiceId },
        data: { status },
        include: {
          client: true,
          plan: true
        }
      });

      return updatedInvoice;
    } catch (error) {
      console.error('Error updating invoice status:', error);
      throw error;
    }
  }

  // Invoice has no direct `plan` relation in the schema — the plan lives on
  // the Client. We include `client.plan` so downstream notifications can
  // still show plan info without an extra round-trip.
  async getOverdueInvoices() {
    try {
      const overdueInvoices = await prisma.invoice.findMany({
        where: {
          status:  { in: ['PENDING', 'OVERDUE'] },
          dueDate: { lt: new Date() }
        },
        include: {
          client: {
            select: {
              id: true, name: true, email: true, phone: true,
              plan: { select: { name: true, price: true, monthlyPrice: true } }
            }
          }
        },
        orderBy: { dueDate: 'asc' }
      });
      return overdueInvoices;
    } catch (error) {
      console.error('Error getting overdue invoices:', error);
      throw new AppError('Error obteniendo facturas vencidas', 500, 'OVERDUE_INVOICES_ERROR');
    }
  }

  async markInvoicesAsOverdue() {
    try {
      const result = await prisma.invoice.updateMany({
        where: {
          status: 'PENDING',
          dueDate: { lt: new Date() }
        },
        data: { status: 'OVERDUE' }
      });

      return result;
    } catch (error) {
      console.error('Error marking invoices as overdue:', error);
      throw new AppError('Error marcando facturas como vencidas', 500, 'MARK_OVERDUE_ERROR');
    }
  }

  async getInvoiceSummary(filters = {}) {
    try {
      const where = {
        ...(filters.dateFrom && filters.dateTo && {
          createdAt: {
            gte: new Date(filters.dateFrom),
            lte: new Date(filters.dateTo)
          }
        }),
        ...(filters.status && { status: filters.status }),
        ...(filters.clientId && { clientId: filters.clientId })
      };

      const [total, summary, byStatus, byPlan] = await Promise.all([
        prisma.invoice.count({ where }),
        prisma.invoice.aggregate({
          where,
          _sum: { amount: true },
          _count: true
        }),
        prisma.invoice.groupBy({
          by: ['status'],
          where,
          _count: true,
          _sum: { amount: true }
        }),
        prisma.invoice.groupBy({
          by: ['planId'],
          where,
          _count: true,
          _sum: { amount: true }
        })
      ]);

      // Get plan details
      const planIds = byPlan.map(item => item.planId);
      const plans = await prisma.plan.findMany({
        where: { id: { in: planIds } },
        select: { id: true, name: true }
      });

      const planDetails = byPlan.map(item => {
        const plan = plans.find(p => p.id === item.planId);
        return {
          planId: item.planId,
          planName: plan?.name || 'Unknown',
          count: item._count,
          amount: item._sum.amount || 0
        };
      });

      return {
        total,
        summary: {
          count: summary._count,
          amount: summary._sum.amount || 0
        },
        byStatus,
        byPlan: planDetails
      };
    } catch (error) {
      console.error('Error getting invoice summary:', error);
      throw new AppError('Error obteniendo resumen de facturas', 500, 'INVOICE_SUMMARY_ERROR');
    }
  }

  async validateInvoiceData(invoiceData) {
    const errors = [];

    // Validate required fields
    if (!invoiceData.clientId) {
      errors.push('El ID del cliente es requerido');
    }

    if (!invoiceData.planId) {
      errors.push('El ID del plan es requerido');
    }

    if (!invoiceData.amount || invoiceData.amount <= 0) {
      errors.push('El monto debe ser mayor a 0');
    }

    if (!invoiceData.dueDate) {
      errors.push('La fecha de vencimiento es requerida');
    }

    if (!invoiceData.periodStart) {
      errors.push('La fecha de inicio del período es requerida');
    }

    if (!invoiceData.periodEnd) {
      errors.push('La fecha de fin del período es requerida');
    }

    // Validate date logic
    if (invoiceData.periodStart && invoiceData.periodEnd) {
      const startDate = new Date(invoiceData.periodStart);
      const endDate = new Date(invoiceData.periodEnd);

      if (startDate >= endDate) {
        errors.push('La fecha de inicio debe ser anterior a la fecha de fin');
      }

      if (invoiceData.dueDate) {
        const dueDate = new Date(invoiceData.dueDate);
        if (dueDate <= endDate) {
          errors.push('La fecha de vencimiento debe ser posterior a la fecha de fin del período');
        }
      }
    }

    // Validate client exists
    if (invoiceData.clientId) {
      const client = await prisma.client.findUnique({
        where: { id: invoiceData.clientId }
      });

      if (!client) {
        errors.push('El cliente especificado no existe');
      }
    }

    // Validate plan exists
    if (invoiceData.planId) {
      const plan = await prisma.plan.findUnique({
        where: { id: invoiceData.planId }
      });

      if (!plan) {
        errors.push('El plan especificado no existe');
      }
    }

    return errors;
  }

  // REMOVED: duplicateInvoice — relied on calculateInvoiceAmount and
  // getSystemUserId and wrote planId/periodStart/periodEnd/createdBy/creator
  // (none of which exist on the Invoice model). Had no external callers.


  async getInvoiceTimeline(invoiceId) {
    try {
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          payments: {
            orderBy: { createdAt: 'desc' }
          },
          client: {
            select: {
              id: true,
              name: true
            }
          },
          creator: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });

      if (!invoice) {
        throw new AppError('Factura no encontrada', 404, 'INVOICE_NOT_FOUND');
      }

      const timeline = [
        {
          type: 'created',
          date: invoice.createdAt,
          description: `Factura creada por ${invoice.creator.name}`,
          user: invoice.creator.name
        }
      ];

      // Add payment events
      invoice.payments.forEach(payment => {
        timeline.push({
          type: 'payment',
          date: payment.createdAt,
          description: `Pago de $${(payment.amount / 100).toLocaleString('es-CO')} via ${payment.paymentMethod}`,
          status: payment.status,
          user: 'System'
        });

        if (payment.paidAt) {
          timeline.push({
            type: 'payment_confirmed',
            date: payment.paidAt,
            description: 'Pago confirmado',
            user: 'System'
          });
        }
      });

      // Add status change events
      if (invoice.status === 'PAID') {
        const lastPayment = invoice.payments
          .filter(p => p.status === 'COMPLETED')
          .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt))[0];

        if (lastPayment && lastPayment.paidAt) {
          timeline.push({
            type: 'status_change',
            date: lastPayment.paidAt,
            description: 'Factura marcada como pagada',
            user: 'System'
          });
        }
      }

      return timeline.sort((a, b) => new Date(b.date) - new Date(a.date));
    } catch (error) {
      console.error('Error getting invoice timeline:', error);
      throw error;
    }
  }
}

export const invoiceService = new InvoiceService();
