# Restaurant Dashboard

Panel de administración para restaurante con gestión de menú, pedidos y reservas.

## 🚀 Características

- **Gestión de Menú**: CRUD completo para items del menú con categorías y stock
- **Gestión de Pedidos**: Sistema de pedidos con estados y seguimiento
- **Pedidos de OpenLivery**: El agente consulta menú y stock, crea pedidos de forma atómica y puede cancelar pedidos pendientes con confirmación en dos pasos
- **Flujo de recogida y reparto**: `Listo` avisa por WhatsApp solo a pedidos de recogida; los pedidos a domicilio reciben avisos separados al pasar a `En reparto` y después a `Entregado`
- **Horario de Andorra**: Los pedidos programados se presentan en `Europe/Andorra`
- **Gestión de Reservas**: Sistema de reservas con filtro por fecha y actualización automática
- **Base de Datos**: PostgreSQL en Easypanel, en una base dedicada (`DATABASE_URL`, driver `pg`)
- **Interfaz Moderna**: React + TypeScript + Tailwind CSS + shadcn/ui
- **Actualización automática**: React Query consulta la API cada 15 segundos, incluyendo pedidos creados por el agente y flujos externos
- **Notificaciones Telegram**: Avisos a Telegram en nuevos pedidos, reservas y stock bajo (opcional, vía `TELEGRAM_BOT_TOKEN`)
- **Usuarios y permisos**: Cuentas individuales con sesiones `HttpOnly`, roles de propietario, cocina y reparto
- **Trazabilidad operativa**: Historial de actividad para propietario sobre pedidos, usuarios, menú y reservas
- **Copias y recuperación**: Exportación diaria cifrada a S3 compatible y restauración controlada en una base aislada
- **Analíticas**: KPIs (ticket promedio, plato estrella, hora pico, tasa de cancelación) y 3 gráficos interactivos
- **Exportación**: Reportes en PDF y CSV compatible con Excel para pedidos, reservas y menú
- **Seguridad**: Helmet, rate-limiting, logging con Morgan y validación con Zod en el servidor
- **Servidor unificado**: Express sirve la API y los archivos estáticos de la aplicación React

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
- **CSV nativo** - Exportación compatible con Excel sin dependencias de procesamiento de hojas de cálculo
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
git clone https://github.com/guillesrl/web-restaurante-admin.git
cd web-restaurante-admin
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Configurar variables de entorno
Crear archivo `.env` (ver `.env.example`):
```env
# Base de datos (obligatoria)
DATABASE_URL=postgresql://user:password@localhost:5432/dashboard_restaurante
# false para PostgreSQL local o interno sin TLS; true si el servidor exige TLS
DATABASE_SSL=false

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

# Aviso event-driven a n8n cuando un repartidor marca un pedido como entregado
# Sustituye el dominio y la ruta por los de tu instancia y workflow de n8n
N8N_DELIVERY_WEBHOOK_URL=https://n8n.example.com/webhook/your-workflow-path
N8N_DELIVERY_WEBHOOK_TOKEN=

# Copias de seguridad externas (opcionales, activan la copia diaria cifrada)
AWS_ENDPOINT_URL_S3=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
BACKUP_BUCKET=
BACKUP_ENCRYPTION_KEY=
# Opcional; por defecto, 24 horas
BACKUP_INTERVAL_HOURS=24
```

**Nota**: Para EasyPanel, usa las mismas variables en la configuración del servicio.

### 4. Base de datos

El servidor usa PostgreSQL mediante `DATABASE_URL` y el driver `pg`. El esquema
canónico está en [`migrations/001_easypanel_postgres.sql`](migrations/001_easypanel_postgres.sql).
Para una instalación nueva, crea primero una base y un usuario dedicados, conecta
la aplicación a esa base y ejecuta el archivo SQL allí. No lo ejecutes en una
base compartida por otros servicios.

