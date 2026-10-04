# Restaurant Dashboard

Panel de administración para restaurante con gestión de menú, pedidos y reservas.

## 🚀 Características

- **Gestión de Menú**: CRUD completo para items del menú con categorías y stock
- **Gestión de Pedidos**: Sistema de pedidos con estados y seguimiento
- **Pedidos de OpenLivery**: El agente consulta menú y stock, crea pedidos de forma atómica y puede cancelar pedidos pendientes con confirmación en dos pasos
- **Flujo de recogida y reparto**: `Listo` avisa por WhatsApp solo a pedidos de recogida; los pedidos a domicilio pasan después por `En reparto` y finalmente `Entregado`
- **Horario de Andorra**: Fechas y horas operativas se muestran y almacenan para el negocio en `Europe/Andorra`
- **Gestión de Reservas**: Sistema de reservas con filtro por fecha y actualización automática
- **Base de Datos**: Neon PostgreSQL vía conexión directa (`DATABASE_URL`, driver `pg`)
- **Interfaz Moderna**: React + TypeScript + Tailwind CSS + shadcn/ui
- **Actualización automática**: React Query consulta la API cada 15 segundos, incluyendo pedidos creados por el agente y flujos externos
- **Notificaciones Telegram**: Avisos a Telegram en nuevos pedidos, reservas y stock bajo (opcional, vía `TELEGRAM_BOT_TOKEN`)
- **Usuarios y permisos**: Cuentas individuales con sesiones `HttpOnly`, roles de propietario, cocina y reparto
- **Trazabilidad operativa**: Historial de actividad para propietario sobre pedidos, usuarios, menú y reservas
- **Analíticas**: KPIs (ticket promedio, plato estrella, hora pico, tasa de cancelación) + 4 gráficos interactivos
- **Exportación**: Reportes en PDF y Excel para pedidos, reservas y menú
- **Seguridad**: Helmet, rate-limiting, logging con Morgan y validación con Zod en el servidor
- **Server-side Rendering**: Express sirve tanto API como frontend estático

## 🛠️ Tecnologías

### Frontend
- **React 18** - Framework de UI
- **TypeScript** - Tipado estático
- **Vite** - Build tool y desarrollo
- **Tailwind CSS** - Framework de estilos
- **shadcn/ui** - Componentes UI
- **Lucide React** - Iconos
- **React Query** - Gestión de estado del servidor con cache automático e invalidación inteligente
- **jsPDF + jspdf-autotable** - Exportación de reportes a PDF
- **xlsx** - Exportación de reportes a Excel
- **Vitest + Testing Library** - Tests unitarios y de componentes
- **ErrorBoundary + ChunkErrorBoundary** - Captura de errores en árbol de componentes y fallos de carga de red

### Backend
- **Node.js 20+** - Runtime del servidor
- **Express.js 5** - Framework web
- **PostgreSQL** - Base de datos, conexión directa vía `DATABASE_URL`
- **pg** - Driver de PostgreSQL (Pool de conexiones)
- **Zod** - Validación de payloads en la API
- **Autenticación propia** (`auth.js`) - Sesiones firmadas en cookies `HttpOnly` y contraseñas con scrypt
- **Notificaciones Telegram** (`notify.js`) - Avisos vía Bot API (tolerante a fallo)
- **Helmet** - Headers de seguridad HTTP
- **express-rate-limit** - Limitación de peticiones (200 req/15min)
- **Morgan** - Logging de requests
- **CORS** - Habilitar peticiones cross-origin
- **dotenv** - Gestión de variables de entorno

## 📋 Requisitos Previos

- Node.js 20+
- Una base de datos PostgreSQL accesible (cadena `DATABASE_URL`)
- npm o yarn

## 🚀 Instalación y Configuración

### 1. Clonar el repositorio
```bash
git clone <repository-url>
cd dashboard-2026
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Configurar variables de entorno
Crear archivo `.env` (ver `.env.example`):
```env
# Base de datos (obligatorio) — Postgres directo
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require

VITE_API_URL=/api

# Servidor
PORT=8080
NODE_ENV=development

# Migración inicial desde la contraseña compartida (temporal)
DASHBOARD_PASSWORD=
# Se recomienda definir este secreto aleatorio largo en producción
DASHBOARD_AUTH_SECRET=

