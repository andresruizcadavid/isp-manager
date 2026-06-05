import axios from 'axios';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error.middleware.js';
import { prisma } from '../config/database.js';

class WompiService {
  constructor() {
    this.baseURL     = env.WOMPI_API_URL;
    this.publicKey   = env.WOMPI_PUBLIC_KEY;
    this.privateKey  = env.WOMPI_PRIVATE_KEY;
    // Wompi splits its secret material into TWO distinct keys:
    //   • integrity_secret → signs the *checkout link* (reference+amount+currency)
    //   • events_secret    → signs *webhook events* (properties+timestamp)
    // The official docs are at https://docs.wompi.co/docs/colombia/integridad
    // and https://docs.wompi.co/docs/colombia/eventos. We surface clear errors
    // when each one is missing at the moment it's actually needed, instead of
    // failing silently with a stale undefined.
    this.eventsKey    = env.WOMPI_EVENTS_KEY;
    this.integrityKey = env.WOMPI_INTEGRITY_KEY || null;
  }

  getAuthHeaders() {
    return {
      'Authorization': `Bearer ${this.privateKey}`,
      'Content-Type':  'application/json'
    };
  }

  async createCheckout(invoice) {
    try {
      const checkoutData = {
        amount_in_cents: invoice.amount,
        currency: 'COP',
        customer_data: {
          customer_email: invoice.client.email,
          customer_name: invoice.client.name,
          phone_number: invoice.client.phone
        },
        payment_method: {
          installments_type: 'all'
        },
        reference: invoice.invoiceNumber,
        signature: this.generateCheckoutSignature(invoice.invoiceNumber, invoice.amount, 'COP'),
        redirect_url: `${env.FRONTEND_URL}/invoices/${invoice.id}`,
        expiration_time: new Date(Date.now() + 3600000).toISOString() // 1 hour
      };

      const response = await axios.post(
        `${this.baseURL}/checkout/sessions`,
        checkoutData,
        { headers: this.getAuthHeaders() }
      );

      return response.data.data;
    } catch (error) {
      console.error('Wompi checkout error:', error.response?.data || error.message);
      throw new AppError('Error al crear checkout de Wompi', 500, 'WOMPI_CHECKOUT_ERROR');
    }
  }

  // Checkout signature: sha256(reference + amount_in_cents + currency + integrity_secret).
  // Used to harden the redirect URL so an attacker can't tamper with the
  // amount/reference. The integrity_secret is a different value from the
  // events_secret — see constructor.
  generateCheckoutSignature(reference, amount, currency) {
    if (!this.integrityKey) {
      throw new AppError(
        'WOMPI_INTEGRITY_KEY no está configurado. Agrega la clave de integridad de Wompi al .env.',
        500,
        'WOMPI_INTEGRITY_KEY_MISSING'
      );
    }
    const concatenatedString = `${reference}${amount}${currency}${this.integrityKey}`;
    return crypto.createHash('sha256').update(concatenatedString).digest('hex');
  }

  // Webhook signature per https://docs.wompi.co/docs/colombia/eventos:
  //   1. The body carries `signature: { properties: [...], checksum }`
  //      where each property is a dot-path (e.g. "transaction.id").
  //   2. The body also carries a top-level `timestamp` (epoch seconds).
  //   3. Verification: concat the VALUE of each path (resolved from
  //      body.data.*), append the timestamp (as string), append the
  //      events_secret. Sha256-hex of that must equal `signature.checksum`.
  //
  // This is intentionally a SYNCHRONOUS verifier — no I/O — so it can run
  // inside the webhook route without blocking other ack handling.
  verifyWebhookSignature(body) {
    if (!this.eventsKey) {
      console.error('[wompi.verifyWebhookSignature] WOMPI_EVENTS_KEY missing — rejecting');
      return false;
    }
    const sig = body?.signature;
    const props = Array.isArray(sig?.properties) ? sig.properties : null;
    const checksum = sig?.checksum;
    const timestamp = body?.timestamp;
    if (!props || !checksum || timestamp == null) return false;

    // Resolve a dot-path against body.data, returning the value as string.
    // Wompi prefixes paths with "transaction." for transaction.updated events;
    // those paths are relative to body.data.
    const resolve = (path) => {
      const parts = path.split('.');
      let cur = body.data;
      for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
      }
      return cur;
    };

    let concat = '';
    for (const p of props) {
      const v = resolve(p);
      if (v === undefined) return false; // missing property → reject
      concat += String(v);
    }
    concat += String(timestamp);
    concat += this.eventsKey;

