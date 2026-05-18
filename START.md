# 🚀 Guía de Inicio Rápido - ISP Manager

## Prerrequisitos

1. **Docker Desktop** instalado (Windows/Mac) o **Docker + Docker Compose** (Linux)
2. **Git** para clonar el repositorio

## 🏁 Inicio del Sistema

### Opción 1: Producción (Recomendado)

```bash
# 1. Clonar el repositorio
git clone <repository-url>
cd isp-manager

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales reales

# 3. Iniciar todos los servicios
docker compose up -d

# 4. Esperar 2-3 minutos mientras se inicializan los servicios
docker compose logs -f
```

### Opción 2: Desarrollo

```bash
# 1. Clonar el repositorio
git clone <repository-url>
cd isp-manager

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales reales

# 3. Iniciar servicios de desarrollo
docker compose -f docker-compose.dev.yml up -d

# 4. Esperar 2-3 minutos mientras se inicializan los servicios
docker compose -f docker-compose.dev.yml logs -f
```

## 🌐 Acceso a los Servicios

Una vez iniciados los servicios, podrás acceder a:

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **PgAdmin**: http://localhost:5050
- **Base de datos**: localhost:5432 (usuario: postgres, contraseña: postgres123)
- **Redis**: localhost:6379 (contraseña: redis123)

## 🔐 Credenciales Demo

### Sistema ISP Manager
- **Email**: admin@demo.com
- **Contraseña**: password123

### PgAdmin
- **Email**: admin@isp-manager.com
- **Contraseña**: admin123

## 📊 Verificar Estado

```bash
# Ver estado de todos los contenedores
docker compose ps

# Ver logs en tiempo real
docker compose logs -f

# Ver logs de un servicio específico
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f pgadmin
```

## 🛠️ Comandos Útiles

```bash
# Reiniciar un servicio
docker compose restart backend
docker compose restart frontend
docker compose restart pgadmin

# Detener todos los servicios
docker compose down

# Limpiar volúmenes (cuidado: elimina datos)
docker compose down -v

# Reconstruir imágenes
docker compose build --no-cache
```

## 🔧 Configuración de Variables de Entorno

Edita el archivo `.env` con tus credenciales reales:

### SMTP (Email)
```env
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_USER="tu-email@gmail.com"
SMTP_PASS="tu-contraseña-de-app"
```

### Wompi (Pagos)
```env
WOMPI_PUBLIC_KEY="pub_test_..."
WOMPI_PRIVATE_KEY="prv_test_..."
WOMPI_EVENTS_KEY="events_test_..."
```

### Mikrotik
```env
MIKROTIK_HOST="192.168.1.1"
MIKROTIK_PORT=8728
MIKROTIK_USERNAME="admin"
MIKROTIK_PASSWORD="tu-contraseña"
```

## 🐛 Solución de Problemas Comunes

### Frontend no carga
```bash
# Reconstruir el frontend
docker compose build frontend
docker compose up -d frontend

# Ver logs del frontend
docker compose logs frontend
```

### PgAdmin no inicia
```bash
# Reiniciar pgadmin
docker compose restart pgadmin

# Limpiar datos de pgadmin
docker compose down
docker volume rm isp-manager_pgadmin_data
docker compose up -d pgadmin
```

### Backend no conecta a la base de datos
```bash
# Verificar que postgres esté healthy
docker compose ps postgres

# Reiniciar backend
docker compose restart backend

# Ver logs del backend
docker compose logs backend
```

### Error de permisos
```bash
# Limpiar y reiniciar todo
docker compose down
docker system prune -f
docker compose up -d
```

## 📱 Primeros Pasos

1. **Accede al frontend**: http://localhost:3000
2. **Inicia sesión** con las credenciales demo
3. **Crea tu primer cliente** en la sección "Clientes"
4. **Configura un plan** en la sección "Planes"
5. **Genera una factura** para probar el sistema

## 🔄 Actualización del Sistema

```bash
# Actualizar imágenes
docker compose pull

# Reconstruir con cambios locales
docker compose build
docker compose up -d
```

## 📞 Soporte

Si tienes problemas:

1. Revisa los logs con `docker compose logs -f`
2. Verifica que Docker esté corriendo correctamente
3. Confirma que los puertos 3000, 3001, 5050 estén disponibles
4. Revisa el archivo `.env` para configuraciones correctas

---

**¡Listo! Tu sistema ISP Manager está funcionando.** 🎉
