import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error.middleware.js';
import { prisma } from '../config/database.js';
import { renderEmailTemplate, EMAIL_PRESETS } from './email-base.template.js';
import { BRAND } from '../config/brand.js';
import { notificationSettings } from './notification-settings.service.js';

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

    // SMTP es OFICIAL y GLOBAL: la única fuente de verdad es la fila activa de
    // SmtpConfig (gestionada desde Centro de Notificaciones → Correo SMTP).
    // NO se cae al .env: hacerlo enviaba con credenciales viejas/rotas de forma
    // silenciosa. Si no hay configuración activa, fallamos con un error claro.
    let cfg = null;
    try {
      cfg = await prisma.smtpConfig.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' }
      });
    } catch (e) {
      throw new Error(`No se pudo leer la configuración SMTP de la base de datos: ${e.message}`);
    }

    if (!cfg) {
      console.error('[notification.smtp] No hay SmtpConfig activa — envío de correo deshabilitado hasta configurarla en Centro de Notificaciones → Correo SMTP.');
      throw new Error('No hay configuración SMTP activa. Configúrala en Centro de Notificaciones → Correo SMTP antes de enviar correos.');
    }

    console.log(`[notification.smtp] source=DB host=${cfg.host}:${cfg.port} secure=${cfg.secure} user=${cfg.username} from="${cfg.fromName} <${cfg.fromEmail}>"`);

    const transporter = nodemailer.createTransport({
      host:   cfg.host,
      port:   cfg.port,
      secure: cfg.secure,
      auth:   { user: cfg.username, pass: cfg.password },
      tls:    { rejectUnauthorized: false }
    });

    const from = { fromEmail: cfg.fromEmail, fromName: cfg.fromName || env.COMPANY_NAME };

    this._cachedTransporter = transporter;
    this._cachedFrom = from;
    this._cachedAt = Date.now();
    return { transporter, from };
  }

  // Welcome email — fired (best-effort) when a new client is created with an
  // email. Honors an operator-authored 'welcome' template via sendEmail.
  async sendWelcome(client) {
    if (!client?.email) return false;
    try {
      await this.sendEmail({
        to: client.email,
        subject: '¡Bienvenido a Internet Online!',
        template: 'welcome',
        notifyType: 'WELCOME',
        data: { client, company: this._companyInfo() }
      });
      await this.logNotification(client.id, 'GENERAL_ANNOUNCEMENT', 'EMAIL', 'Correo de bienvenida');
      return true;
    } catch (error) {
      console.error('Error sending welcome notification:', error);
      await this.logNotification(client.id, 'GENERAL_ANNOUNCEMENT', 'EMAIL', 'Correo de bienvenida', 'FAILED', error.message);
      return false;
    }
  }

  async sendInvoiceNotification(invoice) {
    try {
      // Send email
      await this.sendEmail({
        to: invoice.client.email,
        subject: `Nueva Factura - ${invoice.invoiceNumber}`,
        template: 'invoice',
        notifyType: 'INVOICE_GENERATED',
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

  async sendPaymentReminder(invoice, notifyType = 'PAYMENT_REMINDER') {
    try {
      const daysOverdue = Math.floor((new Date() - invoice.dueDate) / (1000 * 60 * 60 * 24));
      const reminderType = daysOverdue > 0 ? 'PAYMENT_OVERDUE' : 'PAYMENT_DUE';

      // Send email
      await this.sendEmail({
        to: invoice.client.email,
        notifyType,
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
        notifyType: 'PAYMENT_CONFIRMATION',
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
        notifyType: 'SERVICE_SUSPENSION',
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
        notifyType: 'SERVICE_ACTIVATION',
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

  // ── Editable-template integration (Centro de Notificaciones → Plantillas) ──
  // Variable substitution for operator-authored templates. Same {{var}} syntax
  // and (mostly) the same variable names the campaign runner exposes, so a
  // template works identically whether fired transactionally or in a campaign.
  _renderVars(str, vars) {
    return String(str || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
      const v = vars[k];
      return v === undefined || v === null ? '' : String(v);
    });
  }

  _txVars({ client = {}, invoice = {}, payment = {}, daysOverdue = null, company = {} } = {}) {
    const money = (c) => `$${Math.round((c || 0) / 100).toLocaleString('es-CO')}`;
    const date  = (d) => d ? new Date(d).toLocaleDateString('es-CO') : '';
    return {
      name:          client.name || '',
      email:         client.email || '',
      phone:         client.phone || '',
      plan:          client.plan?.name || invoice.plan?.name || '',
      zone:          client.zone?.name || '',
      balance:       money(invoice.balanceDue ?? invoice.total ?? invoice.amount),
      invoiceNumber: invoice.invoiceNumber || invoice.number || '',
      amount:        money(invoice.total ?? invoice.amount),
      dueDate:       date(invoice.dueDate),
      daysOverdue:   daysOverdue != null ? String(daysOverdue) : '',
      paymentAmount: money(payment.amount),
      paymentMethod: payment.paymentMethod || '',
      transactionId: payment.transactionId || '',
      company:       company.name  || BRAND.name,
      companyPhone:  company.phone || BRAND.phone,
      companyEmail:  company.email || BRAND.email
    };
  }

  // Active operator-authored EMAIL template for this preset, or null.
  async _findTemplateByPreset(preset) {
    if (!preset) return null;
    try {
      return await prisma.notificationTemplate.findFirst({
        where: { preset, channel: 'EMAIL', isActive: true },
        orderBy: { updatedAt: 'desc' }
      });
    } catch { return null; }
  }

  async sendEmail(options) {
    const { to, subject, template, data, notifyType } = options;

    // Gate central de notificaciones a clientes: si el tipo está deshabilitado
    // (o su canal email apagado) en los ajustes, NO se envía.
    if (notifyType && !(await notificationSettings.isEnabled(notifyType, 'EMAIL'))) {
      console.log(`[notif-gate] EMAIL ${notifyType} → ${to} omitido (deshabilitado en ajustes de notificaciones)`);
      return { skipped: true };
    }

    // Resolve the built-in branded shape ({ preset, title, body, fields }).
    const built = this.buildEmailTemplate(template, data);
    const { transporter, from } = await this.getTransporter();

    // INTEGRATION: if the operator authored an active template for this preset
    // in the Notification Center, it wins (subject + body rendered with vars).
    // Otherwise we fall back to the built-in branded copy. This makes the
    // "Plantillas" tab actually govern the system's transactional emails.
    let finalSubject = subject;
    let finalBody    = built.body || '';
    let finalFields  = built.fields || [];
    const dbTpl = await this._findTemplateByPreset(built.preset);
    if (dbTpl) {
      const vars = this._txVars(data || {});
      finalBody = this._renderVars(dbTpl.body, vars);
      if (dbTpl.subject) finalSubject = this._renderVars(dbTpl.subject, vars);
      finalFields = []; // operator body is authoritative — avoid duplicate rows
    }

    const html = renderEmailTemplate({
      icon:          EMAIL_PRESETS[built.preset]?.icon  || EMAIL_PRESETS.general_announcement.icon,
      title:         built.title || finalSubject || EMAIL_PRESETS[built.preset]?.title || 'Aviso',
      body:          finalBody,
      fields:        finalFields,
      companyName:   from.fromName,
      companyDomain: from.fromEmail?.split('@')[1]
    });

    await transporter.sendMail({
      from: `"${from.fromName}" <${from.fromEmail}>`,
      to,
      subject: finalSubject,
      text: finalBody,
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
  async sendEmailRaw({ to, subject, body, icon, title, fields, cta, preset, notifyType }) {
    if (!to) throw new Error('sendEmailRaw: to requerido');
    // Gate central — ver sendEmail. notifyType es opcional: los envíos de
    // campañas/operador no lo pasan y por tanto no se filtran aquí.
    if (notifyType && !(await notificationSettings.isEnabled(notifyType, 'EMAIL'))) {
      console.log(`[notif-gate] EMAIL ${notifyType} → ${to} omitido (deshabilitado en ajustes de notificaciones)`);
      return { skipped: true };
    }
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
    const { to, message, event, buildParams, language, notifyType } = options;

    // Gate central — canal WHATSAPP. Los envíos de campañas/operador no pasan
    // notifyType y por tanto no se filtran aquí.
    if (notifyType && !(await notificationSettings.isEnabled(notifyType, 'WHATSAPP'))) {
      console.log(`[notif-gate] WHATSAPP ${notifyType} → ${to} omitido (deshabilitado en ajustes de notificaciones)`);
      return { skipped: true, success: false };
    }

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

  // Each builder returns a structured payload:
  //   { preset, title, body, fields[] }
  // that the shared renderEmailTemplate() turns into the branded HTML email.
  // Adding a new transactional template = adding one method + one map entry.
  // Company block reused by every transactional send (env-backed, brand-safe).
  _companyInfo() {
    return {
      name:    env.COMPANY_NAME,
      nit:     env.COMPANY_NIT,
      city:    env.COMPANY_CITY,
      address: env.COMPANY_ADDRESS,
      phone:   env.COMPANY_PHONE,
      email:   env.COMPANY_EMAIL
    };
  }

  buildEmailTemplate(template, data) {
    const builders = {
      welcome:                this.buildWelcomeTemplate,
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

  buildWelcomeTemplate({ client = {}, company = {} }) {
    const firstName = (client.name || '').split(' ')[0];
    return {
      preset: 'welcome',
      title:  '¡Bienvenido a Internet Online!',
      body:   `Hola ${firstName || 'vecino(a)'},\n\n¡Bienvenido a la familia Internet Online! Ya eres parte de "el internet de nuestra gente". Muy pronto disfrutarás de fibra óptica real, rápida y sin interrupciones, con la conexión estable 24/7 que tu hogar merece.\n\nCualquier cosa que necesites, escríbenos. ¡Conéctate de verdad! 💙`,
      fields: [
        client.plan?.name && { label: 'Tu plan', value: client.plan.name },
        { label: 'WhatsApp', value: company.phone || BRAND.phone },
        { label: 'Email',    value: company.email || BRAND.email }
      ].filter(Boolean)
    };
  }

  buildInvoiceTemplate({ invoice = {}, client = {}, company = {} }) {
    const dueDate    = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('es-CO') : '—';
    const emitted    = invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString('es-CO') : '—';
    const amountCop  = `$${((invoice.amount || invoice.total || 0) / 100).toLocaleString('es-CO')} COP`;
    const firstName = (client.name || '').split(' ')[0];
    return {
      preset: 'invoice',
      title:  'Tu factura ya está lista',
      body:   `Hola ${firstName || 'vecino(a)'},\n\nYa está lista tu factura de Internet Online del mes. Para que tu hogar siempre esté conectado, realiza tu pago antes de la fecha de vencimiento. Es muy fácil: usa el botón de pago seguro o cualquiera de nuestros canales.`,
      fields: [
        { label: 'Número de factura', value: invoice.invoiceNumber || invoice.number || '—' },
        { label: 'Fecha de emisión',  value: emitted },
        { label: 'Fecha de vencimiento', value: dueDate },
        invoice.plan?.name && { label: 'Plan', value: invoice.plan.name },
        { label: 'Total a pagar',     value: amountCop },
        { label: 'Contacto', value: company.phone || BRAND.phone }
      ].filter(Boolean)
    };
  }

  buildPaymentReminderTemplate({ invoice = {}, client = {}, daysOverdue = 0, company = {} }) {
    const isOverdue = daysOverdue > 0;
    const dueDate   = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('es-CO') : '—';
    const amountCop = `$${((invoice.amount || invoice.total || 0) / 100).toLocaleString('es-CO')} COP`;
    const firstName = (client.name || '').split(' ')[0];
    return {
      preset: 'reminder',
      title:  isOverdue ? 'Tu pago está pendiente' : 'Recuerda pagar tu internet',
      body:   `Hola ${firstName || 'vecino(a)'},\n\n${
        isOverdue
          ? `Notamos que tu factura ${invoice.invoiceNumber || invoice.number || ''} lleva ${daysOverdue} día${daysOverdue === 1 ? '' : 's'} pendiente. Ponte al día para seguir disfrutando de tu internet de fibra óptica sin interrupciones. Si ya pagaste, ¡gracias! Puedes ignorar este mensaje.`
          : `Tu factura ${invoice.invoiceNumber || invoice.number || ''} vence el ${dueDate}. Paga a tiempo y mantén tu hogar siempre conectado, con la conexión estable que ya conoces.`
      }`,
      fields: [
        { label: 'Factura',     value: invoice.invoiceNumber || invoice.number || '—' },
        { label: 'Monto',       value: amountCop },
        invoice.plan?.name && { label: 'Plan', value: invoice.plan.name },
        { label: 'Vence',       value: dueDate },
        isOverdue && { label: 'Días pendiente', value: String(daysOverdue) },
        { label: 'Contacto', value: company.phone || BRAND.phone }
      ].filter(Boolean)
    };
  }

  buildPaymentConfirmationTemplate({ invoice = {}, payment = {}, client = {}, company = {} }) {
    const amountCop = `$${((payment.amount || 0) / 100).toLocaleString('es-CO')} COP`;
    const paidAt    = payment.paidAt ? new Date(payment.paidAt).toLocaleDateString('es-CO') : '—';
    const firstName = (client.name || '').split(' ')[0];
    return {
      preset: 'payment_received',
      title:  '¡Recibimos tu pago!',
      body:   `Hola ${firstName || 'vecino(a)'},\n\n¡Gracias por tu pago! Ya quedó registrado y tu servicio de fibra óptica sigue activo, con la conexión estable 24/7 de siempre. Para que tu hogar nunca se quede sin internet. 💙`,
      fields: [
        { label: 'Factura',        value: invoice.invoiceNumber || invoice.number || '—' },
        { label: 'Monto pagado',   value: amountCop },
        payment.paymentMethod && { label: 'Método', value: payment.paymentMethod },
        { label: 'Fecha de pago',  value: paidAt },
        payment.transactionId && { label: 'Referencia', value: payment.transactionId },
        { label: 'Contacto', value: company.phone || BRAND.phone }
      ].filter(Boolean)
    };
  }

  buildServiceSuspensionTemplate({ client = {}, company = {} }) {
    return {
      preset: 'service_suspended',
      title:  'Tu servicio está suspendido',
      body:   `Hola ${(client.name || '').split(' ')[0] || 'vecino(a)'},\n\nTu internet quedó suspendido temporalmente porque tienes facturas pendientes. ¡Pero reconectarte es muy fácil!\n\n1. Realiza el pago de tus facturas pendientes.\n2. Avísanos por WhatsApp para confirmarlo.\n3. Reactivamos tu servicio en máximo 24 horas.\n\nEstamos aquí para ayudarte a volver a conectarte de verdad.`,
      fields: [
        { label: 'WhatsApp', value: company.phone || BRAND.phone },
        { label: 'Email',    value: company.email || BRAND.email }
      ].filter(Boolean)
    };
  }

  buildServiceActivationTemplate({ client = {}, company = {} }) {
    return {
      preset: 'service_activated',
      title:  '¡Tu internet está activo!',
      body:   `Hola ${(client.name || '').split(' ')[0] || 'vecino(a)'},\n\n¡Bienvenido de vuelta! Tu servicio de fibra óptica ya está activo y listo para que disfrutes velocidades hasta el máximo contratado y una conexión estable 24/7.\n\n¡Conéctate de verdad! Si notas algún detalle, escríbenos y te ayudamos enseguida.`,
      fields: [
        { label: 'WhatsApp', value: company.phone || BRAND.phone },
        { label: 'Email',    value: company.email || BRAND.email }
      ].filter(Boolean)
    };
  }

  buildInstallationScheduledTemplate({ client = {}, installationDate, company = {} }) {
    const date = installationDate ? new Date(installationDate).toLocaleDateString('es-CO') : '—';
    return {
      preset: 'general_announcement',
      title:  '¡Pronto tendrás tu internet!',
      body:   `Hola ${(client.name || '').split(' ')[0] || 'vecino(a)'},\n\n¡Buenas noticias! Ya programamos la instalación de tu fibra óptica. Estás a un paso de conectarte de verdad.\n\nPara que todo salga perfecto:\n• Alguien mayor de 18 años debe estar presente.\n• Ten libre el espacio donde irá el equipo.\n• Nuestro técnico de la zona te llamará antes de llegar.`,
      fields: [
        { label: 'Fecha',     value: date },
        { label: 'Hora',      value: 'Por confirmar' },
        client.address && { label: 'Dirección', value: client.address },
        client.city && { label: 'Ciudad',     value: client.city },
        { label: 'Contacto', value: company.phone || BRAND.phone }
      ].filter(Boolean)
    };
  }

  buildGeneralAnnouncementTemplate({ client = {}, subject = '', message = '', company = {} }) {
    return {
      preset: 'general_announcement',
      title:  subject || 'Tenemos un aviso para ti',
      body:   `${client.name ? `Hola ${(client.name || '').split(' ')[0]},\n\n` : ''}${message || ''}`,
      fields: [
        { label: 'WhatsApp', value: company.phone || BRAND.phone },
        { label: 'Email',    value: company.email || BRAND.email }
      ].filter(Boolean)
    };
  }


  buildWhatsAppPaymentReminder(invoice, daysOverdue) {
    const isOverdue = daysOverdue > 0;
    // Defensive: the plan lives under invoice.client.plan (Invoice has no direct
    // `plan` relation). Client/plan/dueDate may be missing depending on the
    // include — never let an undefined access crash the reminder job.
    const clientName = invoice.client?.name || 'cliente';
    const planName   = invoice.client?.plan?.name || invoice.plan?.name || 'tu plan';
    const amountCop  = `$${((invoice.amount ?? invoice.total ?? 0) / 100).toLocaleString('es-CO')} COP`;
    const dueStr     = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('es-CO') : '—';
    const company    = env.COMPANY_NAME || 'Internet Online';
    const phone      = env.COMPANY_PHONE || '+57 323 632 9425';

    if (isOverdue) {
      return `📢 *${company}* - Recordatorio de Pago Vencido

Estimado/a ${clientName},

Su factura #${invoice.invoiceNumber} está vencida hace ${daysOverdue} días.

📄 Detalles:
• Factura: ${invoice.invoiceNumber}
• Monto: ${amountCop}
• Plan: ${planName}

⚠️ Para evitar la suspensión del servicio, por favor regularice su pago.

💳 Canales de pago:
• Transferencia bancaria
• Pago en línea (Wompi)
• Pago presencial

Si ya realizó el pago, ignore este mensaje.

📞 Contáctenos: ${phone}`;
    } else {
      return `📢 *${company}* - Recordatorio de Pago

Estimado/a ${clientName},

Le recordamos que su factura #${invoice.invoiceNumber} vence el ${dueStr}.

📄 Detalles:
• Factura: ${invoice.invoiceNumber}
• Monto: ${amountCop}
• Plan: ${planName}
• Vencimiento: ${dueStr}

💳 Canales de pago disponibles.

📞 Contáctenos: ${phone}`;
    }
  }

  buildWhatsAppPaymentConfirmation(invoice, payment) {
    const clientName = invoice.client?.name || 'cliente';
    const amountCop  = `$${((payment.amount ?? 0) / 100).toLocaleString('es-CO')} COP`;
    const paidStr    = payment.paidAt ? new Date(payment.paidAt).toLocaleDateString('es-CO') : new Date().toLocaleDateString('es-CO');
    const company    = env.COMPANY_NAME || 'Internet Online';
    const phone      = env.COMPANY_PHONE || '+57 323 632 9425';
    return `✅ *${company}* - Confirmación de Pago

Estimado/a ${clientName},

Hemos recibido su pago exitosamente:

📄 Detalles:
• Factura: ${invoice.invoiceNumber}
• Monto pagado: ${amountCop}${payment.paymentMethod ? `\n• Método: ${payment.paymentMethod}` : ''}
• Fecha: ${paidStr}
${payment.transactionId ? `• Referencia: ${payment.transactionId}` : ''}

🎉 ¡Gracias por su pago! Su servicio continua activo.

📞 Contáctenos: ${phone}`;
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
      await prisma.notificationLog.create({
        data: {
          clientId,
          type,
          channel,
          recipient: to || '—',
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