    const expected = crypto.createHash('sha256').update(concat).digest('hex');
    // Constant-time compare so an attacker can't binary-search the checksum.
    try {
      const a = Buffer.from(expected, 'hex');
      const b = Buffer.from(String(checksum), 'hex');
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  // Wompi event shape (transaction.updated):
  //   { event, data: { transaction: { id, reference, status, amount_in_cents, ... } },
  //     signature, timestamp, ... }
  //
  // The controller now passes the whole body, so we reach into
  // `body.data.transaction.*`. Older code passed only `data` — we tolerate
  // both shapes so a future caller still works.
  async handleTransactionUpdate(eventBody) {
    try {
      const tx =
        eventBody?.data?.transaction ||
        eventBody?.transaction        ||
        eventBody?.data               ||
        eventBody;
      const reference     = tx?.reference;
      const status        = tx?.status;
      const amountInCents = tx?.amount_in_cents;
      const transactionId = tx?.id;

      if (!reference || !status || !transactionId) {
        console.warn('[wompi] transaction.updated missing fields', {
          reference, status, transactionId
        });
        return;
      }

      // Find invoice by reference (= invoiceNumber).
      const invoice = await prisma.invoice.findUnique({
        where:   { invoiceNumber: reference },
        include: { client: true, payments: true }
      });
      if (!invoice) {
        console.error(`[wompi] invoice not found for reference: ${reference}`);
        return;
      }

      // Idempotency: a Wompi event for the same transaction may arrive
      // multiple times. Look up by transactionId (UNIQUE in schema).
      const existingPayment = await prisma.payment.findUnique({
        where: { transactionId }
      });

      if (existingPayment) {
        // Update existing payment. The Payment model has no `paidAt` —
        // status='COMPLETED' is the paid signal; createdAt is when the
        // record was inserted.
        await prisma.payment.update({
          where: { id: existingPayment.id },
          data:  { status: this.mapWompiStatus(status) }
        });
        if (status === 'APPROVED') {
          await this.updateInvoiceStatus(invoice);
        }
      } else if (status === 'APPROVED') {
        // First-time approval — create the Payment row. Use the canonical
        // Prisma field names: `method` (PaymentMethod enum), NOT
        // paymentMethod. The schema's UNIQUE(transactionId) makes a
        // concurrent duplicate insert a clean 409 instead of a soft dup.
        await prisma.payment.create({
          data: {
            invoiceId:     invoice.id,
            clientId:      invoice.clientId,
            amount:        amountInCents,
            method:        'WOMPI',
            status:        'COMPLETED',
            transactionId,
            notes:         `Wompi tx ${transactionId}`
          }
        });
        await this.updateInvoiceStatus(invoice);
      } else if (status === 'DECLINED' || status === 'ERROR') {
        await prisma.payment.create({
          data: {
            invoiceId:     invoice.id,
            clientId:      invoice.clientId,
            amount:        amountInCents || 0,
            method:        'WOMPI',
            status:        'FAILED',
            transactionId,
            notes:         `Wompi tx ${transactionId} — ${status}`
          }
        });
      }

      // Side-effects — notification. Best-effort; never let it abort the
      // webhook ack.
      try {
        if (status === 'APPROVED') {
          await this.sendPaymentConfirmation(invoice, transactionId);
        } else if (status === 'DECLINED') {
          await this.sendPaymentFailure(invoice, transactionId);
        }
      } catch (notifErr) {
        console.warn('[wompi] notification failed:', notifErr.message);
      }
    } catch (error) {
      console.error('[wompi] handleTransactionUpdate failed:', error);
      throw error; // controller's outer try-catch will still ack 200
    }
  }

  mapWompiStatus(wompiStatus) {
    const statusMap = {
      'APPROVED': 'COMPLETED',
      'DECLINED': 'FAILED',
      'ERROR': 'FAILED',
      'PENDING': 'PENDING',
      'VOIDED': 'REFUNDED'
    };
    return statusMap[wompiStatus] || 'PENDING';
  }

  // Recompute Invoice.status / balanceDue / paidDate after a payment change.
  // Compares against `total` (amount + tax − discount), NOT `amount`, so the
  // partial-payment math is correct even on invoices with IVA or descuento.
  async updateInvoiceStatus(invoice) {
    const agg = await prisma.payment.aggregate({
      where: { invoiceId: invoice.id, status: 'COMPLETED' },
      _sum:  { amount: true }
    });
    const paid       = agg._sum.amount || 0;
    const total      = invoice.total || invoice.amount;
    const balanceDue = Math.max(0, total - paid);

    let status, paidDate;
    if (paid >= total) {
      status   = 'PAID';
      paidDate = invoice.paidDate || new Date();
    } else if (paid > 0) {
      status   = 'PARTIAL';
      paidDate = null;
    } else {
      // Preserve OVERDUE if the cron already marked it; otherwise PENDING.
      status   = invoice.status === 'OVERDUE' ? 'OVERDUE' : 'PENDING';
      paidDate = null;
    }

    await prisma.invoice.update({
      where: { id: invoice.id },
      data:  { status, balanceDue, paidDate }
    });
  }

  async getTransaction(transactionId) {
    try {
      const response = await axios.get(
        `${this.baseURL}/transactions/${transactionId}`,
        { headers: this.getAuthHeaders() }
      );

      return response.data.data;
    } catch (error) {
      console.error('Wompi get transaction error:', error.response?.data || error.message);
      throw new AppError('Error al obtener transacción de Wompi', 500, 'WOMPI_GET_TRANSACTION_ERROR');
    }
  }

  async refundTransaction(transactionId, amount) {
    try {
      const refundData = {
        amount_in_cents: amount,
        reason: 'Refund requested by customer'
      };

      const response = await axios.post(
        `${this.baseURL}/transactions/${transactionId}/refunds`,
        refundData,
        { headers: this.getAuthHeaders() }
      );

      return response.data.data;
    } catch (error) {
      console.error('Wompi refund error:', error.response?.data || error.message);
      throw new AppError('Error al procesar reembolso en Wompi', 500, 'WOMPI_REFUND_ERROR');
    }
  }

  async createPaymentSource(paymentSourceData) {
    try {
      const response = await axios.post(
        `${this.baseURL}/payment_sources`,
        paymentSourceData,
        { headers: this.getAuthHeaders() }
      );

      return response.data.data;
    } catch (error) {
      console.error('Wompi create payment source error:', error.response?.data || error.message);
      throw new AppError('Error al crear fuente de pago en Wompi', 500, 'WOMPI_CREATE_SOURCE_ERROR');
    }
  }

  async getPaymentSource(paymentSourceId) {
    try {
      const response = await axios.get(
        `${this.baseURL}/payment_sources/${paymentSourceId}`,
        { headers: this.getAuthHeaders() }
      );

      return response.data.data;
    } catch (error) {
      console.error('Wompi get payment source error:', error.response?.data || error.message);
      throw new AppError('Error al obtener fuente de pago de Wompi', 500, 'WOMPI_GET_SOURCE_ERROR');
    }
  }

  async createPaymentIntent(paymentIntentData) {
    try {
      const response = await axios.post(
        `${this.baseURL}/payment_intents`,
        paymentIntentData,
        { headers: this.getAuthHeaders() }
      );

      return response.data.data;
    } catch (error) {
      console.error('Wompi create payment intent error:', error.response?.data || error.message);
      throw new AppError('Error al crear intento de pago en Wompi', 500, 'WOMPI_CREATE_INTENT_ERROR');
    }
  }

  async getPaymentIntent(paymentIntentId) {
    try {
      const response = await axios.get(
        `${this.baseURL}/payment_intents/${paymentIntentId}`,
        { headers: this.getAuthHeaders() }
      );

      return response.data.data;
    } catch (error) {
      console.error('Wompi get payment intent error:', error.response?.data || error.message);
      throw new AppError('Error al obtener intento de pago de Wompi', 500, 'WOMPI_GET_INTENT_ERROR');
    }
  }

  async acceptPaymentIntent(paymentIntentId) {
    try {
      const response = await axios.post(
        `${this.baseURL}/payment_intents/${paymentIntentId}/accept`,
        {},
        { headers: this.getAuthHeaders() }
      );

      return response.data.data;
    } catch (error) {
      console.error('Wompi accept payment intent error:', error.response?.data || error.message);
      throw new AppError('Error al aceptar intento de pago en Wompi', 500, 'WOMPI_ACCEPT_INTENT_ERROR');
    }
  }

  async rejectPaymentIntent(paymentIntentId, reason) {
    try {
      const response = await axios.post(
        `${this.baseURL}/payment_intents/${paymentIntentId}/reject`,
        { reason },
        { headers: this.getAuthHeaders() }
      );

      return response.data.data;
    } catch (error) {
      console.error('Wompi reject payment intent error:', error.response?.data || error.message);
      throw new AppError('Error al rechazar intento de pago en Wompi', 500, 'WOMPI_REJECT_INTENT_ERROR');
    }
  }

  async getTransactionHistory(filters = {}) {
    try {
      const params = new URLSearchParams();
      
      if (filters.startDate) params.append('created_at__gte', filters.startDate);
      if (filters.endDate) params.append('created_at__lte', filters.endDate);
      if (filters.status) params.append('status', filters.status);
      if (filters.limit) params.append('limit', filters.limit);
      if (filters.offset) params.append('offset', filters.offset);

      const response = await axios.get(
        `${this.baseURL}/transactions?${params}`,
        { headers: this.getAuthHeaders() }
      );

      return response.data.data;
    } catch (error) {
      console.error('Wompi get transaction history error:', error.response?.data || error.message);
      throw new AppError('Error al obtener historial de transacciones de Wompi', 500, 'WOMPI_GET_HISTORY_ERROR');
    }
  }

  async getMerchantInfo() {
    try {
      const response = await axios.get(
        `${this.baseURL}/me`,
        { headers: this.getAuthHeaders() }
      );

      return response.data.data;
    } catch (error) {
      console.error('Wompi get merchant info error:', error.response?.data || error.message);
      throw new AppError('Error al obtener información del comerciante de Wompi', 500, 'WOMPI_GET_MERCHANT_ERROR');
    }
  }

  async getPaymentMethods() {
    try {
      const response = await axios.get(
        `${this.baseURL}/payment_methods`,
        { headers: this.getAuthHeaders() }
      );

      return response.data.data;
    } catch (error) {
      console.error('Wompi get payment methods error:', error.response?.data || error.message);
      throw new AppError('Error al obtener métodos de pago de Wompi', 500, 'WOMPI_GET_METHODS_ERROR');
    }
  }

  async createTokenizedCard(cardData) {
    try {
      const response = await axios.post(
        `${this.baseURL}/tokens/cards`,
        cardData,
        { headers: { 'Content-Type': 'application/json' } }
      );

      return response.data.data;
    } catch (error) {
      console.error('Wompi tokenize card error:', error.response?.data || error.message);
      throw new AppError('Error al tokenizar tarjeta en Wompi', 500, 'WOMPI_TOKENIZE_CARD_ERROR');
    }
  }

  async createTokenizedNequi(nequiData) {
    try {
      const response = await axios.post(
        `${this.baseURL}/tokens/nequi`,
        nequiData,
        { headers: { 'Content-Type': 'application/json' } }
      );

      return response.data.data;
    } catch (error) {
      console.error('Wompi tokenize Nequi error:', error.response?.data || error.message);
      throw new AppError('Error al tokenizar Nequi en Wompi', 500, 'WOMPI_TOKENIZE_NEQUI_ERROR');
    }
  }

  async createTokenizedBancolombia(bancolombiaData) {
    try {
      const response = await axios.post(
        `${this.baseURL}/tokens/bancolombia`,
        bancolombiaData,
        { headers: { 'Content-Type': 'application/json' } }
      );

      return response.data.data;
    } catch (error) {
      console.error('Wompi tokenize Bancolombia error:', error.response?.data || error.message);
      throw new AppError('Error al tokenizar Bancolombia en Wompi', 500, 'WOMPI_TOKENIZE_BANCOLOMBIA_ERROR');
    }
  }

  async sendPaymentConfirmation(invoice, transactionId) {
    // This would integrate with notification service
    // For now, just log the confirmation
    console.log(`Payment confirmed for invoice ${invoice.invoiceNumber}, transaction: ${transactionId}`);
  }

  async sendPaymentFailure(invoice, transactionId) {
    // This would integrate with notification service
    // For now, just log the failure
    console.log(`Payment failed for invoice ${invoice.invoiceNumber}, transaction: ${transactionId}`);
  }

  // Helper method to validate webhook integrity
  validateWebhookIntegrity(payload, signature) {
    const integrityKey = this.eventsKey;
    const concatenatedString = JSON.stringify(payload) + integrityKey;
    const expectedSignature = crypto.createHash('sha256').update(concatenatedString).digest('hex');
    
    return signature === expectedSignature;
  }

  // Method to handle different webhook event types
  async handleWebhookEvent(eventType, eventData) {
    switch (eventType) {
      case 'transaction.updated':
        await this.handleTransactionUpdate(eventData);
        break;
      case 'payment_intent.updated':
        await this.handlePaymentIntentUpdate(eventData);
        break;
      case 'subscription.created':
        await this.handleSubscriptionCreated(eventData);
        break;
      case 'subscription.updated':
        await this.handleSubscriptionUpdated(eventData);
        break;
      default:
        console.log(`Unhandled webhook event type: ${eventType}`);
    }
  }

  async handlePaymentIntentUpdate(paymentIntentData) {
    // Handle payment intent updates
    console.log('Payment intent updated:', paymentIntentData);
  }

  async handleSubscriptionCreated(subscriptionData) {
    // Handle subscription creation (for recurring payments)
    console.log('Subscription created:', subscriptionData);
  }

  async handleSubscriptionUpdated(subscriptionData) {
    // Handle subscription updates
    console.log('Subscription updated:', subscriptionData);
  }
}

export const wompiService = new WompiService();