# Notificaciones Telegram (opcional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# API privada para el agente de pedidos (obligatoria si se conecta OpenLivery)
AGENT_ORDER_API_KEY=
```

**Nota**: Para EasyPanel, usa las mismas variables en la configuración del servicio.

### 4. Base de Datos
El backend se conecta a PostgreSQL vía `DATABASE_URL` (con `pg`). Asegúrate de que la base tenga las siguientes tablas:

#### Tabla `menu`
```sql
CREATE TABLE menu (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    ingredientes TEXT,
    precio DECIMAL(10,2) NOT NULL,
    categoria VARCHAR(100) NOT NULL,
    stock INTEGER DEFAULT 0,
    vegetariano VARCHAR(10) DEFAULT 'no',
    gluten VARCHAR(10) DEFAULT 'no',
    marisco VARCHAR(10) DEFAULT 'no',
    lactosa VARCHAR(10) DEFAULT 'no',
    vegano VARCHAR(10) DEFAULT 'no',
    available BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### Tabla `orders`
```sql
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    telefono VARCHAR(50),
    direccion VARCHAR(255) DEFAULT 'Dirección no especificada',
    items JSONB NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    time VARCHAR(10),
    source VARCHAR(50),
    fulfillment_type VARCHAR(20), -- pickup | delivery
    scheduled_for TIMESTAMPTZ,
    observations TEXT,
    stock_reserved_at TIMESTAMPTZ,
    stock_restored_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancelled_by VARCHAR(50), -- agent | dashboard
    delivery_notification_due_at TIMESTAMPTZ,
    delivery_notification_claimed_at TIMESTAMPTZ,
    delivery_notification_sent_at TIMESTAMPTZ,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

El servidor añade automáticamente las columnas operativas que falten al iniciar.
Para cancelaciones de agentes también crea la tabla interna
`agent_order_cancellation_confirmations`, cuyos tokens expiran a los diez minutos.

#### Tabla `dashboard_users`
```sql
CREATE TABLE dashboard_users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL, -- owner | kitchen | driver
    password_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### Tabla `audit_events`

Registra usuario, rol y momento de las operaciones críticas realizadas desde el
dashboard: pedidos, usuarios, menú y reservas. El propietario puede consultarlo
desde el icono de historial en la cabecera.

Tras desplegar desde la versión anterior, entra una última vez con la
contraseña compartida y crea desde el botón de usuarios una cuenta de
`Propietario`. Desde ese momento la contraseña compartida queda desactivada.

#### Tabla `reservations`
```sql
CREATE TABLE reservations (
    id SERIAL PRIMARY KEY,
    customer_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    time TIME NOT NULL,
    people INTEGER NOT NULL,
    table_number INTEGER,
    status VARCHAR(50) DEFAULT 'confirmed',
    google_event_id VARCHAR(255),
    observations TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

## 🏃‍♂️ Ejecutar la Aplicación

### Opción 1: Desarrollo (Frontend + Backend)
```bash
npm run dev:full
```

### Opción 2: Desarrollo por separado
```bash
# Terminal 1: Backend
npm run server

# Terminal 2: Frontend
npm run dev
```

### Opción 3: Producción
```bash
npm run build
npm start
```

## 🚀 Deploy en EasyPanel

Este proyecto está configurado para correr en **un solo servicio** (recomendado):

- **Servidor Unificado**: Express maneja tanto la API (`/api/*`) como el frontend estático
- **Sin proxy necesario**: Todo corre en el mismo puerto
- **Base de Datos**: Neon PostgreSQL mediante `DATABASE_URL`

### Build Command
```bash
npm ci
npm run build
```

### Start Command
```bash
npm start
```

### Variables de entorno (EasyPanel)

```env
# Base de datos (obligatorio)
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require

PORT=80
NODE_ENV=production

# Auth: contraseña compartida temporal para migrar la primera cuenta
DASHBOARD_PASSWORD=
DASHBOARD_AUTH_SECRET=
# Notificaciones (opcionales)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
AGENT_ORDER_API_KEY=

# Opcional: forzar versión de Node.js
NODE_VERSION=20
```

### Auto-despliegue desde GitHub

El servicio de EasyPanel debe estar configurado con el repositorio y la rama `main`
y con **Auto Deploy** activado. Un `push` a `main` inicia el build y despliegue
automáticamente; no hace falta ni se recomienda usar una reconstrucción forzada
para cambios normales. Verifica el resultado comparando el commit desplegado en
EasyPanel con el commit enviado a GitHub.

### Notas sobre el build con Nixpacks (EasyPanel)

- EasyPanel usa Nixpacks que genera un Dockerfile automáticamente con Node 20.18.1 y npm 10.8.2.
- `NODE_ENV=production` hace que `npm ci` omita las devDependencies, por lo que ningún devDependency puede ser importado estáticamente en `vite.config.ts`.
- `rollup-plugin-visualizer` (solo para análisis local con `npm run analyze`) se importa de forma dinámica para evitar este error.
- El archivo `.npmrc` incluye `legacy-peer-deps=true` para que npm v10 no falle por conflictos de peer dependencies entre `vitest@4.x` y `vite@5.x`.
- `pg` (driver de PostgreSQL) es dependencia obligatoria y compila sin problemas en la imagen. Evita añadir módulos nativos que NO uses (p. ej. `sqlite3`), que requieren herramientas de compilación ausentes.

### Estructura del Servidor

- **API Endpoints**: `/api/*` - manejados por Express
- **Frontend**: Archivos estáticos servidos desde `/dist`
- **Health Check**: `/api/health` - para verificar estado del servidor
- **DB Health Check**: `/api/db-health` - para verificar conexión a PostgreSQL

## 📡 API Endpoints

Todas las rutas `/api/*` (salvo las públicas de auth y health) requieren una
sesión activa si hay cuentas configuradas. Los permisos se validan en servidor:
propietario gestiona todo, cocina avanza a `Preparando` o `Listo`, y reparto a
`En reparto` o `Entregado`.

### Auth y health
- `GET /api/health` - Estado del servidor
- `GET /api/db-health` - Estado de la conexión a PostgreSQL (solo propietario)
- `GET /api/auth/status` - Indica el estado de acceso y si falta migrar la primera cuenta
- `POST /api/login` - Inicia una sesión por cookie segura
- `POST /api/logout` - Cierra la sesión actual
- `GET /api/auth/me` - Devuelve el usuario de la sesión actual
- `GET|POST|PATCH /api/users` - Gestión de usuarios, solo propietario
- `GET /api/audit-events` - Historial de acciones, solo propietario

### Menú
- `GET /api/menu` - Obtener todos los items
- `POST /api/menu` - Crear nuevo item
- `PUT /api/menu/:id` - Actualizar item
- `PATCH /api/menu/:id/stock` - Actualizar solo el stock
- `DELETE /api/menu/:id` - Eliminar item

### Pedidos
- `GET /api/orders?filter=today|month|active` - Obtener pedidos con filtros server-side
- `POST /api/orders` - Crear nuevo pedido
- `PATCH /api/orders/:id/status` - Cambiar estado

### Pedidos de OpenLivery

El backend ofrece dos rutas privadas para agentes, protegidas por la cabecera
`x-agent-api-key` con el valor de `AGENT_ORDER_API_KEY`:

- `GET /api/agent/menu` - Menú y stock operativo.
- `POST /api/agent/orders` - Gestiona pedidos con una transacción y la clave de
  agente. Para alta valida líneas, bloquea el inventario, crea el pedido y
  descuenta el stock de forma atómica.

El total se calcula en el servidor; el agente nunca envía precios ni puede
modificar stock directamente. Para clientes de herramientas HTTP que no
admiten arrays anidados, el `POST` también acepta un único campo `order_json`
con el JSON completo del pedido.

#### Cancelación y reposición de stock

Todo pedido creado por Leandro o desde el dashboard reserva stock en la misma
transacción. Una cancelación solo es válida mientras está `pending`; devuelve
el stock reservado una única vez y deja constancia de su origen (`agent` o
`dashboard`). El dashboard muestra antes un resumen y requiere confirmación.

Para Leandro, la misma ruta evita cancelar un pedido por accidente:

1. `{"action":"prepare_cancel","order_id":9,"customer_phone":"615808"}`
   valida que el pedido esté pendiente y devuelve un resumen junto con un token
   temporal. No modifica el pedido ni el stock.
2. Solo después de una nueva confirmación explícita del cliente, se envía
   `{"action":"confirm_cancel","cancellation_token":"<token>"}`. Entonces
   cambia el pedido a `cancelled`, repone el stock reservado y anula cualquier
   aviso de pedido listo pendiente.

La acción directa `{"action":"cancel"}` se rechaza. El teléfono puede ser un
número local de Andorra de seis dígitos; el prefijo `+376` es opcional.

### Aviso de pedido listo

El archivo `n8n/pedido-entregado-notificacion.json` contiene el flujo de n8n
que se ejecuta cada minuto. Selecciona únicamente pedidos de **recogida** con
estado `ready`, teléfono disponible y aviso vencido; envía la plantilla de
WhatsApp aprobada y marca el aviso como enviado. El dashboard programa ese
aviso al marcar `Listo` con una espera de un minuto, para permitir corregir un
cambio accidental de estado.

Para pedidos a domicilio, `Listo` significa que cocina ha terminado: no envía
ningún mensaje al cliente. El operador cambia después a `En reparto` cuando el
repartidor sale y a `Entregado` al finalizar. El aviso de “va en camino” se
puede activar cuando exista una plantilla Meta específica aprobada.

### Reservas
- `GET /api/reservations?filter=today|month` - Obtener reservas con filtros server-side
- `POST /api/reservations` - Crear nueva reserva
- `PATCH /api/reservations/:id/status` - Cambiar estado
- `DELETE /api/reservations/:id` - Eliminar reserva

## 🔧 Configuración Avanzada

### React Query + API propia
El dashboard usa React Query para cache automático con `staleTime: 30s`, invalidación tras mutaciones y una consulta periódica cada 15 segundos a la API propia. Así se reflejan los cambios creados por el dashboard, el agente y los flujos externos sin exponer una conexión de base de datos al navegador.

### Exportación de Reportes
Cada sección (pedidos, reservas, menú) incluye botones para exportar a PDF y Excel con datos filtrados y nombres de archivo con fecha.

### Variables de Entorno Soportadas
- `DATABASE_URL`: Cadena de conexión a PostgreSQL (obligatoria)
- `PORT`: Puerto del servidor (default: 80 en producción, 8080 en desarrollo)
- `NODE_ENV`: Entorno (development/production)
- `VITE_API_URL`: URL base de la API (default: `/api`)
- `DASHBOARD_PASSWORD`: Contraseña compartida temporal para migrar la primera cuenta
- `DASHBOARD_AUTH_SECRET`: Secreto largo y aleatorio para firmar sesiones
- `TELEGRAM_BOT_TOKEN`: Token del bot para notificaciones (opcional)
- `TELEGRAM_CHAT_ID`: Chat destino de las notificaciones (opcional)

## 🐛 Troubleshooting

### Error de conexión a la base de datos
- Verifica que `DATABASE_URL` sea correcta y la base sea accesible (usa `GET /api/db-health`)
- Confirma que las tablas `menu`, `orders` y `reservations` existan
- Comprueba `GET /api/db-health` y que `DATABASE_URL` esté configurada en EasyPanel

### Error "Node.js 18 and below are deprecated"
- Usa Node.js 20 o superior
- En EasyPanel, agrega `.nvmrc` con `20` o configura `NODE_VERSION=20`

### Error `npm ci` en Docker: "Missing from lock file" o módulo no encontrado
- Si aparece "Cannot find package X" durante el build, verificar que X no sea devDependency importada estáticamente en `vite.config.ts` (ver nota Nixpacks arriba).
- Si aparece "Missing: esbuild@X.X.X from lock file", el lockfile está desincronizado con las peer deps. Verificar `.npmrc` tiene `legacy-peer-deps=true`.
- `pg` es el driver principal de la base de datos: NO lo elimines de `package.json`. Solo aplica a módulos nativos realmente no usados (p. ej. `sqlite3`).

### Error "Cannot GET /"
- Asegúrate de haber ejecutado `npm run build` para generar la carpeta `/dist`
- Verifica que el comando de inicio en producción sea `npm start`

### Error de Express 5 con rutas wildcard
- El proyecto usa `app.get(/^\/(?!api\/).*/, ...)` en lugar de `app.get('*')` para compatibilidad con Express 5

### Puerto en uso
- El servidor unificado usa el puerto configurado en `PORT` (default: 80)
- En desarrollo usa el puerto que asigne Vite (usualmente 5173)

### Logs duplicados
- React Query deduplica automáticamente las peticiones concurrentes
- React Query vuelve a consultar la API cada 15 segundos mientras el dashboard está abierto

## 📝 Notas de Desarrollo

- El proyecto usa TypeScript para tipado seguro
- Los componentes usan shadcn/ui para UI consistente
- La API sigue formato RESTful con filtros server-side para pedidos y reservas
- Las fechas se manejan con timezone local
- El filtro de reservas maneja correctamente zonas horarias
- El servidor Express sirve tanto API como frontend (SPA routing)
- React Query gestiona el estado del servidor con hooks personalizados en `src/hooks/use-queries.ts`
- Los cambios de menú, pedidos y reservas se consultan mediante la API propia y `src/hooks/use-queries.ts`
- La exportación a PDF/Excel usa jspdf y xlsx desde `src/lib/export.ts`
- ChunkErrorBoundary maneja fallos de carga de red con mensaje amigable
- To update dependencies, use `npm update` and check for breaking changes

## 🤝 Contribuir

1. Fork el proyecto
2. Crear feature branch (`git checkout -b feature/nueva-funcionalidad`)
3. Commit cambios (`git commit -m 'Agregar nueva funcionalidad'`)
4. Push al branch (`git push origin feature/nueva-funcionalidad`)
5. Abrir Pull Request

## 📄 Licencia

MIT License - ver archivo LICENSE para detalles
