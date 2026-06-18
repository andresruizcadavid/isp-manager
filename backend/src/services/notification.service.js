import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error.middleware.js';
import { prisma } from '../config/database.js';
import { renderEmailTemplate, EMAIL_PRESETS } from './email-base.template.js';

class NotificationService {
  constructor() {
    // Transporter is built lazily on first send so SMTP config edits from
    // the UI take effect without a restart. A short TTL cache avoids hitting
    // the DB on every send during a campaign batch.
    this._cachedTransporter = null;
    this._cachedAt = 0;
    this._cachedFrom = null;            // { fromEmail, fromName } source for sendMail.from
    this.CACHE_TTL_MS = 60_000;
  }

  /** Force a refetch of SMTP config on next send (called by /smtp routes). */
  invalidateTransporter() {
    this._cachedTransporter = null;
    this._cachedAt = 0;
    this._cachedFrom = null;
  }

  /**
   * Returns a nodemailer transporter built from the active SmtpConfig row.
   * Falls back to .env values if no row is active. Caches for 60s.
   */
  async getTransporter() {
    if (this._cachedTransporter && Date.now() - this._cachedAt < this.CACHE_TTL_MS) {
      return { transporter: this._cachedTransporter, from: this._cachedFrom };
    }

    let cfg = null;
    try {
      cfg = await prisma.smtpConfig.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' }
      });
    } catch { /* table may not exist on first run — fall back to env */ }

    // Audit log — makes it explicit in backend logs which SMTP source is
    // actually being used. Useful when debugging "did the campaign use the
    // SMTP I configured in the UI, or the legacy .env one?".
    if (cfg) {
      console.log(`[notification.smtp] source=DB host=${cfg.host}:${cfg.port} secure=${cfg.secure} user=${cfg.username} from="${cfg.fromName} <${cfg.fromEmail}>"`);
    } else {
      console.log(`[notification.smtp] source=ENV host=${env.SMTP_HOST}:${env.SMTP_PORT} user=${env.SMTP_USER} (no SmtpConfig row found)`);
    }

    const transporter = nodemailer.createTransport(cfg ? {
      host:   cfg.host,
      port:   cfg.port,
      secure: cfg.secure,
      auth:   { user: cfg.username, pass: cfg.password },
      tls:    { rejectUnauthorized: false }
    } : {
      host:   env.SMTP_HOST,
      port:   env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth:   { user: env.SMTP_USER, pass: env.SMTP_PASS }
    });

    const from = cfg
      ? { fromEmail: cfg.fromEmail, fromName: cfg.fromName || env.COMPANY_NAME }
      : { fromEmail: env.SMTP_USER,  fromName: env.COMPANY_NAME };

    this._cachedTransporter = transporter;
    this._cachedFrom = from;
    this._cachedAt = Date.now();
    return { transporter, from };
  }

  /** Backwards-compat alias — keep this so existing references don't break. */
  get emailTransporter() {
    // Legacy callers used `this.emailTransporter.sendMail(...)`. Lazy-init
    // synchronously with env-based values for that one call; the new flow
    // should `await this.getTransporter()` instead.
    if (!this._legacyTransporter) {
      this._legacyTransporter = nodemailer.createTransport({
        host: env.SMTP_HOST, port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }
      });
    }
    return this._legacyTransporter;
  }

  async sendInvoiceNotification(invoice) {
    try {
      // Send email
      await this.sendEmail({
        to: invoice.client.email,
        subject: `Nueva Factura - ${invoice.invoiceNumber}`,
        template: 'invoice',
        data: {
          invoice,
          client: invoice.client,
          company: {
            name: env.COMPANY_NAME,
            nit: env.COMPANY_NIT,
            city: env.COMPANY_CITY,
            address: env.COMPANY_ADDRESS,
            phone: env.COMPANY_PHONE,
            email: env.COMPANY_EMAIL
          }
        }
      });

      // Log notification
      await this.logNotification(invoice.clientId, 'INVOICE_GENERATED', 'EMAIL', `Factura ${invoice.invoiceNumber} generada`);

      return true;
    } catch (error) {
      console.error('Error sending invoice notification:', error);
      await this.logNotification(invoice.clientId, 'INVOICE_GENERATED', 'EMAIL', `Factura ${invoice.invoiceNumber} generada`, 'FAILED', error.message);
      return false;
    }
  }

  async sendPaymentReminder(invoice) {
    try {
      const daysOverdue = Math.floor((new Date() - invoice.dueDate) / (1000 * 60 * 60 * 24));
      const reminderType = daysOverdue > 0 ? 'PAYMENT_OVERDUE' : 'PAYMENT_DUE';

      // Send email
      await this.sendEmail({
        to: invoice.client.email,
        subject: daysOverdue > 0 
          ? `Recordatorio de Pago Vencido - ${invoice.invoiceNumber}`
          : `Recordatorio de Pago - ${invoice.invoiceNumber}`,
        template: 'payment_reminder',
        data: {
          invoice,
          client: invoice.client,
          daysOverdue,
          company: {
            name: env.COMPANY_NAME,
            nit: env.COMPANY_NIT,
            city: env.COMPANY_CITY,
            address: env.COMPANY_ADDRESS,
            phone: env.COMPANY_PHONE,
            email: env.COMPANY_EMAIL
          }
        }
      });

      // Send SMS if phone number is available
      if (invoice.client.phone) {
        await this.sendSMS({
          to: invoice.client.phone,
          message: daysOverdue > 0
            ? `${env.COMPANY_NAME}: Su factura ${invoice.invoiceNumber} esta vencida hace ${daysOverdue} dias. Por favor regularice su pago.`
            : `${env.COMPANY_NAME}: Recordatorio pago factura ${invoice.invoiceNumber} vence el ${invoice.dueDate.toLocaleDateString()}.`
        });

        await this.logNotification(invoice.clientId, reminderType, 'SMS', `Recordatorio factura ${invoice.invoiceNumber}`);
      }

      // Send WhatsApp if available
      if (invoice.client.phone) {
        await this.sendWhatsApp({
          to: invoice.client.phone,
          message: this.buildWhatsAppPaymentReminder(invoice, daysOverdue),
          event: 'PAYMENT_REMINDER',
          // Orden: nombre, n° factura, monto, vencimiento, link de pago
          buildParams: async () => [
            invoice.client?.name || 'cliente',
            invoice.invoiceNumber,
            this._waMoney(invoice.total ?? invoice.amount),
            this._waDate(invoice.dueDate),
            await this._waPayLink(invoice.id)
          ]
        });

        await this.logNotification(invoice.clientId, reminderType, 'WHATSAPP', `Recordatorio factura ${invoice.invoiceNumber}`);
      }

      await this.logNotification(invoice.clientId, reminderType, 'EMAIL', `Recordatorio factura ${invoice.invoiceNumber}`);

      return true;
    } catch (error) {
      console.error('Error sending payment reminder:', error);
      await this.logNotification(invoice.clientId, 'PAYMENT_REMINDER', 'EMAIL', `Recordatorio factura ${invoice.invoiceNumber}`, 'FAILED', error.message);
      return false;
    }
  }

  async sendPaymentConfirmation(invoice, payment) {
    try {
      // Send email
      await this.sendEmail({
        to: invoice.client.email,
        subject: `Confirmación de Pago - ${invoice.invoiceNumber}`,
        template: 'payment_confirmation',
        data: {
          invoice,
          payment,
          client: invoice.client,
          company: {
            name: env.COMPANY_NAME,
            nit: env.COMPANY_NIT,
            city: env.COMPANY_CITY,
            address: env.COMPANY_ADDRESS,
            phone: env.COMPANY_PHONE,
            email: env.COMPANY_EMAIL
          }
        }
      });

      // Send SMS confirmation
      if (invoice.client.phone) {
        await this.sendSMS({
          to: invoice.client.phone,
          message: `${env.COMPANY_NAME}: Hemos recibido su pago de $${(payment.amount / 100).toLocaleString('es-CO')} por factura ${invoice.invoiceNumber}. Gracias!`
        });

        await this.logNotification(invoice.clientId, 'PAYMENT_CONFIRMATION', 'SMS', `Confirmación pago factura ${invoice.invoiceNumber}`);
      }

      // Send WhatsApp confirmation
      if (invoice.client.phone) {
        await this.sendWhatsApp({
          to: invoice.client.phone,
          message: this.buildWhatsAppPaymentConfirmation(invoice, payment),
          event: 'PAYMENT_CONFIRMATION',
          // Orden: nombre, monto pagado, n° factura
          buildParams: async () => [
            invoice.client?.name || 'cliente',
            this._waMoney(payment.amount),
            invoice.invoiceNumber
          ]
        });

        await this.logNotification(invoice.clientId, 'PAYMENT_CONFIRMATION', 'WHATSAPP', `Confirmación pago factura ${invoice.invoiceNumber}`);
      }

      await this.logNotification(invoice.clientId, 'PAYMENT_CONFIRMATION', 'EMAIL', `Confirmación pago factura ${invoice.invoiceNumber}`);

      return true;
    } catch (error) {
      console.error('Error sending payment confirmation:', error);
      await this.logNotification(invoice.clientId, 'PAYMENT_CONFIRMATION', 'EMAIL', `Confirmación pago factura ${invoice.invoiceNumber}`, 'FAILED', error.message);
      return false;
    }
  }

  async sendServiceSuspension(client) {
    try {
      // Send email
      await this.sendEmail({
        to: client.email,
        subject: 'Servicio Suspendido',
        template: 'service_suspension',
        data: {
          client,
          company: {
            name: env.COMPANY_NAME,
            nit: env.COMPANY_NIT,
            city: env.COMPANY_CITY,
            address: env.COMPANY_ADDRESS,
            phone: env.COMPANY_PHONE,
            email: env.COMPANY_EMAIL
          }
        }
      });

      // Send SMS
      if (client.phone) {
        await this.sendSMS({
          to: client.phone,
          message: `${env.COMPANY_NAME}: Su servicio de internet ha sido suspendido por falta de pago. Contactenos para regularizar.`
        });

        await this.logNotification(client.id, 'SERVICE_SUSPENSION', 'SMS', 'Servicio suspendido');
      }

      // Send WhatsApp
      if (client.phone) {
        await this.sendWhatsApp({
          to: client.phone,
          message: this.buildWhatsAppServiceSuspension(client),
          event: 'SERVICE_SUSPENSION',
          // Orden: nombre, saldo pendiente, link de pago
          buildParams: async () => [
            client.name,
            this._waMoney(client.balance),
            await this._waPayLinkForClient(client.id)
          ]
        });

        await this.logNotification(client.id, 'SERVICE_SUSPENSION', 'WHATSAPP', 'Servicio suspendido');
      }

      await this.logNotification(client.id, 'SERVICE_SUSPENSION', 'EMAIL', 'Servicio suspendido');

      return true;
    } catch (error) {
      console.error('Error sending service suspension notification:', error);
      await this.logNotification(client.id, 'SERVICE_SUSPENSION', 'EMAIL', 'Servicio suspendido', 'FAILED', error.message);
      return false;
    }
  }

  async sendServiceActivation(client) {
    try {
      // Send email
      await this.sendEmail({
        to: client.email,
        subject: 'Servicio Reactivado',
        template: 'service_activation',
        data: {
          client,
          company: {
            name: env.COMPANY_NAME,
            nit: env.COMPANY_NIT,
            city: env.COMPANY_CITY,
            address: env.COMPANY_ADDRESS,
            phone: env.COMPANY_PHONE,
            email: env.COMPANY_EMAIL
          }
        }
      });

      // Send SMS
      if (client.phone) {
        await this.sendSMS({
          to: client.phone,
          message: `${env.COMPANY_NAME}: Su servicio de internet ha sido reactivo. Bienvenido de vuelta!`
        });

        await this.logNotification(client.id, 'SERVICE_ACTIVATION', 'SMS', 'Servicio reactivo');
      }

      // Send WhatsApp
      if (client.phone) {
        await this.sendWhatsApp({
          to: client.phone,
          message: this.buildWhatsAppServiceActivation(client),
          event: 'SERVICE_ACTIVATION',
          // Orden: nombre
          buildParams: async () => [client.name]
        });

        await this.logNotification(client.id, 'SERVICE_ACTIVATION', 'WHATSAPP', 'Servicio reactivo');
      }

      await this.logNotification(client.id, 'SERVICE_ACTIVATION', 'EMAIL', 'Servicio reactivo');

      return true;
    } catch (error) {
      console.error('Error sending service activation notification:', error);
      await this.logNotification(client.id, 'SERVICE_ACTIVATION', 'EMAIL', 'Servicio reactivo', 'FAILED', error.message);
      return false;
    }
  }

  async sendInstallationScheduled(client, installationDate) {
    try {
      // Send email
      await this.sendEmail({
        to: client.email,
        subject: 'Instalación Programada',
        template: 'installation_scheduled',
        data: {
          client,
          installationDate,
          company: {
            name: env.COMPANY_NAME,
            nit: env.COMPANY_NIT,
            city: env.COMPANY_CITY,
            address: env.COMPANY_ADDRESS,
            phone: env.COMPANY_PHONE,
            email: env.COMPANY_EMAIL
          }
        }
      });

      // Send SMS
      if (client.phone) {
        await this.sendSMS({
          to: client.phone,
          message: `${env.COMPANY_NAME}: Su instalación esta programada para el ${installationDate.toLocaleDateString()}. Confirmaremos por llamada.`
        });

        await this.logNotification(client.id, 'INSTALLATION_SCHEDULED', 'SMS', 'Instalación programada');
      }

      await this.logNotification(client.id, 'INSTALLATION_SCHEDULED', 'EMAIL', 'Instalación programada');

      return true;
    } catch (error) {
      console.error('Error sending installation scheduled notification:', error);
      await this.logNotification(client.id, 'INSTALLATION_SCHEDULED', 'EMAIL', 'Instalación programada', 'FAILED', error.message);
      return false;
    }
  }

  async sendGeneralAnnouncement(subject, message, targetClients = null) {
    try {
      let clients;
      
      if (targetClients && targetClients.length > 0) {
        clients = await prisma.client.findMany({
          where: { id: { in: targetClients } }
        });
      } else {
        clients = await prisma.client.findMany({
          where: { status: 'ACTIVE' }
        });
      }

      const results = await Promise.allSettled(
        clients.map(async (client) => {
          // Send email
          await this.sendEmail({
            to: client.email,
            subject: `${env.COMPANY_NAME}: ${subject}`,
            template: 'general_announcement',
            data: {
              client,
              subject,
              message,
              company: {
                name: env.COMPANY_NAME,
                nit: env.COMPANY_NIT,
                city: env.COMPANY_CITY,
                address: env.COMPANY_ADDRESS,
                phone: env.COMPANY_PHONE,
                email: env.COMPANY_EMAIL
              }
            }
          });

          await this.logNotification(client.id, 'GENERAL_ANNOUNCEMENT', 'EMAIL', `Anuncio: ${subject}`);
        })
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      return { successful, failed, total: clients.length };
    } catch (error) {
      console.error('Error sending general announcement:', error);
      throw new AppError('Error al enviar anuncio general', 500, 'ANNOUNCEMENT_ERROR');
    }
  }

  async sendEmail(options) {
    const { to, subject, template, data } = options;

    // Resolve the structured shape ({ preset, title, body, fields }) for the
    // requested template — then render once through the shared base.
    const built = this.buildEmailTemplate(template, data);
    const { transporter, from } = await this.getTransporter();

    const html = renderEmailTemplate({
      icon:          EMAIL_PRESETS[built.preset]?.icon  || EMAIL_PRESETS.general_announcement.icon,
      title:         built.title || subject || EMAIL_PRESETS[built.preset]?.title || 'Aviso',
      body:          built.body || '',
      fields:        built.fields || [],
      companyName:   from.fromName,
      companyDomain: from.fromEmail?.split('@')[1]
    });

    await transporter.sendMail({
      from: `"${from.fromName}" <${from.fromEmail}>`,
      to,
      subject,
      text: built.body || '',
      html
    });
  }

  // Direct send used by the Notification Center campaign runner — bypasses
  // the internal template registry. Caller supplies the already-rendered
  // subject and body. `body` is treated as plain text; we also create a
  // minimal HTML wrapper so corporate mail clients render nicely.
  /**
   * Send a fully-styled HTML email using our shared brand template.
   * Used by the Notification Center campaign runner.
   *
   * @param {object}   opts
   * @param {string}   opts.to
   * @param {string}   [opts.subject]
   * @param {string}   opts.body            Plain-text body (paragraphs split on blank lines).
   * @param {string}   [opts.icon]          Header emoji — defaults to 📣 (general announcement).
   * @param {string}   [opts.title]         Header title — defaults to the subject, or "Aviso".
   * @param {Array}    [opts.fields]        Optional list of {label, value} bullets after the body.
   * @param {object}   [opts.cta]           Optional call-to-action button { text, url }.
   * @param {string}   [opts.preset]        Pull icon+title from EMAIL_PRESETS by name.
   */
  async sendEmailRaw({ to, subject, body, icon, title, fields, cta, preset }) {
    if (!to) throw new Error('sendEmailRaw: to requerido');
    const { transporter, from } = await this.getTransporter();

    // Resolve icon + title:
    //   1. explicit `preset` (e.g. 'invoice') — uses EMAIL_PRESETS table
    //   2. explicit `icon`/`title`
    //   3. fallback to general_announcement icon + subject as title
    const p = preset && EMAIL_PRESETS[preset] ? EMAIL_PRESETS[preset] : null;
    const resolvedIcon  = icon  || p?.icon  || EMAIL_PRESETS.general_announcement.icon;
    const resolvedTitle = title || p?.title || subject || EMAIL_PRESETS.general_announcement.title;

    const html = renderEmailTemplate({
      icon:          resolvedIcon,
      title:         resolvedTitle,
      body:          body || '',
      fields:        fields || [],
      cta:           cta || undefined,
      companyName:   from.fromName,
      companyDomain: from.fromEmail?.split('@')[1]
    });

    await transporter.sendMail({
      from: `"${from.fromName}" <${from.fromEmail}>`,
      to,
      subject: subject || resolvedTitle,
      text: body || '',
      html
    });
  }

  async sendSMS(options) {
    const { to, message } = options;

    // This would integrate with Twilio or similar SMS service
    console.log(`SMS to ${to}: ${message}`);
    
    // For now, just log the SMS
    // In production, you would use Twilio:
    // await this.twilioClient.messages.create({
    //   body: message,
    //   from: env.TWILIO_PHONE,
    //   to: `+57${to.replace(/\D/g, '')}`
    // });
  }

  async sendWhatsApp(options) {
    const { to, message, event, buildParams, language } = options;

    // Lazy-import to avoid a circular dependency with prisma at module load.
    const wa = await import('./whatsapp.service.js');

    // Resolve the Meta template mapped to this event in the WhatsApp config
    // (Notificaciones → WhatsApp → templateMap). A template is the ONLY thing
    // Meta delivers outside the 24h customer-service window (free text is
    // rejected there with 131047). When a template is mapped AND every
    // positional parameter resolves, send it; otherwise fall back to free
    // text — which only reaches clients inside the window, but never crashes.
    let templateName = null;
    let lang = language;
    if (event) {
      const cfg = await prisma.whatsAppConfig.findFirst({
        where: { isActive: true },
        select: { templateMap: true, defaultLanguage: true }
      });
      templateName = cfg?.templateMap?.[event] || null;
      lang = lang || cfg?.defaultLanguage || undefined;
    }

    let result;
    if (templateName) {
      // Build params lazily — only when a template is actually mapped — so the
      // free-text path stays side-effect free (no Wompi pay-link calls etc.).
      const params = buildParams ? await buildParams() : [];
      const allPresent = params.length > 0 &&
        params.every(p => p != null && String(p).trim().length > 0);
      result = allPresent
        ? await wa.sendTemplate(to, templateName, params, { language: lang })
        : await wa.sendText(to, message);
    } else {
      result = await wa.sendText(to, message);
    }

    if (!result.ok) {
      console.warn(`[whatsapp] ${to} failed: ${result.error}`);
    }
    return result;
  }

  // Each builder returns a structured payload:
  //   { preset, title, body, fields[] }
  // that the shared renderEmailTemplate() turns into the branded HTML email.
  // Adding a new transactional template = adding one method + one map entry.
  buildEmailTemplate(template, data) {
    const builders = {
      invoice:                this.buildInvoiceTemplate,
      payment_reminder:       this.buildPaymentReminderTemplate,
      payment_confirmation:   this.buildPaymentConfirmationTemplate,
      service_suspension:     this.buildServiceSuspensionTemplate,
      service_activation:     this.buildServiceActivationTemplate,
      installation_scheduled: this.buildInstallationScheduledTemplate,
      general_announcement:   this.buildGeneralAnnouncementTemplate
    };
    const fn = builders[template];
    if (!fn) return { preset: 'general_announcement', title: 'Aviso', body: '', fields: [] };
    return fn.call(this, data || {});
  }

  // ── Transactional template builders ─────────────────────────────
  // Each returns { preset, title, body, fields } — the shared base template
  // takes over from there to produce a consistent branded HTML email.

  buildInvoiceTemplate({ invoice = {}, client = {}, company = {} }) {
    const dueDate    = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('es-CO') : '—';
    const emitted    = invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString('es-CO') : '—';
    const amountCop  = `$${((invoice.amount || invoice.total || 0) / 100).toLocaleString('es-CO')} COP`;
    return {
      preset: 'invoice',
      title:  `Tu factura ${invoice.invoiceNumber || invoice.number || ''} está lista`.trim(),
      body:   `Estimado(a) ${client.name || ''},\n\nHemos generado una nueva factura para tu servicio. Encuentra los detalles abajo y realiza tu pago antes de la fecha de vencimiento para evitar interrupciones.`,
      fields: [
        { label: 'Número de factura', value: invoice.invoiceNumber || invoice.number || '—' },
        { label: 'Fecha de emisión',  value: emitted },
        { label: 'Fecha de vencimiento', value: dueDate },
        invoice.plan?.name && { label: 'Plan', value: invoice.plan.name },
        { label: 'Monto a pagar',     value: amountCop },
        company.phone && { label: 'Contacto', value: company.phone }
      ].filter(Boolean)
    };
  }

  buildPaymentReminderTemplate({ invoice = {}, client = {}, daysOverdue = 0, company = {} }) {
    const isOverdue = daysOverdue > 0;
    const dueDate   = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('es-CO') : '—';
    const amountCop = `$${((invoice.amount || invoice.total || 0) / 100).toLocaleString('es-CO')} COP`;
    return {
      preset: 'reminder',
      title:  isOverdue ? 'Tu pago está vencido' : 'Recuerda pagar antes de vencer',
      body:   `Estimado(a) ${client.name || ''},\n\n${
        isOverdue
          ? `Tu factura #${invoice.invoiceNumber || invoice.number || ''} está vencida hace ${daysOverdue} día${daysOverdue === 1 ? '' : 's'}. Regulariza tu pago lo antes posible para evitar la suspensión del servicio.`
          : `Tu factura #${invoice.invoiceNumber || invoice.number || ''} vence el ${dueDate}. Realiza tu pago a tiempo para mantener tu servicio activo.`
      }`,
      fields: [
        { label: 'Factura',     value: invoice.invoiceNumber || invoice.number || '—' },
        { label: 'Monto',       value: amountCop },
        invoice.plan?.name && { label: 'Plan', value: invoice.plan.name },
        { label: 'Vence',       value: dueDate },
        isOverdue && { label: 'Días de mora', value: String(daysOverdue) },
        company.phone && { label: 'Contacto', value: company.phone }
      ].filter(Boolean)
    };
  }

  buildPaymentConfirmationTemplate({ invoice = {}, payment = {}, client = {}, company = {} }) {
    const amountCop = `$${((payment.amount || 0) / 100).toLocaleString('es-CO')} COP`;
    const paidAt    = payment.paidAt ? new Date(payment.paidAt).toLocaleDateString('es-CO') : '—';
    return {
      preset: 'payment_received',
      title:  'Pago registrado correctamente',
      body:   `Estimado(a) ${client.name || ''},\n\nConfirmamos la recepción de tu pago. ¡Gracias! Tu servicio continúa activo sin interrupciones.`,
      fields: [
        { label: 'Factura',        value: invoice.invoiceNumber || invoice.number || '—' },
        { label: 'Monto pagado',   value: amountCop },
        payment.paymentMethod && { label: 'Método', value: payment.paymentMethod },
        { label: 'Fecha de pago',  value: paidAt },
        payment.transactionId && { label: 'Referencia', value: payment.transactionId },
        company.phone && { label: 'Contacto', value: company.phone }
      ].filter(Boolean)
  // ── WhatsApp template helpers ───────────────────────────────────
  // Plain "55.000" (no symbol) — the template body carries the "$" literal.
  _waMoney(cents) { return Math.round((cents || 0) / 100).toLocaleString('es-CO'); }
  _waDate(d) { return d ? new Date(d).toLocaleDateString('es-CO') : ''; }

  // Pay link for a template parameter: reuse a valid pending link for the
  // invoice, else create one (best-effort, via Wompi). Returns the checkout
  // URL or null. Only invoked from the template path (buildParams), so the
  // free-text flow never touches Wompi. Any failure → null → caller falls
  // back to free text instead of sending a template with a missing variable.
  async _waPayLink(invoiceId) {
    try {
      const existing = await prisma.paymentLink.findFirst({
        where: { invoiceId, status: 'pending', expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: { checkoutUrl: true }
      });
      if (existing?.checkoutUrl) return existing.checkoutUrl;
      const { paymentLinkService } = await import('./payment-link.service.js');
      const link = await paymentLinkService.createForInvoice(invoiceId);
      return link?.checkoutUrl || null;
    } catch (e) {
      console.warn(`[whatsapp] pay link failed for invoice ${invoiceId}: ${e.message}`);
      return null;
    }
  }

  // Pay link for a client when there's no single invoice in hand (suspension):
  // pick the oldest open invoice and resolve its link.
  async _waPayLinkForClient(clientId) {
    const inv = await prisma.invoice.findFirst({
      where: { clientId, status: { in: ['PENDING', 'OVERDUE', 'PARTIAL'] } },
      orderBy: { dueDate: 'asc' },
      select: { id: true }
    });
    return inv ? this._waPayLink(inv.id) : null;
  }

    };
  }

  buildServiceSuspensionTemplate({ client = {}, company = {} }) {
    return {
      preset: 'service_suspended',
      title:  'Tu servicio ha sido suspendido',
      body:   `Estimado(a) ${client.name || ''},\n\nTu servicio de internet fue suspendido temporalmente por falta de pago.\n\nPara reactivarlo:\n1. Realiza el pago de las facturas pendientes.\n2. Avísanos para confirmar tu pago.\n3. Reactivaremos tu servicio en máximo 24 horas.`,
      fields: [
        company.phone && { label: 'Teléfono', value: company.phone },
        company.email && { label: 'Email',    value: company.email }
      ].filter(Boolean)
    };
  }

  buildServiceActivationTemplate({ client = {}, company = {} }) {
    return {
      preset: 'service_activated',
      title:  'Tu servicio está activo',
      body:   `Estimado(a) ${client.name || ''},\n\n¡Bienvenido de vuelta! Tu servicio de internet fue reactivado exitosamente y ya puedes navegar normalmente.\n\nSi notas algún problema técnico, contáctanos de inmediato.`,
      fields: [
        company.phone && { label: 'Teléfono', value: company.phone },
        company.email && { label: 'Email',    value: company.email }
      ].filter(Boolean)
    };
  }

  buildInstallationScheduledTemplate({ client = {}, installationDate, company = {} }) {
    const date = installationDate ? new Date(installationDate).toLocaleDateString('es-CO') : '—';
    return {
      preset: 'general_announcement',
      title:  'Instalación programada',
      body:   `Estimado(a) ${client.name || ''},\n\nProgramamos la instalación de tu servicio de internet.\n\nImportante:\n• Alguien mayor de 18 años debe estar presente.\n• Ten disponible el espacio donde se instalará el equipo.\n• Nuestro técnico se comunicará contigo antes de llegar.`,
      fields: [
        { label: 'Fecha',     value: date },
        { label: 'Hora',      value: 'Por confirmar' },
        client.address && { label: 'Dirección', value: client.address },
        client.city && { label: 'Ciudad',     value: client.city },
        company.phone && { label: 'Contacto', value: company.phone }
      ].filter(Boolean)
    };
  }

  buildGeneralAnnouncementTemplate({ client = {}, subject = '', message = '', company = {} }) {
    return {
      preset: 'general_announcement',
      title:  subject || 'Aviso importante',
      body:   `${client.name ? `Estimado(a) ${client.name},\n\n` : ''}${message || ''}`,
      fields: [
        company.phone && { label: 'Teléfono', value: company.phone },
        company.email && { label: 'Email',    value: company.email }
      ].filter(Boolean)
    };
  }


  buildWhatsAppPaymentReminder(invoice, daysOverdue) {
    const isOverdue = daysOverdue > 0;
    
    if (isOverdue) {
      return `📢 *${env.COMPANY_NAME}* - Recordatorio de Pago Vencido

Estimado/a ${invoice.client.name},

Su factura #${invoice.invoiceNumber} está vencida hace ${daysOverdue} días.

📄 Detalles:
• Factura: ${invoice.invoiceNumber}
• Monto: $${(invoice.amount / 100).toLocaleString('es-CO')} COP
• Plan: ${invoice.plan.name}

⚠️ Para evitar la suspensión del servicio, por favor regularice su pago.

💳 Canales de pago:
• Transferencia bancaria
• Pago en línea (Wompi)
• Pago presencial

Si ya realizó el pago, ignore este mensaje.

📞 Contáctenos: ${env.COMPANY_PHONE}`;
    } else {
      return `📢 *${env.COMPANY_NAME}* - Recordatorio de Pago

Estimado/a ${invoice.client.name},

Le recordamos que su factura #${invoice.invoiceNumber} vence el ${invoice.dueDate.toLocaleDateString()}.

📄 Detalles:
• Factura: ${invoice.invoiceNumber}
• Monto: $${(invoice.amount / 100).toLocaleString('es-CO')} COP
• Plan: ${invoice.plan.name}
• Vencimiento: ${invoice.dueDate.toLocaleDateString()}

💳 Canales de pago disponibles.

📞 Contáctenos: ${env.COMPANY_PHONE}`;
    }
  }

  buildWhatsAppPaymentConfirmation(invoice, payment) {
    return `✅ *${env.COMPANY_NAME}* - Confirmación de Pago

Estimado/a ${invoice.client.name},

Hemos recibido su pago exitosamente:

📄 Detalles:
• Factura: ${invoice.invoiceNumber}
• Monto pagado: $${(payment.amount / 100).toLocaleString('es-CO')} COP
• Método: ${payment.paymentMethod}
• Fecha: ${payment.paidAt.toLocaleDateString()}
${payment.transactionId ? `• Referencia: ${payment.transactionId}` : ''}

🎉 ¡Gracias por su pago! Su servicio continua activo.

📞 Contáctenos: ${env.COMPANY_PHONE}`;
  }

  buildWhatsAppServiceSuspension(client) {
    return `⚠️ *${env.COMPANY_NAME}* - Servicio Suspendido

Estimado/a ${client.name},

Le informamos que su servicio de internet ha sido suspendido temporalmente.

🔄 Para reactivar su servicio:
1️⃣ Realice el pago de las facturas pendientes
2️⃣ Contáctenos para confirmar el pago
3️⃣ Su servicio será reactivado en 24 horas

📞 Contáctenos: ${env.COMPANY_PHONE}`;
  }

  buildWhatsAppServiceActivation(client) {
    return `✅ *${env.COMPANY_NAME}* - Servicio Reactivado

Estimado/a ${client.name},

Le informamos que su servicio de internet ha sido reactivado exitosamente.

🌐 Ya puede disfrutar de su conexión a internet normalmente.

Si experimenta algún problema técnico, contáctenos de inmediato.

📞 Contáctenos: ${env.COMPANY_PHONE}`;
  }

  async logNotification(clientId, type, channel, content, status = 'SENT', error = null, recipient = null) {
    try {
      await prisma.notificationLog.create({
        data: {
          clientId,
          type,
          channel,
          content,
          status,
          sentAt: status === 'SENT' ? new Date() : null,
          error
        }
      });
    } catch (logError) {
      console.error('Error logging notification:', logError);
    }
  }

  async getNotificationHistory(clientId, filters = {}) {
    try {
      const where = {
        clientId,
        ...(filters.type && { type: filters.type }),
        ...(filters.channel && { channel: filters.channel }),
        ...(filters.status && { status: filters.status }),
        ...(filters.dateFrom && filters.dateTo && {
          createdAt: {
            gte: new Date(filters.dateFrom),
            lte: new Date(filters.dateTo)
          }
        })
      };

      const notifications = await prisma.notificationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filters.limit || 50
      });

      return notifications;
    } catch (error) {
      console.error('Error getting notification history:', error);
      throw new AppError('Error al obtener historial de notificaciones', 500, 'NOTIFICATION_HISTORY_ERROR');
    }
  }

  async getNotificationStats(filters = {}) {
    try {
      const where = {
        ...(filters.dateFrom && filters.dateTo && {
          createdAt: {
            gte: new Date(filters.dateFrom),
            lte: new Date(filters.dateTo)
          }
        })
      };

      const [total, byType, byChannel, byStatus] = await Promise.all([
        prisma.notificationLog.count({ where }),
        prisma.notificationLog.groupBy({
          by: ['type'],
          where,
          _count: true
        }),
        prisma.notificationLog.groupBy({
          by: ['channel'],
          where,
          _count: true
        }),
        prisma.notificationLog.groupBy({
          by: ['status'],
          where,
          _count: true
        })
      ]);

      return {
        total,
        byType,
        byChannel,
        byStatus
      };
    } catch (error) {
      console.error('Error getting notification stats:', error);
      throw new AppError('Error al obtener estadísticas de notificaciones', 500, 'NOTIFICATION_STATS_ERROR');
    }
  }
}

export const notificationService = new NotificationService();
      // `recipient` is required by the schema, but callers rarely have it
      // handy. Derive it from the client's contact for the channel when not
      // passed explicitly (EMAIL → email, otherwise phone). Falls back to "—"
      // so a missing contact never crashes the logging (which would otherwise
      // throw "Argument `recipient` is missing" and abort the send).
      let to = recipient;
      if (!to && clientId) {
        const client = await prisma.client.findUnique({
          where: { id: clientId },
          select: { email: true, phone: true }
        });
        to = channel === 'EMAIL' ? client?.email : client?.phone;
      }
          recipient: to || '—',
