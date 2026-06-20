import axios from 'axios';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error.middleware.js';
import { prisma } from '../config/database.js';
import { dispatch, NOTIFICATION_TYPES } from './notification-orchestrator.service.js';

class WompiService {
  constructor() {
    this.baseURL     = env.WOMPI_API_URL;
    this.publicKey   = env.WOMPI_PUBLIC_KEY;
    this.privateKey  = env.WOMPI_PRIVATE_KEY;
    this.eventsKey   = env.WOMPI_EVENTS_KEY;
    this.integrityKey= env.WOMPI_INTEGRITY_KEY || null;
  }

  // Load keys from the active DB config row (if any), falling back to .env.
  // Call after the user saves/updates Wompi keys via the UI so the in-memory
  // singleton picks up the new values without a process restart.
  async loadConfigFromDb() {
    try {
      const config = await prisma.wompiConfig.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' }
      });
      if (config) {
        this.publicKey    = config.publicKey;
        this.privateKey   = config.privateKey;
        this.eventsKey    = config.eventsKey;
        this.integrityKey = config.integrityKey || null;
        // Keep the API base URL consistent with the configured environment.
        // Wompi REQUIRES env-matched keys+URL: sandbox keys only authenticate
        // against sandbox.wompi.co and prod keys only against production.wompi.co
        // (https://docs.wompi.co/docs/colombia/ambientes-y-llaves). Without this,
        // saving sandbox keys via the UI would silently keep hitting production
        // and every checkout would 401.
        this.baseURL = this.resolveBaseURL(config.environment, config.privateKey);
      }
    } catch (e) {
      console.warn('[wompi] loadConfigFromDb failed, using .env fallback:', e.message);
    }
  }

  // Resolve the correct Wompi API base URL for a given environment/key pair.
  // The private-key prefix is the authoritative signal (prv_test_ / prv_prod_);
  // the `environment` column is a secondary hint; env.WOMPI_API_URL is the last
  // resort. This prevents a mislabeled `environment` column from routing
  // sandbox keys to production (or vice-versa).
  resolveBaseURL(environment, privateKey = '') {
    if ((privateKey || '').startsWith('prv_prod_')) return 'https://production.wompi.co/v1';
    if ((privateKey || '').startsWith('prv_test_')) return 'https://sandbox.wompi.co/v1';
    if (environment === 'sandbox')    return 'https://sandbox.wompi.co/v1';
    if (environment === 'production') return 'https://production.wompi.co/v1';
    return env.WOMPI_API_URL;
  }

  getAuthHeaders() {
    return {
      'Authorization': `Bearer ${this.privateKey}`,
      'Content-Type':  'application/json'
    };
  }

  // Creates a Wompi Payment Link (Link de Pago) and persists the attempt
  // for full traceability. The frontend redirects the customer to the
  // returned checkoutUrl; Wompi handles the payment UX. The webhook
  // handler (handleTransactionUpdate) matches the transaction back to
  // the attempt via payment_link_id and updates its status.
  async createCheckout(invoice, options = {}) {
    await this.loadConfigFromDb();
    const amountInCents = invoice.balanceDue > 0 ? invoice.balanceDue : (invoice.total || invoice.amount);
    const currency = 'COP';
    const reference = this.generateReference(invoice);

    // Persist attempt BEFORE the API call
    const attempt = await prisma.paymentAttempt.create({
      data: {
        invoiceId: invoice.id,
        clientId: invoice.clientId,
        reference,
        amount: amountInCents,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 3600000),
      }
    });

    try {
      const redirectUrl = options.redirectUrl || `${env.FRONTEND_URL}/invoices/${invoice.id}?wompi_attempt=${attempt.id}`;
      const linkData = {
        name: `Pago factura ${invoice.invoiceNumber}`,
        description: `Factura servicio internet - ${invoice.invoiceNumber}`,
        single_use: true,
        collect_shipping: false,
        currency,
        amount_in_cents: amountInCents,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        redirect_url: redirectUrl,
      };

      const response = await axios.post(
        `${this.baseURL}/payment_links`,
        linkData,
        { headers: this.getAuthHeaders() }
      );

      const result = response.data?.data;
      // Never fabricate a checkout URL. If Wompi answers 2xx without a link id
      // the response is unusable — fail loudly so the caller doesn't surface a
      // broken `.../l/undefined` link as a success.
      if (!result?.id) {
        throw new AppError(
          'Wompi no devolvió un ID de link de pago válido',
          502,
          'WOMPI_INVALID_RESPONSE'
        );
      }
      const checkoutUrl = `https://checkout.wompi.co/l/${result.id}`;

      // Update the attempt with Wompi's response
      await prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: { checkoutUrl, externalId: result.id }
      });

      return { checkoutUrl, paymentAttemptId: attempt.id, wompiLinkId: result.id, reference };
    } catch (error) {
      await prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: { status: 'FAILED', webhookPayload: error.response?.data || { error: error.message } }
      }).catch(e => console.error('[wompi] Failed to mark attempt as FAILED:', e.message));

      const wompiError = error.response?.data || { message: error.message };
      console.error('[wompi] createCheckout failed:', JSON.stringify(wompiError));
      const errDetail = wompiError?.error;
      const errMsg = errDetail?.reason || errDetail?.message || wompiError?.message || JSON.stringify(wompiError);
      const appError = new AppError(errMsg, 500, 'WOMPI_CHECKOUT_ERROR');
      appError.wompiResponse = wompiError;
      throw appError;
    }
  }

  // Generate a unique, traceable reference for each checkout attempt.
  // Format: {invoiceNumber}-{timestamp}-{random4chars}
  // e.g. INV-0007-mq5ny1op-d3e5
  // This guarantees uniqueness even if the same invoice is retried.
  generateReference(invoice) {
    const ts = Date.now().toString(36);
    const rand = crypto.randomBytes(2).toString('hex');
    const number = invoice.invoiceNumber || invoice.id.slice(-8);
    return `${number}-${ts}-${rand}`;
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

      // Resolve invoice. Three strategies (tried in order):
      //   1. By reference — {invoiceNumber} or {invoiceNumber}-{ts}-{rand}
      //   2. By payment_link_id — maps to PaymentAttempt.externalId
      let invoice;

      const parts = reference.split('-');
      const invoiceNumber = parts.length >= 3
        ? parts.slice(0, -2).join('-')
        : reference;
      invoice = await prisma.invoice.findUnique({
        where:   { invoiceNumber },
        include: { client: true, payments: true }
      });

      if (!invoice && tx.payment_link_id) {
        const attempt = await prisma.paymentAttempt.findFirst({
          where: { externalId: tx.payment_link_id }
        });
        if (attempt) {
          invoice = await prisma.invoice.findUnique({
            where: { id: attempt.invoiceId },
            include: { client: true, payments: true }
          });
        }
      }

      if (!invoice) {
        console.error(`[wompi] invoice not found`, {
          reference, invoiceNumber, payment_link_id: tx.payment_link_id
        });
        return;
      }

      // Update the PaymentAttempt traceability record. Try both matching
      // strategies so this works for payment-link and direct-API flows.
      const mappedStatus = this.mapWompiStatus(status);
      await prisma.paymentAttempt.updateMany({
        where: { reference },
        data: { status: mappedStatus, webhookPayload: eventBody, externalId: transactionId }
      });
      if (tx.payment_link_id) {
        await prisma.paymentAttempt.updateMany({
          where: { externalId: tx.payment_link_id },
          data: { status: mappedStatus, webhookPayload: eventBody }
        });
      }

      // Sync PaymentLink.status so the admin and portal see the real state.
      // Matches by invoiceId or by the paymentAttemptId that was just updated.
      const paymentLinkStatusMap = {
        'COMPLETED': 'paid',
        'FAILED':    'cancelled',
        'REFUNDED':  'cancelled'
      };
      const plStatus = paymentLinkStatusMap[mappedStatus] || 'pending';
      await prisma.paymentLink.updateMany({
        where: { invoiceId: invoice.id },
        data:  { status: plStatus, paidAt: mappedStatus === 'COMPLETED' ? new Date() : undefined }
      });

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

      // Side-effects — notification via the orchestrator. Best-effort; never
      // let it abort the webhook ack.
      try {
        if (status === 'APPROVED' && invoice.client) {
          dispatch({
            type: NOTIFICATION_TYPES.PAYMENT_RECEIVED,
            client: invoice.client,
            payload: {
              invoice,
              payment: { amount: amountInCents }
            }
          }).catch(e => console.warn('[wompi] PAYMENT_RECEIVED dispatch failed:', e.message));
        } else if (status === 'DECLINED' && invoice.client) {
          dispatch({
            type: NOTIFICATION_TYPES.PAYMENT_FAILED,
            client: invoice.client,
            payload: {
              invoice,
              cta: { text: 'Reintentar pago', url: `${env.FRONTEND_URL}/invoices/${invoice.id}` }
            }
          }).catch(e => console.warn('[wompi] PAYMENT_FAILED dispatch failed:', e.message));
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

  // Lightweight auth test — creates a minimal payment link without persisting
  // anything. Used by the Wompi-config test route; does NOT create an attempt
  // or payment_link DB row.
  async createRawPaymentLink(linkData) {
    try {
      const response = await axios.post(
        `${this.baseURL}/payment_links`,
        linkData,
        { headers: this.getAuthHeaders() }
      );
      return response.data.data;
    } catch (error) {
      console.error('[wompi] createRawPaymentLink failed:', error.response?.data || error.message);
      const wompiError = error.response?.data || {};
      const errDetail = wompiError?.error;
      const errMsg = errDetail?.reason || errDetail?.message || error.message;
      throw new AppError(errMsg, 500, 'WOMPI_RAW_LINK_ERROR');
    }
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
// Load DB config at startup so keys from the UI take effect immediately
wompiService.loadConfigFromDb().catch(() => {});
