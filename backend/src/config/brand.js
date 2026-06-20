/**
 * Internet Online — brand single-source-of-truth.
 *
 * Every transactional document (emails + invoice PDF) imports from here so the
 * whole system reads as ONE brand. Values were lifted verbatim from the live
 * site https://internetonline.co (logo SVG + css/style.css design tokens) so
 * the colors, wordmark and copy match the marketing material exactly.
 *
 * Legal/fiscal fields that do NOT live on the public site (NIT, address) fall
 * back to the COMPANY_* env vars so the invoice stays a valid fiscal document.
 */

import { env } from './env.js';

export const BRAND = {
  // ── Identity ────────────────────────────────────────────────────
  name:    'Internet Online',
  legalName: env.COMPANY_NAME && env.COMPANY_NAME !== 'Mi ISP SAS'
    ? env.COMPANY_NAME
    : 'Internet Online',
  tagline: 'El internet de nuestra gente',          // primary brand line
  slogan:  '¡Conéctate de verdad!',                 // commercial CTA line
  promise: 'Fibra óptica real, rápida y sin interrupciones',
  areas:   'San Vicente y La Estrella',

  // ── Contact (verbatim from internetonline.co) ───────────────────
  email:    'contacto@internetonline.co',
  phone:    '+57 323 632 9425',
  phoneRaw: '573236329425',          // for tel:/wa.me links
  web:      'www.internetonline.co',
  webUrl:   'https://internetonline.co',

  // ── Fiscal (env-backed; not on public site) ─────────────────────
  nit:     env.COMPANY_NIT     || '',
  address: env.COMPANY_ADDRESS || '',
  city:    env.COMPANY_CITY    || 'San Vicente y La Estrella, Antioquia',

  // ── Color tokens (from css/style.css :root) ─────────────────────
  colors: {
    navy:       '#16357E',   // --color-primary
    navyHover:  '#1E469B',   // --color-primary-hover
    navyDeep:   '#0E255C',   // --color-primary-deep
    navyLight:  '#E9EFFA',   // --color-primary-light
    gold:       '#FDB913',   // --color-accent
    goldHover:  '#ECA600',   // --color-accent-hover
    goldLight:  '#FFF2CE',   // --color-accent-light
    text:       '#111111',   // --color-text
    textMuted:  '#6B7280',   // --color-text-muted
    textFaint:  '#9CA3AF',   // --color-text-faint
    border:     '#E2E8F2',   // --color-border
    divider:    '#EAEFF7',   // --color-divider
    bg:         '#F5F7FA',   // page background
    surface:    '#FFFFFF',
    white:      '#FFFFFF',
    success:    '#15803D',
    danger:     '#DC2626',
  },

  // ── Typography (Inter with safe web/email fallbacks) ────────────
  fontStack: "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
};

export default BRAND;
