import axios from 'axios';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error.middleware.js';
import { prisma } from '../config/database.js';

class WompiService {
  constructor() {
    this.baseURL = env.WOMPI_API_URL;
    this.publicKey = env.WOMPI_PUBLIC_KEY;
    this.privateKey = env.WOMPI_PRIVATE_KEY;
    this.eventsKey = env.WOMPI_EVENTS_KEY;
  }

  getAuthHeaders() {
    const authString = `${this.publicKey}:`;
    return {
      'Authorization': `Bearer ${this.privateKey}`,
      'Content-Type': 'application/json'
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

  generateCheckoutSignature(reference, amount, currency) {
    const concatenatedString = `${reference}${amount}${currency}${this.integrityKey}`;
    return crypto.createHash('sha256').update(concatenatedString).digest('hex');
  }

  async verifyWebhookSignature(payload, signature) {
    const concatenatedString = JSON.stringify(payload) + this.eventsKey;
    const expectedSignature = crypto.createHash('sha256').update(concatenatedString).digest('hex');
    return signature === expectedSignature;
  }

  async handleTransactionUpdate(transactionData) {
    try {
      const { reference, status, amount_in_cents, id: transactionId } = transactionData.data;

      // Find invoice by reference (invoiceNumber)
      const invoice = await prisma.invoice.findUnique({
        where: { invoiceNumber: reference },
        include: {
          client: true,
          payments: true
        }
      });

      if (!invoice) {
        console.error(`Invoice not found for reference: ${reference}`);
        return;
      }

      // Check if payment already exists
      const existingPayment = await prisma.payment.findFirst({
        where: { transactionId }
      });

      if (existingPayment) {
        // Update existing payment status
        await prisma.payment.update({
          where: { id: existingPayment.id },
          data: {
            status: this.mapWompiStatus(status),
            paidAt: status === 'APPROVED' ? new Date() : null
          }
        });

        // Update invoice status if payment is approved
        if (status === 'APPROVED') {
          await this.updateInvoiceStatus(invoice);
        }
      } else {
        // Create new payment record
        if (status === 'APPROVED') {
          await prisma.payment.create({
            data: {
              invoiceId: invoice.id,
              amount: amount_in_cents,
              paymentMethod: 'WOMPI',
              status: 'COMPLETED',
              transactionId,
              paidAt: new Date()
            }
          });

          await this.updateInvoiceStatus(invoice);
        } else if (status === 'DECLINED' || status === 'ERROR') {
          await prisma.payment.create({
            data: {
              invoiceId: invoice.id,
              amount: amount_in_cents,
              paymentMethod: 'WOMPI',
              status: 'FAILED',
              transactionId
            }
          });
        }
      }

      // Send notification based on status
      if (status === 'APPROVED') {
        await this.sendPaymentConfirmation(invoice, transactionId);
      } else if (status === 'DECLINED') {
        await this.sendPaymentFailure(invoice, transactionId);
      }

    } catch (error) {
      console.error('Error handling Wompi transaction update:', error);
      throw error;
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

  async updateInvoiceStatus(invoice) {
    // Get all completed payments for this invoice
    const completedPayments = await prisma.payment.aggregate({
      where: {
        invoiceId: invoice.id,
        status: 'COMPLETED'
      },
      _sum: { amount: true }
    });

    // Check if invoice is fully paid
    if (completedPayments._sum.amount >= invoice.amount) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'PAID' }
      });
    }
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
