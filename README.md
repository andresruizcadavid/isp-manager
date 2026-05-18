# ISP Manager - Sistema de Gestión de ISP

Un sistema completo de gestión para Proveedores de Servicios de Internet (ISP) con arquitectura totalmente desacoplada.

## 🏗️ Arquitectura

- **Backend**: Node.js + Express + Prisma + PostgreSQL
- **Frontend**: SvelteKit + TailwindCSS + DaisyUI
- **Base de Datos**: PostgreSQL
- **Cache**: Redis
- **Pagos**: Wompi
- **Infraestructura**: Docker + Docker Compose

## 📋 Características

### Gestión de Clientes
- CRUD completo de clientes
- Gestión de dispositivos por cliente
- Suspensión/activación automática de servicios
- Cambio de planes
- Historial de pagos y facturas

### Gestión de Facturas
- Generación automática mensual
- Facturas pro-rata
- PDF de facturas
- Recordatorios automáticos
- Reportes de vencimiento

### Gestión de Pagos
- Integración con Wompi
- Pagos manuales
- Reembolsos
- Conciliación bancaria
- Múltiples métodos de pago

### Integración con Mikrotik
- Sincronización automática de clientes
- Gestión de queues (control de ancho de banda)
- Reglas de firewall
- Monitoreo de tráfico
- Gestión DHCP

### Sistema de Notificaciones
- Email (SMTP)
- SMS (Twilio)
- WhatsApp
- Recordatorios de pago
- Notificaciones de servicio

### Reportes y Analytics
- Dashboard en tiempo real
- Reportes financieros
- Reportes de clientes
- Reportes de red
- Exportación de datos

## 🚀 Instalación y Configuración

### Prerrequisitos
- Docker y Docker Compose
- Node.js 18+ (para desarrollo local)
- PostgreSQL 15+ (para desarrollo local)

### Configuración Rápida con Docker

1. **Clonar el repositorio**
```bash
git clone <repository-url>
cd isp-manager
```

2. **Configurar variables de entorno**
```bash
cp .env.example .env
# Editar .env con tus configuraciones
```

3. **Iniciar los servicios**
```bash
docker-compose up -d
```

4. **Acceder a la aplicación**
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- PgAdmin: http://localhost:5050

### Desarrollo Local