En el despliegue actual de Easypanel, la aplicación usa la base dedicada
`dashboard_restaurante` dentro del servicio PostgreSQL existente. La conexión se
configura en las variables del servicio: `DATABASE_URL` apunta a esa base y
`DATABASE_SSL=false` porque la comunicación ocurre por la red interna de
Easypanel sin TLS. Para PostgreSQL externo, configura `DATABASE_SSL=true` cuando
el servidor requiera TLS. Mantén las credenciales solo en el gestor de variables
de entorno; no las añadas al repositorio.

La migración inicial conservó las 32 entradas del menú e importó las cinco
reservas y los cinco pedidos más recientes de la base de origen. La base de
origen no se modificó. En ese corte, los pedidos importados estaban en estado
`pending` y las reservas en `confirmed`; revisa sus fechas antes de tratarlos
como actividad vigente.

El servidor añade al arrancar algunas columnas operativas que falten en `orders`
y crea las tablas auxiliares de usuarios, auditoría, confirmación de
cancelaciones y copias de seguridad. Tras desplegar desde una versión anterior,
entra una última vez con la contraseña compartida y crea desde el botón de
usuarios una cuenta de `Propietario`; desde entonces la contraseña compartida
queda desactivada.

## 🏃‍♂️ Ejecutar la Aplicación

### Opción 1: Desarrollo (Frontend + Backend)
```bash
npm run dev:full
```

Con `PORT=8080`, Express escucha en el puerto 8080 y Vite en el 3002; Vite
redirige las llamadas a `/api` al backend.

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
- **Base de Datos**: PostgreSQL en Easypanel mediante `DATABASE_URL`

### Build Command
```bash
npm ci --include=dev
npm run build && npm prune --omit=dev
```

### Start Command
```bash
npm start
```

### Variables de entorno (EasyPanel)

```env
# Base de datos dedicada en la red interna de Easypanel
DATABASE_URL=postgresql://dashboard_restaurante_app:password@n8n_postgres:5432/dashboard_restaurante
# PostgreSQL interno de Easypanel no usa TLS
DATABASE_SSL=false

PORT=80
NODE_ENV=production

# Auth: contraseña compartida temporal para migrar la primera cuenta
DASHBOARD_PASSWORD=
DASHBOARD_AUTH_SECRET=
# Notificaciones (opcionales)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
AGENT_ORDER_API_KEY=

# Aviso event-driven a n8n cuando un repartidor marca un pedido como entregado
# Sustituye el dominio y la ruta por los de tu instancia y workflow de n8n
N8N_DELIVERY_WEBHOOK_URL=https://n8n.example.com/webhook/your-workflow-path
N8N_DELIVERY_WEBHOOK_TOKEN=

# Opcional: forzar versión de Node.js
NODE_VERSION=20
```

### Auto-despliegue desde GitHub

El servicio de EasyPanel debe estar configurado con el repositorio y la rama `main`
y con **Auto Deploy** activado. Un `push` a `main` inicia el build y despliegue
automáticamente; no hace falta ni se recomienda usar una reconstrucción forzada
para cambios normales. Verifica el resultado comparando el commit desplegado en
EasyPanel con el commit enviado a GitHub.

Mantén **un único webhook activo** de GitHub para este servicio. Dos webhooks
apuntando al mismo destino disparan despliegues duplicados y pueden dejar builds
en cola o con errores aparentes. Tras recrear la integración de EasyPanel,
verifica en GitHub que el webhook anterior ya no siga activo.

### Notas sobre el build con Nixpacks (EasyPanel)

- EasyPanel usa Nixpacks para generar el Dockerfile. El proyecto solicita Node 20 mediante `.nvmrc`.
- El build usa `npm ci --include=dev` para disponer de Vite, React y el resto de herramientas de compilación; después `npm prune --omit=dev` elimina esas dependencias antes de arrancar Express.
- Las dependencias del navegador y de build están en `devDependencies`; el runtime conserva solo Express, PostgreSQL, seguridad, validación y S3.
- `rollup-plugin-visualizer` (solo para análisis local con `npm run analyze`) se importa de forma dinámica.
- El archivo `.npmrc` incluye `legacy-peer-deps=true` para que npm v10 no falle por conflictos de peer dependencies entre `vitest@4.x` y `vite@5.x`.
- `pg` (driver de PostgreSQL) es dependencia obligatoria y compila sin problemas en la imagen. Evita añadir módulos nativos que NO uses (p. ej. `sqlite3`), que requieren herramientas de compilación ausentes.

