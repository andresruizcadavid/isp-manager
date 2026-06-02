import { prisma } from '../config/database.js';
import { invoiceService } from './invoice.service.js';
import { AppError } from '../middleware/error.middleware.js';

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

function getMonthName(m) { return MONTHS[m - 1]; }

class BillingService {
  async getBillingMonths(clientId, year) {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: { plan: true }
    });
    if (!client) throw new AppError('Cliente no encontrado', 404, 'CLIENT_NOT_FOUND');

    const monthlyFee = client.monthlyFee > 0 ? client.monthlyFee : (client.plan?.monthlyPrice || 0);

    const invoices = await prisma.invoice.findMany({
      where: { clientId, periodYear: year },
      include: { payments: true }
    });

    const months = [];
    for (let m = 1; m <= 12; m++) {
      const inv = invoices.find(i => i.periodMonth === m);
      let status = 'no_invoice';
      let invoice = null;

      if (inv) {
        if (inv.status === 'PAID') status = 'paid';
        else if (inv.status === 'OVERDUE') status = 'overdue';
        else if (['PENDING', 'PARTIAL', 'DRAFT'].includes(inv.status)) status = 'pending';
        else if (inv.status === 'CANCELLED') status = 'cancelled';
        invoice = { id: inv.id, number: inv.number, amount: inv.amount, total: inv.total, status: inv.status, balanceDue: inv.balanceDue };
      }

      months.push({
        month: m,
        year,
        status,
        amount: monthlyFee,
        invoice,
        label: getMonthName(m)
      });
    }

    const totals = {
      paid: months.filter(m => m.status === 'paid').length,
      pending: months.filter(m => m.status === 'pending' || m.status === 'overdue').length,
      noInvoice: months.filter(m => m.status === 'no_invoice').length,
    };

    return { months, totals, client: { id: client.id, name: client.name, monthlyFee, planName: client.plan?.name } };
  }

  async generateInvoices(clientId, months, userId) {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: { plan: true }
    });
    if (!client) throw new AppError('Cliente no encontrado', 404, 'CLIENT_NOT_FOUND');

    const monthlyFee = client.monthlyFee > 0 ? client.monthlyFee : (client.plan?.monthlyPrice || 0);
    if (monthlyFee <= 0) throw new AppError('Este cliente no tiene un plan asignado. Asigna un plan antes de generar factura.', 400, 'NO_MONTHLY_FEE');

    const results = [];

    for (const { year, month } of months) {
      let invoice = await prisma.invoice.findFirst({
        where: { clientId, periodYear: year, periodMonth: month }
      });

      if (invoice) {
        if (invoice.status === 'PAID') {
          throw new AppError(`${getMonthName(month)} ${year} ya está pagado`, 409, 'MONTH_ALREADY_PAID');
        }
        if (invoice.status === 'CANCELLED') {
          throw new AppError(`${getMonthName(month)} ${year} está cancelado`, 409, 'MONTH_CANCELLED');
        }
        results.push({ invoice, action: 'reused' });
      } else {
        const periodStart = new Date(year, month - 1, 1);
        const periodEnd = new Date(year, month, 0);
        const dueDate = new Date(year, month - 1, 15);

        const invoiceNumber = await invoiceService.generateInvoiceNumber();
        invoice = await prisma.invoice.create({
          data: {
            number: invoiceNumber,
            clientId,
            amount: monthlyFee,
            total: monthlyFee,
            status: 'PENDING',
            balanceDue: monthlyFee,
            issueDate: new Date(),
            dueDate,
            periodYear: year,
            periodMonth: month,
          }
        });
        results.push({ invoice, action: 'created' });
      }
    }

    const totalAmount = results.reduce((sum, r) => sum + r.invoice.total, 0);

    return {
      invoices: results.map(r => ({
        invoice: { id: r.invoice.id, number: r.invoice.number, amount: r.invoice.amount, total: r.invoice.total, status: r.invoice.status, balanceDue: r.invoice.balanceDue },
        action: r.action
      })),
      totalAmount,
      totalCreated: results.filter(r => r.action === 'created').length,
      totalReused: results.filter(r => r.action === 'reused').length,
      client: { id: client.id, name: client.name, monthlyFee }
    };
  }

  async registerPayment(clientId, invoiceIds, totalAmountCents, method, notes, paymentDate, userId = null, userName = null) {
    const invoices = await prisma.invoice.findMany({
      where: { id: { in: invoiceIds }, clientId },
      include: { payments: true }
    });

    if (invoices.length !== invoiceIds.length) {
      throw new AppError('Una o más facturas no encontradas', 404, 'INVOICES_NOT_FOUND');
    }

    for (const inv of invoices) {
      if (inv.status === 'PAID') throw new AppError(`Factura ${inv.number} ya está pagada`, 409, 'INVOICE_ALREADY_PAID');
      if (inv.status === 'CANCELLED') throw new AppError(`Factura ${inv.number} está cancelada`, 409, 'INVOICE_CANCELLED');
    }

    const totalDue = invoices.reduce((sum, inv) => sum + inv.balanceDue, 0);
    if (totalAmountCents > totalDue) {
      throw new AppError(`El monto (${(totalAmountCents / 100).toLocaleString('es-CO')}) excede el total debido (${(totalDue / 100).toLocaleString('es-CO')})`, 400, 'AMOUNT_EXCEEDS_DUE');
    }

    // Distribute payment: pay invoices in order (oldest first)
    let remaining = totalAmountCents;
    const paymentPromises = [];
    const updatePromises = [];

    const sortedInvoices = invoices.sort((a, b) => a.dueDate - b.dueDate);

    for (const inv of sortedInvoices) {
      if (remaining <= 0) break;

      const payAmount = Math.min(remaining, inv.balanceDue);
      const previousPaid = inv.payments
        .filter(p => p.status === 'COMPLETED')
        .reduce((sum, p) => sum + p.amount, 0);
      const newTotalPaid = previousPaid + payAmount;
      const newBalanceDue = Math.max(0, inv.amount - newTotalPaid);
      const newStatus = newBalanceDue === 0 ? 'PAID' : 'PARTIAL';

      paymentPromises.push(
        prisma.payment.create({
          data: {
            invoiceId: inv.id,
            clientId,
            amount: payAmount,
            method,
            status: 'COMPLETED',
            notes: notes || null,
            createdByUserId: userId,
            createdByUserName: userName,
            createdAt: paymentDate ? new Date(paymentDate) : new Date()
          }
        })
      );

      updatePromises.push(
        prisma.invoice.update({
          where: { id: inv.id },
          data: {
            status: newStatus,
            balanceDue: newBalanceDue,
            ...(newStatus === 'PAID' && { paidDate: paymentDate ? new Date(paymentDate) : new Date() })
          }
        })
      );

      remaining -= payAmount;
    }

    const results = await prisma.$transaction([
      ...paymentPromises,
      ...updatePromises
    ]);

    const createdPayments = results.slice(0, paymentPromises.length);

    return {
      payments: createdPayments,
      fullyPaid: updatePromises.length,
      invoices: sortedInvoices.map(inv => {
        const matched = createdPayments.find(p => p.invoiceId === inv.id);
        return {
          invoiceId: inv.id,
          number: inv.number,
          paidAmount: matched?.amount || 0
        };
      })
    };
  }
}

export const billingService = new BillingService();