#### Backend
```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

#### Frontend
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

## 📁 Estructura del Proyecto

```
isp-manager/
├── backend/                 # API Backend
│   ├── src/
│   │   ├── app.js          # Configuración Express
│   │   ├── server.js       # Servidor HTTP
│   │   ├── config/         # Configuraciones
│   │   ├── controllers/    # Controladores API
│   │   ├── middleware/     # Middleware
│   │   ├── routes/         # Rutas API
│   │   ├── services/       # Servicios de negocio
│   │   ├── jobs/           # Tareas programadas
│   │   └── prisma/         # Schema y migraciones
│   ├── Dockerfile
│   └── package.json
├── frontend/               # SPA Frontend
│   ├── src/
│   │   ├── lib/
│   │   │   ├── api/        # Cliente API
│   │   │   ├── stores/     # Stores Svelte
│   │   │   └── components/ # Componentes UI
│   │   └── routes/         # Páginas SvelteKit
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── docker-compose.yml      # Orquestación Docker
├── .env.example            # Variables de entorno ejemplo
└── README.md              # Este archivo
```

## 🔧 Configuración

### Variables de Entorno Principales

#### Base de Datos
```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/isp_manager"
REDIS_URL="redis://:password@localhost:6379"
```

#### JWT
```env
JWT_SECRET="your-secret-key-min-32-chars"
JWT_EXPIRES_IN="8h"
```

#### SMTP (Email)
```env
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"
```

#### Wompi
```env
WOMPI_PUBLIC_KEY="pub_prod_..."
WOMPI_PRIVATE_KEY="prv_prod_..."
WOMPI_EVENTS_KEY="events_..."
```

#### Mikrotik
```env
MIKROTIK_HOST="192.168.1.1"
MIKROTIK_PORT=8728
MIKROTIK_USERNAME="admin"
MIKROTIK_PASSWORD="password"
```

## 📊 API Endpoints

### Autenticación
- `POST /api/v1/auth/login` - Iniciar sesión
- `POST /api/v1/auth/register` - Registro
- `POST /api/v1/auth/logout` - Cerrar sesión
- `GET /api/v1/auth/me` - Perfil de usuario

### Clientes
- `GET /api/v1/clients` - Listar clientes
- `POST /api/v1/clients` - Crear cliente
- `GET /api/v1/clients/:id` - Obtener cliente
- `PUT /api/v1/clients/:id` - Actualizar cliente
- `DELETE /api/v1/clients/:id` - Eliminar cliente

### Facturas
- `GET /api/v1/invoices` - Listar facturas
- `POST /api/v1/invoices` - Crear factura
- `GET /api/v1/invoices/:id/pdf` - Descargar PDF
- `POST /api/v1/invoices/bulk-generate` - Generar facturas masivas

### Pagos
- `GET /api/v1/payments` - Listar pagos
- `POST /api/v1/payments` - Crear pago
- `POST /api/v1/payments/wompi/checkout/:invoiceId` - Checkout Wompi

### Mikrotik
- `GET /api/v1/mikrotik/queues` - Listar queues
- `POST /api/v1/mikrotik/clients/:id/suspend` - Suspender cliente
- `POST /api/v1/mikrotik/clients/:id/activate` - Activar cliente

## 🔄 Tareas Programadas

El sistema incluye tareas automáticas:

- **Generación de facturas mensuales**: 1 de cada mes a las 2:00 AM
- **Marcado de facturas vencidas**: Diario a las 1:00 AM
- **Recordatorios de pago**: Diario a las 9:00 AM y 6:00 PM
- **Suspensiones automáticas**: Diario a las 8:00 AM
- **Reactivaciones automáticas**: Diario a las 10:00 AM

## 🎨 Componentes UI

El frontend incluye componentes reutilizables:

- `Button` - Botones con múltiples variantes
- `Input` - Campos de entrada con validación
- `Card` - Tarjetas para contenido
- `Table` - Tablas con paginación
- `Modal` - Modales configurables
- `Alert` - Alertas informativas
- `Badge` - Insignias y etiquetas

## 🔐 Roles y Permisos

- **ADMIN**: Acceso completo a todas las funcionalidades
- **OPERATOR**: Gestión de clientes, facturas y pagos
- **VIEWER**: Solo lectura de reportes y dashboard

## 📈 Reportes Disponibles

### Financieros
- Ingresos mensuales
- Reporte de ganancias
- Cobranzas
- Antigüedad de deudas

### Clientes
- Crecimiento de clientes
- Tasa de abandono (churn)
- Adquisición de clientes

### Red
- Tráfico de red
- Interfaces
- DHCP
- Firewall

## 🛠️ Comandos Útiles

### Docker
```bash
# Iniciar todos los servicios
docker-compose up -d

# Ver logs
docker-compose logs -f backend

# Reiniciar un servicio
docker-compose restart backend

# Detener todos los servicios
docker-compose down
```

### Backend
```bash
# Migraciones de base de datos
npx prisma migrate dev

# Generar cliente Prisma
npx prisma generate

# Ver base de datos
npx prisma studio
```

### Frontend
```bash
# Construir para producción
npm run build

# Previsualizar producción
npm run preview
```

## 🐛 Solución de Problemas

### Problemas Comunes

1. **Error de conexión a la base de datos**
   - Verificar que PostgreSQL esté corriendo
   - Revisar variables de entorno DATABASE_URL

2. **Error de conexión a Redis**
   - Verificar que Redis esté corriendo
   - Revisar variables de entorno REDIS_URL

3. **Error de Mikrotik**
   - Verificar configuración de red
   - Revisar credenciales de Mikrotik

4. **Error de pagos Wompi**
   - Verificar claves de API
   - Revisar configuración de webhooks

## 📝 Licencia

Este proyecto está licenciado bajo la MIT License.

## 🤝 Contribución

1. Fork el proyecto
2. Crear un feature branch (`git checkout -b feature/amazing-feature`)
3. Commit los cambios (`git commit -m 'Add some amazing feature'`)
4. Push al branch (`git push origin feature/amazing-feature`)
5. Abrir un Pull Request

## 📞 Soporte

Para soporte técnico, contactar a:
- Email: contacto@miisp.com
- Teléfono: +57 2 555 1234