### Estructura del Servidor

- **API Endpoints**: `/api/*` - manejados por Express
- **Frontend**: Archivos estáticos servidos desde `/dist`
- **Health Check**: `/api/health` - para verificar estado del servidor
- **DB Health Check**: `/api/db-health` - para verificar conexión a PostgreSQL

## 📡 API Endpoints

Las rutas del dashboard requieren una sesión activa si hay cuentas configuradas.
Las rutas `/api/agent/*` usan `AGENT_ORDER_API_KEY` en lugar de esa sesión, y
las rutas públicas de acceso y salud no requieren autenticación. Los permisos
del dashboard se validan en servidor:
propietario gestiona todo; cocina consulta el menú, las descripciones, el stock
y sus avisos, además de avanzar pedidos a `Preparando` o `Listo`; reparto pasa
pedidos a `En reparto` o `Entregado`. Solo el propietario puede modificar el
menú o el stock.

### Auth y health
- `GET /api/health` - Estado del servidor
- `GET /api/db-health` - Estado de la conexión a PostgreSQL (solo propietario)
- `GET /api/auth/status` - Indica el estado de acceso y si falta migrar la primera cuenta
- `POST /api/login` - Inicia una sesión por cookie segura
- `POST /api/logout` - Cierra la sesión actual
- `GET /api/auth/me` - Devuelve el usuario de la sesión actual
- `GET|POST /api/users` y `PATCH /api/users/:id` - Gestión de usuarios, solo propietario
- `GET /api/audit-events` - Historial de acciones, solo propietario
- `GET /api/backups` - Estado y ejecuciones de copias, solo propietario
- `POST /api/backups` - Crea una copia manual cifrada, solo propietario

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

Todo pedido creado por el agente o desde el dashboard reserva stock en la misma
transacción. Una cancelación solo es válida mientras está `pending`; devuelve
el stock reservado una única vez y deja constancia de su origen (`agent` o
`dashboard`). El dashboard muestra antes un resumen y requiere confirmación.

Para el agente, la misma ruta evita cancelar un pedido por accidente:

1. `{"action":"prepare_cancel","order_id":123,"customer_phone":"600123"}`
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
WhatsApp configurada y marca el aviso como enviado. El dashboard programa ese
aviso al marcar `Listo` con una espera de un minuto, para permitir corregir un
cambio accidental de estado.

Para pedidos a domicilio, `Listo` significa que cocina ha terminado: no envía
ningún mensaje al cliente. El operador cambia después a `En reparto` cuando el
repartidor sale y a `Entregado` al finalizar.

### Aviso de pedido en camino

Al cambiar un pedido a domicilio a `En reparto`, el dashboard programa un aviso
con un minuto de espera. El archivo exportado del workflow de n8n
`Restaurante — Aviso de pedido en camino` (`M3dEnCamino2026`), definido en
`n8n/pedido-en-camino-notificacion.json`, comprueba cada minuto que el pedido
siga en ese estado, sea de reparto y no tenga ya el aviso enviado. Envía la
plantilla configurada `pedido_en_camino|es` con nombre, número, dirección y total;
solo después de que Meta acepte el envío marca
`out_for_delivery_notification_sent_at`. Si el pedido sale de `En reparto`
antes del aviso, se anula el envío pendiente. Esta marca es independiente de
las de los avisos de recogida y entrega.

Los dos archivos de `n8n/` usan la credencial `Restaurante Easypanel PostgreSQL`
y figuran como activos. Esa credencial apunta a la base dedicada
`dashboard_restaurante` en el despliegue actual. Al importar los archivos en
otra instancia, vincula los nodos PostgreSQL a una credencial propia y revisa
la configuración de WhatsApp antes de activarlos; los identificadores de
credenciales de n8n son específicos de cada instancia.

