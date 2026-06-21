/**
 * Tipos de dominio compartidos del frontend.
 *
 * Fuente de verdad: backend/prisma/schema.prisma. Se usan vía JSDoc en los
 * .svelte/.js, p.ej.:  `/** @type {import('$lib/types').Client | null} *\/`
 *
 * Convenciones:
 *  - Los montos están en CENTAVOS (Int en el schema).
 *  - Las fechas llegan del API como string ISO (no Date) tras `JSON.parse`.
 *  - Las relaciones son opcionales: solo vienen cuando el endpoint las incluye.
 *  - Estos tipos describen la forma que consume el frontend; al migrar un
 *    archivo se afinan si hace falta (tipado incremental — ver errores.md).
 */

// ── Enums (como uniones de string, que es como llegan por JSON) ──────────
export type UserRole = 'ADMIN' | 'TECHNICIAN' | 'OPERATOR' | 'VIEWER';
export type ClientStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE' | 'PENDING';
export type InvoiceStatus =
  | 'DRAFT' | 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'CANCELLED' | 'REFUNDED';
export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
export type PaymentMethod =
  | 'CASH' | 'BANK_TRANSFER' | 'CREDIT_CARD' | 'WOMPI' | 'NEQUI' | 'BANCOLOMBIA' | 'OTHER';
export type RouterStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN';
export type RouteStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
export type DeviceStatus = 'ONLINE' | 'OFFLINE' | 'UNSTABLE' | 'UNKNOWN';
export type NetworkDeviceType = 'CPE' | 'SWITCH' | 'AP' | 'ROUTER' | 'OTHER';
export type ConnectionType = 'FIBER' | 'WIRELESS';