### Reservas
- `GET /api/reservations?filter=today|month` - Obtener reservas con filtros server-side
- `POST /api/reservations` - Crear nueva reserva
- `PATCH /api/reservations/:id/status` - Cambiar estado
- `DELETE /api/reservations/:id` - Eliminar reserva

## 🔧 Configuración Avanzada

### React Query + API propia
El dashboard usa React Query para cache automático con `staleTime: 30s`, invalidación tras mutaciones y una consulta periódica cada 15 segundos a la API propia. Así se reflejan los cambios creados por el dashboard, el agente y los flujos externos sin exponer una conexión de base de datos al navegador.

### Exportación de Reportes
Cada sección (pedidos, reservas, menú) incluye botones para exportar a PDF y CSV UTF-8 con nombres de archivo con fecha. La exportación de pedidos respeta el filtro visible; menú y reservas exportan la lista cargada. El CSV se abre directamente con Excel y evita incluir un motor de hojas de cálculo en el navegador.

### Variables de Entorno Soportadas
- `DATABASE_URL`: Cadena de conexión a PostgreSQL (obligatoria)
- `DATABASE_SSL`: Usa TLS (`true`, por defecto); pon `false` solo para una conexión privada sin TLS
- `PORT`: Puerto de Express (80 por defecto; el ejemplo de desarrollo usa 8080)
- `NODE_ENV`: Entorno (development/production)
- `VITE_API_URL`: URL base de la API (default: `/api`)
- `DASHBOARD_PASSWORD`: Contraseña compartida temporal para migrar la primera cuenta
- `DASHBOARD_AUTH_SECRET`: Secreto largo y aleatorio para firmar sesiones
- `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`: Acceso al almacenamiento S3 compatible
- `BACKUP_BUCKET`: Bucket privado donde se guardan las copias cifradas
- `BACKUP_ENCRYPTION_KEY`: Clave larga y aleatoria usada para cifrado AES-256-GCM; no la cambies mientras existan copias que quieras recuperar
- `BACKUP_INTERVAL_HOURS`: Frecuencia de la copia automática (24 por defecto)
- `TELEGRAM_BOT_TOKEN`: Token del bot para notificaciones (opcional)
- `TELEGRAM_CHAT_ID`: Chat destino de las notificaciones (opcional)
- `AGENT_ORDER_API_KEY`: Clave de la API privada del agente (opcional)
- `N8N_DELIVERY_WEBHOOK_URL`, `N8N_DELIVERY_WEBHOOK_TOKEN`: Webhook del aviso de entrega (opcional)

## 🐛 Troubleshooting

### Error de conexión a la base de datos
- Verifica que `DATABASE_URL` sea correcta y la base sea accesible (el propietario puede usar `GET /api/db-health`)
- Confirma que las tablas `menu`, `orders` y `reservations` existan
- Comprueba `GET /api/db-health` y que `DATABASE_URL` esté configurada en EasyPanel

### Error "Node.js 18 and below are deprecated"
- Usa Node.js 20 o superior
- En EasyPanel, agrega `.nvmrc` con `20` o configura `NODE_VERSION=20`

### Error `npm ci` en Docker: "Missing from lock file" o módulo no encontrado
- EasyPanel debe instalar con `npm ci --include=dev` y ejecutar `npm run build && npm prune --omit=dev`; con otro comando pueden faltar herramientas de compilación.
- Si aparece "Missing: esbuild@X.X.X from lock file", el lockfile está desincronizado con las peer deps. Verificar `.npmrc` tiene `legacy-peer-deps=true`.
- `pg` es el driver principal de la base de datos: NO lo elimines de `package.json`. Solo aplica a módulos nativos realmente no usados (p. ej. `sqlite3`).

### Copias y recuperación

Si el proveedor de PostgreSQL ofrece historial o ramas, revísalos antes de
restaurar. Para Easypanel, prepara una base aislada y valida allí la copia antes
de tocar la base activa.

Para una copia independiente, configura las seis variables S3 y de cifrado en
EasyPanel. El dashboard iniciará una copia automática al arrancar si no existe
otra dentro del intervalo configurado. El propietario puede comprobar el estado
o crear una copia manual desde el icono de base de datos de la cabecera.

La restauración de una copia externa se debe realizar **solo en una base aislada**.
Créala y aplica primero `migrations/001_easypanel_postgres.sql` para que existan
las tablas que restaura el script.
El script exige confirmación explícita y rechaza `NODE_ENV=production`, pero no
puede comprobar que la URL corresponda a una base aislada. Revisa el destino
antes de ejecutarlo, ya que vacía las tablas de la base indicada. Para la red
interna de Easypanel, usa `RESTORE_DATABASE_SSL=false`; con PostgreSQL que
requiere TLS, omite esa variable.

```bash
RESTORE_DATABASE_URL='postgresql://usuario:clave@host:5432/base-aislada' \
RESTORE_DATABASE_SSL=false \
RESTORE_CONFIRM=RESTORE_TO_ISOLATED_DATABASE \
AWS_ENDPOINT_URL_S3=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
AWS_REGION=... BACKUP_BUCKET=... BACKUP_ENCRYPTION_KEY=... \
node scripts/restore-backup.mjs restaurant-dashboard/backup.json.gz.enc
```

Después verifica pedidos, menú y usuarios en la base aislada. Para cualquier
restauración real de producción, valida primero el punto de recuperación y
coordina una ventana de mantenimiento: el script se niega a ejecutarse con
`NODE_ENV=production`.

### Dos despliegues por cada push
- Revisa los webhooks del repositorio en GitHub. Debe haber un solo webhook activo
  de tipo `push` para el servicio de EasyPanel.
- Elimina únicamente el webhook duplicado después de comprobar que el otro recibió
  correctamente la última entrega y que el commit desplegado coincide con GitHub.

### Error "Cannot GET /"
- Asegúrate de haber ejecutado `npm run build` para generar la carpeta `/dist`
- Verifica que el comando de inicio en producción sea `npm start`

### Error de Express 5 con rutas wildcard
- El proyecto usa `app.get(/^\/(?!api\/).*/, ...)` en lugar de `app.get('*')` para compatibilidad con Express 5

### Puerto en uso
- El servidor unificado usa el puerto configurado en `PORT` (por defecto, 80)
- `npm run dev` inicia Vite en el puerto 3002 y envía `/api` al backend en el 8080

### Logs duplicados
- React Query deduplica automáticamente las peticiones concurrentes
- React Query vuelve a consultar la API cada 15 segundos mientras el dashboard está abierto

## 📝 Notas de Desarrollo

- El proyecto usa TypeScript para tipado seguro
- Los componentes usan shadcn/ui para UI consistente
- La API sigue formato RESTful con filtros server-side para pedidos y reservas
- Los pedidos programados se presentan en `Europe/Andorra`; el filtro `today` de la API usa UTC, `month` depende de la zona horaria del servidor y los rangos de analíticas usan la del navegador
- Las reservas guardan fecha y hora locales sin conversión de zona horaria
- El servidor Express sirve tanto API como frontend (SPA routing)
- React Query gestiona el estado del servidor con hooks personalizados en `src/hooks/use-queries.ts`
- Los cambios de menú, pedidos y reservas se consultan mediante la API propia y `src/hooks/use-queries.ts`
- La exportación a PDF/CSV usa jspdf y APIs nativas del navegador desde `src/lib/export.ts`
- ChunkErrorBoundary maneja fallos de carga de red con mensaje amigable
- To update dependencies, use `npm update` and check for breaking changes

## 🤝 Contribuir

1. Fork el proyecto
2. Crear feature branch (`git checkout -b feature/nueva-funcionalidad`)
3. Commit cambios (`git commit -m 'Agregar nueva funcionalidad'`)
4. Push al branch (`git push origin feature/nueva-funcionalidad`)
5. Abrir Pull Request