// ── Núcleo de negocio ───────────────────────────────────────────────────
export interface Plan {
  id: string;
  name: string;
  type?: string | null;
  connectionType?: ConnectionType;
  description?: string | null;
  price: number;
  monthlyPrice: number;
  downloadSpeed: number;
  uploadSpeed: number;
  dataLimit?: number | null;
  mikrotikProfile?: string | null;
  isActive: boolean;
  isFree: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Zone {
  id: number;
  name: string;
  description?: string | null;
  color?: string | null;
  routerId?: number | null;
  router?: Router | null;
  /** Conteos agregados que añade el listado (_count.clients, etc.). */
  _count?: Record<string, number>;
  createdAt?: string;
  updatedAt?: string;
}

export interface MikrotikAccount {
  id: number;
  username: string;
  password: string;
  remoteAddress?: string | null;
  localAddress?: string | null;
  profileName?: string | null;
  coordinates?: string | null;
  status: string;
  routerId: number;
  clientId?: string | null;
  router?: Router | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Device {
  id: string;
  clientId: string;
  mac: string;
  ip?: string | null;
  type: string;
  model?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Client {
  id: string;
  wisphubId?: string | null;
  name: string;
  email?: string | null;
  phone: string;
  address: string;
  neighborhood?: string | null;
  city: string;
  nit?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
  status: ClientStatus;
  planId?: string | null;
  zoneId?: number | null;
  balance: number;
  monthlyFee: number;
  connectionType?: ConnectionType;
  installationDate?: string | null;
  contractDate?: string | null;
  cutoffDate?: string | null;
  coordinates?: string | null;
  vlan?: string | null;
  notes?: string | null;
  mikrotikId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  // Relaciones (incluidas según el endpoint)
  plan?: Plan | null;
  zone?: Zone | null;
  devices?: Device[];
  invoices?: Invoice[];
  payments?: Payment[];
  mikrotikAccount?: MikrotikAccount | null;
  evidencePhotos?: EvidencePhoto[];
  inventoryItems?: InventoryItem[];
  // Campos calculados que añade el listado /clients (clients.controller)
  pendingInvoices?: Invoice[];
  paymentStatus?: 'OK' | 'PENDING' | 'OVERDUE';
  pendingAmount?: number;
  fullName?: string;
}

export interface Invoice {
  id: string;
  wisphubId?: string | null;
  invoiceNumber: string;
  clientId: string;
  amount: number;
  tax: number;
  discount: number;
  total: number;
  status: InvoiceStatus;
  balanceDue: number;
  issueDate?: string;
  dueDate: string;
  paidDate?: string | null;
  pdfUrl?: string | null;
  notes?: string | null;
  periodYear?: number | null;
  periodMonth?: number | null;
  createdAt?: string;
  updatedAt?: string;
  client?: Client | null;
  payments?: Payment[];
  items?: InvoiceItem[];
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  quantity: number;
  description: string;
  price: number;
  total: number;
  /** Alias tolerado en la UI (algunas respuestas usan unitPrice/amount). */
  unitPrice?: number;
  amount?: number;
  createdAt?: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  clientId: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  transactionId?: string | null;
  externalId?: string | null;
  notes?: string | null;
  createdByUserId?: string | null;
  createdByUserName?: string | null;
  createdAt?: string;
  updatedAt?: string;
  invoice?: Invoice | null;
  client?: Client | null;
  createdBy?: User | null;
  evidencePhotos?: EvidencePhoto[];
}

export interface EvidencePhoto {
  id: string;
  clientId: string;
  paymentId?: string | null;
  type: string;
  description?: string | null;
  fileUrl: string;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  createdAt?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// ── Red y MikroTik ──────────────────────────────────────────────────────
export interface RouterRoute {
  id: number;
  routerId: number;
  ip: string;
  priority: number;
  label?: string | null;
  status: RouteStatus;
  latency?: number | null;
  lastPingAt?: string | null;
}

export interface Router {
  id: number;
  name: string;
  description?: string | null;
  apiPort: number;
  username: string;
  isActive: boolean;
  location?: string | null;
  model?: string | null;
  firmware?: string | null;
  lastSyncAt?: string | null;
  status: RouterStatus;
  activeRouteId?: number | null;
  failCount?: number;
  alertSent?: boolean;
  sshPort?: number | null;
  sshUser?: string | null;
  /** IP principal derivada por el API (no es columna del schema). */
  ip?: string | null;
  routes?: RouterRoute[];
  zones?: Zone[];
  createdAt?: string;
  updatedAt?: string;
}

export interface NetworkDevice {
  id: string;
  name: string;
  ip: string;
  type: NetworkDeviceType;
  zoneId?: number | null;
  posX: number;
  posY: number;
  status: DeviceStatus;
  latency?: number | null;
  lastSeen?: string | null;
  failCount?: number;
  alertSent?: boolean;
  notes?: string | null;
  zone?: Zone | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface NetworkConnection {
  id: string;
  sourceId: string;
  targetId: string;
  label?: string | null;
  createdAt?: string;
}

// ── Notificaciones / config ─────────────────────────────────────────────
export interface NotificationTemplate {
  id: string;
  name: string;
  channel: string;
  subject?: string | null;
  body: string;
  preset?: string | null;
  whatsappTemplateName?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface NotificationCampaign {
  id: string;
  name: string;
  templateId?: string | null;
  channel: string;
  audienceJson?: string | null;
  status: 'draft' | 'running' | 'completed' | 'failed';
  generatePaymentLinks?: boolean;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  scheduledAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  template?: NotificationTemplate | null;
}

export interface NotificationSetting {
  id: string;
  type: string;
  enabled: boolean;
  email: boolean;
  whatsapp: boolean;
  schedule?: unknown;
  updatedAt?: string;
  createdAt?: string;
}

export interface SmtpConfig {
  id: string;
  provider?: string | null;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password?: string;
  fromEmail: string;
  fromName: string;
  replyTo?: string | null;
  isActive: boolean;
  isVerified: boolean;
  lastTestedAt?: string | null;
  lastTestResult?: string | null;
}

// ── Inventario ──────────────────────────────────────────────────────────
export interface InventoryProduct {
  id: string;
  name: string;
  category?: string | null;
  imageUrl?: string | null;
  description?: string | null;
  isActive: boolean;
}

export interface InventoryItem {
  id: string;
  productId: string;
  serial?: string | null;
  clientId?: string | null;
  status: string;
  notes?: string | null;
  assignedAt?: string;
  product?: InventoryProduct | null;
}

// ── API ─────────────────────────────────────────────────────────────────
/** Error normalizado por el cliente fetch ($lib/api/client.js). */
export interface ApiError extends Error {
  status?: number;
  code?: string;
  details?: Array<{ field?: string; message?: string }>;
}

/** Meta de paginación que devuelve el listado de clientes/facturas. */
export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages?: number;
}
