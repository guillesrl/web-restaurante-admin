import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import {
  checkLegacyPassword,
  clearSessionCookie,
  createSession,
  hashPassword,
  legacyAuthEnabled,
  passwordPolicy,
  readSession,
  setSessionCookie,
  verifyPassword,
} from './auth.js';
import { notifyTelegram, telegramEnabled } from './notify.js';
import { cancelPendingOrder } from './orderCancellation.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
const port = process.env.PORT || 80;

const DATABASE_URL = process.env.DATABASE_URL;
const AGENT_ORDER_API_KEY = process.env.AGENT_ORDER_API_KEY || '';

if (!DATABASE_URL) {
  console.error('❌ Error: DATABASE_URL debe estar definida en las variables de entorno');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL pool error:', err.message);
});

// Zod validation schemas
const menuSchema = z.object({
  name: z.string().min(1).max(255),
  price: z.number().positive(),
  category: z.string().min(1).max(100),
  stock: z.number().int().min(0).default(0),
  description: z.string().optional(),
  vegetariano: z.string().optional(),
  gluten: z.string().optional(),
  marisco: z.string().optional(),
  lactosa: z.string().optional(),
  vegano: z.string().optional(),
});

const orderSchema = z.object({
  customer_name: z.string().min(1).max(255),
  customer_phone: z.string().optional(),
  items: z.array(z.object({
    id: z.number().int().positive(),
    name: z.string().min(1).max(255),
    price: z.number().nonnegative(),
    quantity: z.number().int().min(1),
  })).min(1),
  total: z.number().positive(),
  fulfillment_type: z.enum(['pickup', 'delivery']).optional(),
  status: z.enum(['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled']).optional(),
});

const orderStatusSchema = z.enum(['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled']);
const dashboardRoleSchema = z.enum(['owner', 'kitchen', 'driver']);
const dashboardUserSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255),
  role: dashboardRoleSchema,
  password: z.string().min(12).max(200),
});
const dashboardUserUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  role: dashboardRoleSchema.optional(),
  password: z.string().min(12).max(200).optional(),
  is_active: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Indica al menos un cambio' });
const loginSchema = z.object({
  email: z.string().trim().email().max(255).optional(),
  password: z.string().min(1).max(200),
});

const agentOrderSchema = z.object({
  customer_name: z.string().trim().min(1).max(255),
  customer_phone: z.string().trim().min(1).max(50).optional(),
  fulfillment: z.enum(['pickup', 'delivery']),
  address: z.string().trim().min(1).max(255).optional(),
  scheduled_for: z.string().datetime({ offset: true }).optional(),
  observations: z.string().trim().max(2000).optional(),
  items: z.array(z.object({
    menu_item_id: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(255).optional(),
    quantity: z.number().int().min(1).max(100),
  }).superRefine((item, ctx) => {
    if (!item.menu_item_id && !item.name) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Cada artículo necesita menu_item_id o name' });
    }
  })).min(1).max(50),
}).superRefine((order, ctx) => {
  if (order.fulfillment === 'delivery' && !order.address) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['address'], message: 'La dirección es obligatoria para domicilio' });
  }
});

const agentCancelPreparationSchema = z.object({
  action: z.literal('prepare_cancel'),
  order_id: z.coerce.number().int().positive(),
  customer_phone: z.string().trim().min(6).max(50),
});

const agentCancelConfirmationSchema = z.object({
  action: z.literal('confirm_cancel'),
  cancellation_token: z.string().uuid(),
});

const reservationSchema = z.object({
  customer_name: z.string().min(1).max(255),
  customer_phone: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  guests: z.number().int().min(1),
  status: z.enum(['confirmed', 'pending', 'cancelled', 'completed']).optional(),
  notes: z.string().optional(),
});

const parseMenuPrice = (value) => {
  if (typeof value === 'number') return value;

  const raw = String(value ?? '').trim().replace(/[^\d,.-]/g, '');
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  return Number.parseFloat(normalized);
};

const BUSINESS_TIMEZONE = 'Europe/Andorra';

const formatDateTimeForBusiness = (value) => {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;

  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
};

const mapMenuItem = (row) => ({
  id: row.id,
  name: row.nombre,
  description: row.ingredientes,
  price: parseMenuPrice(row.precio),
  category: row.categoria,
  stock: row.stock,
  available: row.stock > 0,
  vegetariano: row.vegetariano,
  gluten: row.gluten,
  marisco: row.marisco,
  lactosa: row.lactosa,
  vegano: row.vegano,
  ingredientes: row.ingredientes,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const mapOrder = (row) => {
  const displayDateTime = row.scheduled_for || row.created_at;
  const businessDateTime = displayDateTime ? formatDateTimeForBusiness(displayDateTime) : null;
  let correctedTime = businessDateTime?.time || row.time || null;
  let formattedDateTime = businessDateTime ? `${businessDateTime.date} ${correctedTime}` : null;

  if (row.scheduled_for) {
    // La hora de un pedido programado se muestra siempre en el horario del negocio.
    correctedTime = businessDateTime?.time || null;
    formattedDateTime = businessDateTime ? `${businessDateTime.date} ${correctedTime}` : null;
  } else if (row.time) {
    const t = row.time.toString();
    correctedTime = t.length === 4 && t.includes(':') ? '0' + t : t.substring(0, 5);
    const date = businessDateTime?.date || formatDateTimeForBusiness(new Date()).date;
    formattedDateTime = `${date} ${correctedTime}`;
  }

  return {
    id: row.id,
    customer_name: row.nombre,
    customer_phone: row.telefono,
    customer_email: null,
    items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items,
    total: parseFloat(row.total),
    status: row.status,
    fulfillment_type: row.fulfillment_type,
    address: row.direccion,
    notes: null,
    created_at: row.created_at,
    scheduled_for: row.scheduled_for,
    display_date: businessDateTime?.date || null,
    time: correctedTime,
    order_datetime: formattedDateTime,
    updated_at: row.updated_at,
  };
};

const STOCK_LOW_THRESHOLD = 5;

// Avisa de stock bajo solo cuando el stock baja realmente respecto al valor anterior.
const notifyLowStock = (nombre, newStockRaw, prevStockRaw) => {
  const newStock = Number(newStockRaw);
  const prevStock = Number(prevStockRaw);
  if (Number.isNaN(newStock) || newStock >= STOCK_LOW_THRESHOLD) return;
  if (!Number.isNaN(prevStock) && newStock >= prevStock) return; // no bajó
  notifyTelegram(`⚠️ <b>Stock bajo</b>\n${nombre}: ${newStock} ud.`);
};

const mapReservation = (row) => ({
  id: row.id,
  customer_name: row.customer_name,
  customer_phone: row.phone,
  customer_email: null,
  date: row.date instanceof Date ? row.date.toISOString().split('T')[0] : row.date,
  time: row.time ? row.time.toString().substring(0, 5) : row.time,
  guests: row.people,
  table_number: row.table_number,
  status: row.status,
  google_event_id: row.google_event_id,
  notes: row.observations,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "data:"],
    },
  },
}));
app.use(cors());
app.use(express.json());
app.use(morgan(':method :url :status :response-time ms - :res[content-length]'));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Please try again later.' },
});

const agentOrderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many order requests. Please try again shortly.' },
});

// Servir archivos estáticos en producción
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, 'dist');
  app.use(express.static(distPath));
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ============================================
// HEALTH
// ============================================

app.get('/api/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', telegram: telegramEnabled } });
});

// ============================================
// AUTH (rutas públicas)
// ============================================

app.get('/api/auth/status', (req, res) => {
  res.json({
    success: true,
    data: {
      enabled: dashboardUsersConfigured || legacyAuthEnabled,
      migration_required: !dashboardUsersConfigured && legacyAuthEnabled,
    },
  });
});

app.post('/api/login', loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Datos de acceso no válidos' });
  const { email, password } = parsed.data;

  if (!dashboardUsersConfigured) {
    if (!legacyAuthEnabled || !checkLegacyPassword(password)) {
      return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
    }
    const user = { id: null, name: 'Propietario provisional', email: null, role: 'owner', is_active: true, legacy: true };
    setSessionCookie(res, createSession(user, 'legacy'));
    return res.json({ success: true, data: { user } });
  }

  if (!email) return res.status(400).json({ success: false, error: 'Indica tu correo electrónico' });
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, is_active, password_hash, created_at, updated_at
       FROM dashboard_users WHERE lower(email)=lower($1)`,
      [email]
    );
    const user = rows[0];
    if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ success: false, error: 'Correo o contraseña incorrectos' });
    }
    setSessionCookie(res, createSession(user));
    return res.json({ success: true, data: { user: publicUser(user) } });
  } catch (err) {
    console.error('❌ Error al iniciar sesión:', err.message);
    return res.status(500).json({ success: false, error: 'No se pudo iniciar sesión' });
  }
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

// ============================================
// OPENLIVERY AGENT API (clave independiente del dashboard)
// ============================================

function requireAgentOrderKey(req, res, next) {
  if (!AGENT_ORDER_API_KEY) {
    return res.status(503).json({ success: false, error: 'La API de pedidos del agente no está configurada' });
  }
  const key = req.get('x-agent-api-key') || '';
  const expected = Buffer.from(AGENT_ORDER_API_KEY);
  const received = Buffer.from(key);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return res.status(401).json({ success: false, error: 'No autorizado' });
  }
  return next();
}

function agentError(code, message, details, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  error.statusCode = statusCode;
  return error;
}

let dashboardUsersConfigured = false;

const publicUser = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role,
  is_active: row.is_active,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

async function recordAuditEvent(client, req, action, entityType, entityId, metadata = {}) {
  if (!req.user) return;
  await client.query(
    `INSERT INTO audit_events (actor_user_id, actor_role, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [req.user.id, req.user.role, action, entityType, String(entityId), JSON.stringify(metadata)]
  );
}

async function requireAuth(req, res, next) {
  const session = readSession(req);
  // Conserva el comportamiento de desarrollo de versiones anteriores: sin
  // cuentas ni contraseña compartida, el dashboard queda abierto localmente.
  if (!dashboardUsersConfigured && !legacyAuthEnabled) {
    req.user = { id: null, name: 'Acceso local', email: null, role: 'owner', is_active: true };
    return next();
  }
  if (!session) return res.status(401).json({ success: false, error: 'No autorizado' });

  if (!dashboardUsersConfigured && session.kind === 'legacy' && legacyAuthEnabled) {
    req.user = { id: null, name: 'Propietario provisional', email: null, role: 'owner', is_active: true, legacy: true };
    return next();
  }
  if (session.kind !== 'user' || !Number.isInteger(session.sub)) {
    return res.status(401).json({ success: false, error: 'Sesión no válida' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, is_active, created_at, updated_at
       FROM dashboard_users WHERE id=$1`,
      [session.sub]
    );
    const user = rows[0];
    if (!user || !user.is_active || user.role !== session.role) {
      clearSessionCookie(res);
      return res.status(401).json({ success: false, error: 'Sesión no válida' });
    }
    req.user = publicUser(user);
    return next();
  } catch (err) {
    console.error('❌ Error validando sesión:', err.message);
    return res.status(503).json({ success: false, error: 'No se pudo validar la sesión' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'No tienes permiso para esta acción' });
    }
    return next();
  };
}

function requireOrderStatusRole(req, res, next) {
  const status = req.body?.status;
  if (req.user?.role === 'owner') return next();
  if (req.user?.role === 'kitchen' && ['preparing', 'ready'].includes(status)) return next();
  if (req.user?.role === 'driver' && ['out_for_delivery', 'delivered'].includes(status)) return next();
  return res.status(403).json({ success: false, error: 'No tienes permiso para cambiar este estado' });
}

function validateOrderStatusTransition(user, order, nextStatus) {
  if (user?.role === 'owner') return null;
  if (user?.role === 'kitchen') {
    if (order.status === 'pending' && nextStatus === 'preparing') return null;
    if (order.status === 'preparing' && nextStatus === 'ready') return null;
    return 'Cocina solo puede avanzar de Pendiente a Preparando y de Preparando a Listo';
  }
  if (user?.role === 'driver') {
    if (order.fulfillment_type !== 'delivery') return 'Reparto solo gestiona pedidos a domicilio';
    if (order.status === 'ready' && nextStatus === 'out_for_delivery') return null;
    if (order.status === 'out_for_delivery' && nextStatus === 'delivered') return null;
    return 'Reparto solo puede avanzar de Listo a En reparto y de En reparto a Entregado';
  }
  return 'No tienes permiso para cambiar este estado';
}

function phoneNumbersMatch(first, second) {
  const normalize = (value) => String(value || '').replace(/\D/g, '');
  const a = normalize(first);
  const b = normalize(second);
  return a.length >= 6 && b.length >= 6 && (a === b || a.endsWith(b) || b.endsWith(a));
}

async function prepareAgentOrderCancellation(payload, res) {
  const parsed = agentCancelPreparationSchema.safeParse(payload);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Datos de cancelación no válidos',
      details: parsed.error.errors.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }

  const { order_id: orderId, customer_phone: customerPhone } = parsed.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
    const order = current.rows[0];

    // No revelamos si existe un pedido de otro cliente.
    if (!order || !phoneNumbersMatch(order.telefono, customerPhone)) {
      throw agentError('ORDER_NOT_FOUND', 'No encontramos un pedido pendiente con esos datos', undefined, 404);
    }
    if (order.status === 'cancelled') {
      await client.query('COMMIT');
      return res.json({ success: true, data: { order_id: order.id, status: 'cancelled', already_cancelled: true } });
    }
    if (order.status !== 'pending') {
      throw agentError('ORDER_CANNOT_BE_CANCELLED', 'El pedido ya está en preparación o listo; debe revisarlo el restaurante', { status: order.status }, 409);
    }

    const cancellationToken = crypto.randomUUID();
    await client.query('DELETE FROM agent_order_cancellation_confirmations WHERE order_id=$1', [orderId]);
    await client.query(
      `INSERT INTO agent_order_cancellation_confirmations (token, order_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '10 minutes')`,
      [cancellationToken, orderId]
    );
    await client.query('COMMIT');
    return res.json({
      success: true,
      data: {
        order_id: order.id,
        customer_name: order.nombre,
        items: order.items,
        total: Number(order.total),
        cancellation_token: cancellationToken,
        expires_in_minutes: 10,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code && err.statusCode) {
      return res.status(err.statusCode).json({ success: false, error: err.message, code: err.code, details: err.details });
    }
    console.error('❌ Error al preparar cancelación del agente:', err.message);
    return res.status(500).json({ success: false, error: 'No se pudo preparar la cancelación del pedido' });
  } finally {
    client.release();
  }
}

async function confirmAgentOrderCancellation(payload, res) {
  const parsed = agentCancelConfirmationSchema.safeParse(payload);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'Confirmación de cancelación no válida' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: confirmations } = await client.query(
      `SELECT confirmation.token, confirmation.expires_at, orders.*
       FROM agent_order_cancellation_confirmations AS confirmation
       JOIN orders ON orders.id = confirmation.order_id
       WHERE confirmation.token=$1
       FOR UPDATE OF confirmation, orders`,
      [parsed.data.cancellation_token]
    );
    const confirmation = confirmations[0];
    if (!confirmation || new Date(confirmation.expires_at) < new Date()) {
      if (confirmation) await client.query('DELETE FROM agent_order_cancellation_confirmations WHERE token=$1', [parsed.data.cancellation_token]);
      throw agentError('CANCELLATION_CONFIRMATION_EXPIRED', 'La confirmación ha caducado; hay que volver a revisar el pedido', undefined, 409);
    }
    const cancellation = await cancelPendingOrder(client, confirmation, 'agent');
    await client.query('DELETE FROM agent_order_cancellation_confirmations WHERE token=$1', [parsed.data.cancellation_token]);
    await client.query('COMMIT');
    return res.json({
      success: true,
      data: {
        order_id: cancellation.order.id,
        status: 'cancelled',
        stock_restored: cancellation.stockRestored,
        already_cancelled: cancellation.alreadyCancelled,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code && err.statusCode) {
      return res.status(err.statusCode).json({ success: false, error: err.message, code: err.code, details: err.details });
    }
    console.error('❌ Error al confirmar cancelación del agente:', err.message);
    return res.status(500).json({ success: false, error: 'No se pudo confirmar la cancelación del pedido' });
  } finally {
    client.release();
  }
}

app.get('/api/agent/menu', requireAgentOrderKey, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, categoria, precio, stock, ingredientes, vegetariano, gluten, marisco, lactosa, vegano
       FROM menu
       ORDER BY categoria ASC, nombre ASC`
    );
    res.json({ success: true, data: rows.map(mapMenuItem) });
  } catch (err) {
    console.error('❌ Error en GET /api/agent/menu:', err.message);
    res.status(500).json({ success: false, error: 'No se pudo consultar el menú' });
  }
});

app.post('/api/agent/orders', agentOrderLimiter, requireAgentOrderKey, async (req, res) => {
  let payload = req.body;
  if (typeof req.body?.order_json === 'string') {
    try {
      payload = JSON.parse(req.body.order_json);
    } catch {
      return res.status(400).json({ success: false, error: 'order_json debe contener JSON válido' });
    }
  }

  if (payload?.action === 'cancel') {
    return res.status(409).json({
      success: false,
      code: 'CANCELLATION_CONFIRMATION_REQUIRED',
      error: 'Primero hay que preparar la cancelación y recibir una confirmación explícita posterior del cliente',
    });
  }
  if (payload?.action === 'prepare_cancel') {
    return prepareAgentOrderCancellation(payload, res);
  }
  if (payload?.action === 'confirm_cancel') {
    return confirmAgentOrderCancellation(payload, res);
  }

  const parsed = agentOrderSchema.safeParse(payload);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Datos de pedido no válidos',
      details: parsed.error.errors.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }

  const order = parsed.data;
  const client = await pool.connect();
  let committed = false;

  try {
    await client.query('BEGIN');

    // Primero resolvemos cada artículo a su id actual. No se aceptan nombres ambiguos.
    const requestedById = new Map();
    for (const requested of order.items) {
      const result = requested.menu_item_id
        ? await client.query('SELECT id, nombre FROM menu WHERE id = $1', [requested.menu_item_id])
        : await client.query('SELECT id, nombre FROM menu WHERE lower(nombre) = lower($1)', [requested.name]);

      if (result.rows.length === 0) {
        throw agentError('ITEM_NOT_FOUND', 'Uno de los artículos ya no existe en el menú', { item: requested.name || requested.menu_item_id }, 409);
      }
      if (result.rows.length > 1) {
        throw agentError('ITEM_AMBIGUOUS', 'Hay más de un artículo con ese nombre; usa menu_item_id', { item: requested.name }, 409);
      }

      const item = result.rows[0];
      const previous = requestedById.get(item.id);
      requestedById.set(item.id, { id: item.id, name: item.nombre, quantity: (previous?.quantity || 0) + requested.quantity });
    }

    // Bloqueo en orden estable: evita sobreventa y reduce el riesgo de interbloqueos.
    const itemIds = [...requestedById.keys()].sort((a, b) => a - b);
    const { rows: lockedItems } = await client.query(
      `SELECT id, nombre, precio, stock
       FROM menu
       WHERE id = ANY($1::int[])
       ORDER BY id
       FOR UPDATE`,
      [itemIds]
    );

    if (lockedItems.length !== itemIds.length) {
      throw agentError('ITEM_NOT_FOUND', 'Uno de los artículos ya no existe en el menú', undefined, 409);
    }

    const lines = lockedItems.map((item) => {
      const requested = requestedById.get(item.id);
      if (Number(item.stock) < requested.quantity) {
        throw agentError('INSUFFICIENT_STOCK', 'No hay stock suficiente para uno o más artículos', {
          item: item.nombre,
          available: Number(item.stock),
          requested: requested.quantity,
        }, 409);
      }
      const price = parseMenuPrice(item.precio);
      if (!Number.isFinite(price)) {
        throw agentError('INVALID_MENU_PRICE', 'Un artículo del menú tiene un precio inválido', { item: item.nombre }, 500);
      }
      return {
        id: item.id,
        name: item.nombre,
        price,
        quantity: requested.quantity,
        line_total: Math.round(price * requested.quantity * 100) / 100,
      };
    });

    const total = Math.round(lines.reduce((sum, line) => sum + line.line_total, 0) * 100) / 100;
    const scheduledFor = order.scheduled_for ? new Date(order.scheduled_for) : null;
    const { rows: createdOrders } = await client.query(
      `INSERT INTO orders (
        nombre, telefono, direccion, items, total, status, time,
        source, fulfillment_type, scheduled_for, observations, stock_reserved_at
      ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, 'openlivery', $7, $8, $9, NOW())
      RETURNING *`,
      [
        order.customer_name,
        order.customer_phone || null,
        order.fulfillment === 'delivery' ? order.address : 'Recogida',
        JSON.stringify(lines),
        total,
        scheduledFor ? formatDateTimeForBusiness(scheduledFor).time : null,
        order.fulfillment,
        scheduledFor,
        order.observations || null,
      ]
    );

    const remainingStock = [];
    for (const line of lines) {
      const { rows } = await client.query(
        `UPDATE menu
         SET stock = stock - $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, nombre, stock`,
        [line.quantity, line.id]
      );
      remainingStock.push({ id: rows[0].id, name: rows[0].nombre, stock: Number(rows[0].stock) });
    }

    await client.query('COMMIT');
    committed = true;

    for (const stock of remainingStock) {
      const previous = lockedItems.find((item) => item.id === stock.id)?.stock;
      notifyLowStock(stock.name, stock.stock, previous);
    }
    notifyTelegram(`🧾 <b>Nuevo pedido OpenLivery</b>\n${order.customer_name}\n${lines.length} artículo(s) · ${total.toFixed(2)}€`);

    return res.status(201).json({
      success: true,
      data: {
        order_id: createdOrders[0].id,
        status: 'pending',
        total,
        items: lines,
        remaining_stock: remainingStock,
      },
    });
  } catch (err) {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    if (err.code && err.statusCode) {
      return res.status(err.statusCode).json({ success: false, error: err.message, code: err.code, details: err.details });
    }
    console.error('❌ Error en POST /api/agent/orders:', err.message);
    return res.status(500).json({ success: false, error: 'No se pudo registrar el pedido' });
  } finally {
    client.release();
  }
});

// A partir de aquí, todas las rutas /api requieren autenticación
app.use('/api', requireAuth);

app.get('/api/auth/me', (req, res) => {
  res.json({ success: true, data: { user: req.user } });
});

app.get('/api/users', requireRole('owner'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, is_active, created_at, updated_at
       FROM dashboard_users ORDER BY created_at ASC`
    );
    res.json({ success: true, data: rows.map(publicUser) });
  } catch (err) {
    console.error('❌ Error listando usuarios:', err.message);
    res.status(500).json({ success: false, error: 'No se pudieron cargar los usuarios' });
  }
});

app.post('/api/users', requireRole('owner'), async (req, res) => {
  const parsed = dashboardUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: passwordPolicy });
  const user = parsed.data;
  if (!dashboardUsersConfigured && user.role !== 'owner') {
    return res.status(409).json({ success: false, error: 'La primera cuenta debe ser un propietario' });
  }
  try {
    const passwordHash = await hashPassword(user.password);
    const { rows } = await pool.query(
      `INSERT INTO dashboard_users (name, email, role, password_hash)
       VALUES ($1, lower($2), $3, $4)
       RETURNING id, name, email, role, is_active, created_at, updated_at`,
      [user.name, user.email, user.role, passwordHash]
    );
    dashboardUsersConfigured = true;
    res.status(201).json({ success: true, data: publicUser(rows[0]) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, error: 'Ya existe un usuario con ese correo' });
    console.error('❌ Error creando usuario:', err.message);
    res.status(500).json({ success: false, error: 'No se pudo crear el usuario' });
  }
});

app.patch('/api/users/:id', requireRole('owner'), async (req, res) => {
  const parsed = dashboardUserUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: passwordPolicy });
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId < 1) return res.status(400).json({ success: false, error: 'Usuario no válido' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serializa cambios de rol/activación para que nunca puedan desactivarse
    // dos propietarios a la vez y dejar el dashboard sin administrador.
    await client.query('LOCK TABLE dashboard_users IN SHARE ROW EXCLUSIVE MODE');
    const { rows: currentRows } = await client.query('SELECT * FROM dashboard_users WHERE id=$1 FOR UPDATE', [userId]);
    const current = currentRows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }
    const changes = parsed.data;
    const nextRole = changes.role || current.role;
    const nextActive = changes.is_active ?? current.is_active;
    if (current.role === 'owner' && current.is_active && (nextRole !== 'owner' || !nextActive)) {
      const { rows: countRows } = await client.query(
        `SELECT count(*)::int AS count FROM dashboard_users
         WHERE role='owner' AND is_active=true AND id <> $1`,
        [userId]
      );
      if (countRows[0].count === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, error: 'Debe permanecer al menos un propietario activo' });
      }
    }
    const passwordHash = changes.password ? await hashPassword(changes.password) : current.password_hash;
    const { rows } = await client.query(
      `UPDATE dashboard_users
       SET name=$1, role=$2, is_active=$3, password_hash=$4, updated_at=NOW()
       WHERE id=$5
       RETURNING id, name, email, role, is_active, created_at, updated_at`,
      [changes.name || current.name, nextRole, nextActive, passwordHash, userId]
    );
    await client.query('COMMIT');
    res.json({ success: true, data: publicUser(rows[0]) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Error actualizando usuario:', err.message);
    res.status(500).json({ success: false, error: 'No se pudo actualizar el usuario' });
  } finally {
    client.release();
  }
});

app.get('/api/db-health', requireRole('owner'), async (req, res) => {
  try {
    const result = await pool.query('SELECT 1');
    res.json({ success: true, data: { status: 'ok', db_connected: true } });
  } catch (err) {
    res.status(500).json({ success: false, data: { status: 'error', db_connected: false, error: err.message } });
  }
});

// ============================================
// MENU
// ============================================

app.get('/api/menu', requireRole('owner'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM menu ORDER BY id ASC');
    res.json({ success: true, data: rows.map(mapMenuItem) });
  } catch (err) {
    console.error('❌ Error en GET /api/menu:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/menu', requireRole('owner'), async (req, res) => {
  try {
    const v = menuSchema.safeParse(req.body);
    if (!v.success) return res.status(400).json({ success: false, error: v.error.errors.map(e => e.message).join(', ') });

    const { name, price, category, stock, description, vegetariano, gluten, marisco, lactosa, vegano } = v.data;
    const { rows } = await pool.query(
      `INSERT INTO menu (nombre, categoria, precio, stock, ingredientes, vegetariano, gluten, marisco, lactosa, vegano)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [name, category, price, stock, description, vegetariano || 'no', gluten || 'no', marisco || 'no', lactosa || 'no', vegano || 'no']
    );
    res.json({ success: true, data: mapMenuItem(rows[0]) });
  } catch (err) {
    console.error('❌ Error en POST /api/menu:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/menu/:id', requireRole('owner'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, ingredientes, price, category, stock, vegetariano, gluten, marisco, lactosa, vegano } = req.body;
    const prev = await pool.query('SELECT stock FROM menu WHERE id=$1', [id]);
    const { rows } = await pool.query(
      `UPDATE menu SET nombre=$1, categoria=$2, precio=$3, stock=$4, ingredientes=$5,
       vegetariano=$6, gluten=$7, marisco=$8, lactosa=$9, vegano=$10, updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [name, category, price, stock, description || ingredientes, vegetariano || 'no', gluten || 'no', marisco || 'no', lactosa || 'no', vegano || 'no', id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: mapMenuItem(rows[0]) });
    notifyLowStock(rows[0].nombre, stock, prev.rows[0]?.stock);
  } catch (err) {
    console.error('❌ Error en PUT /api/menu/:id:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/menu/:id', requireRole('owner'), async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM menu WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error en DELETE /api/menu/:id:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/menu/:id/stock', requireRole('owner'), async (req, res) => {
  try {
    const { id } = req.params;
    const { stock } = req.body;
    const prev = await pool.query('SELECT stock FROM menu WHERE id=$1', [id]);
    const { rows } = await pool.query(
      'UPDATE menu SET stock=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [stock, id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: rows[0] });
    notifyLowStock(rows[0].nombre, stock, prev.rows[0]?.stock);
  } catch (err) {
    console.error('❌ Error en PATCH /api/menu/:id/stock:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// ORDERS
// ============================================

app.get('/api/orders', requireRole('owner', 'kitchen', 'driver'), async (req, res) => {
  try {
    const { filter } = req.query;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    let queryText = 'SELECT * FROM orders';
    const params = [];

    if (filter === 'today') {
      queryText += ' WHERE created_at >= $1';
      params.push(today);
    } else if (filter === 'month') {
      queryText += ' WHERE created_at >= $1';
      params.push(monthStart);
    } else if (filter === 'active') {
      queryText += " WHERE status NOT IN ('delivered', 'cancelled')";
    }

    // Los pedidos programados se ordenan por su fecha/hora de entrega; los
    // demás, por cuándo se crearon. La hora y el id desempatan registros antiguos.
    queryText += ' ORDER BY COALESCE(scheduled_for, created_at) DESC, time DESC NULLS LAST, id DESC';
    const { rows } = await pool.query(queryText, params);
    res.json({ success: true, data: rows.map(mapOrder) });
  } catch (err) {
    console.error('❌ Error en GET /api/orders:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/orders', requireRole('owner'), async (req, res) => {
  const client = await pool.connect();
  try {
    const v = orderSchema.safeParse(req.body);
    if (!v.success) return res.status(400).json({ success: false, error: v.error.errors.map(e => e.message).join(', ') });

    const {
      customer_name,
      customer_phone,
      items,
      fulfillment_type = 'delivery',
    } = v.data;
    await client.query('BEGIN');
    const itemIds = [...new Set(items.map((item) => item.id))].sort((a, b) => a - b);
    const { rows: menuItems } = await client.query(
      `SELECT id, nombre, precio, stock
       FROM menu
       WHERE id = ANY($1::int[])
       ORDER BY id
       FOR UPDATE`,
      [itemIds]
    );
    if (menuItems.length !== itemIds.length) {
      throw agentError('ITEM_NOT_FOUND', 'Uno de los artículos ya no existe en el menú', undefined, 409);
    }

    const requestedById = new Map();
    for (const item of items) {
      const previous = requestedById.get(item.id);
      requestedById.set(item.id, (previous || 0) + item.quantity);
    }
    const lines = menuItems.map((item) => {
      const quantity = requestedById.get(item.id);
      if (Number(item.stock) < quantity) {
        throw agentError('INSUFFICIENT_STOCK', `No hay stock suficiente para ${item.nombre}`, undefined, 409);
      }
      const price = parseMenuPrice(item.precio);
      if (!Number.isFinite(price)) {
        throw agentError('INVALID_MENU_PRICE', `El precio de ${item.nombre} no es válido`, undefined, 500);
      }
      return { id: item.id, name: item.nombre, price, quantity };
    });
    const calculatedTotal = Math.round(lines.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100;
    for (const line of lines) {
      await client.query(
        'UPDATE menu SET stock = stock - $1, updated_at=NOW() WHERE id=$2',
        [line.quantity, line.id]
      );
    }

    const { rows } = await client.query(
      `INSERT INTO orders (
        nombre, telefono, direccion, items, total, status, fulfillment_type,
        source, stock_reserved_at
      ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, 'dashboard', NOW()) RETURNING *`,
      [
        customer_name,
        customer_phone,
        fulfillment_type === 'pickup' ? 'Recogida' : 'Dirección no especificada',
        JSON.stringify(lines),
        calculatedTotal,
        fulfillment_type,
      ]
    );
    await recordAuditEvent(client, req, 'order.created', 'order', rows[0].id, { source: 'dashboard' });
    await client.query('COMMIT');
    res.json({ success: true, data: mapOrder(rows[0]) });
    notifyTelegram(`🧾 <b>Nuevo pedido</b>\n${customer_name}\n${lines.length} artículo(s) · ${calculatedTotal.toFixed(2)}€`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code && err.statusCode) {
      return res.status(err.statusCode).json({ success: false, error: err.message, code: err.code, details: err.details });
    }
    console.error('❌ Error en POST /api/orders:', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

app.patch('/api/orders/:id/status', requireOrderStatusRole, async (req, res) => {
  const parsedStatus = orderStatusSchema.safeParse(req.body?.status);
  if (!parsedStatus.success) {
    return res.status(400).json({ success: false, error: 'Estado de pedido no válido' });
  }

  const client = await pool.connect();
  try {
    const { id } = req.params;
    const status = parsedStatus.data;
    await client.query('BEGIN');
    const current = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id]);
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const previous = current.rows[0];
    const transitionError = validateOrderStatusTransition(req.user, previous, status);
    if (transitionError) throw agentError('ORDER_INVALID_TRANSITION', transitionError, undefined, 403);
    let result;
    if (status === 'cancelled') {
      const cancelledBy = req.user?.id ? `dashboard:${req.user.id}` : 'dashboard:legacy';
      const cancellation = await cancelPendingOrder(client, previous, cancelledBy);
      await recordAuditEvent(client, req, 'order.cancelled', 'order', cancellation.order.id, { stock_restored: cancellation.stockRestored });
      await client.query('COMMIT');
      return res.json({
        success: true,
        data: { ...mapOrder(cancellation.order), stock_restored: cancellation.stockRestored, already_cancelled: cancellation.alreadyCancelled },
      });
    }
    if (previous.status === 'cancelled') {
      throw agentError('ORDER_ALREADY_CANCELLED', 'Un pedido cancelado no puede cambiar de estado', { status: previous.status }, 409);
    }
    if (status === 'pending' && previous.status !== 'pending') {
      throw agentError('ORDER_CANNOT_REOPEN', 'Un pedido que ya está en marcha no puede volver a pendiente', { status: previous.status }, 409);
    }

    const isPickup = previous.fulfillment_type === 'pickup' ||
      (!previous.fulfillment_type && String(previous.direccion || '').trim().toLowerCase() === 'recogida');

    if (status === 'ready' && isPickup && previous.status !== 'ready' && !previous.delivery_notification_sent_at) {
      result = await client.query(
        `UPDATE orders
         SET status=$1,
             updated_at=NOW(),
             delivery_notification_due_at=NOW() + INTERVAL '1 minute',
             delivery_notification_claimed_at=NULL
         WHERE id=$2
         RETURNING *`,
        [status, id]
      );
    } else if (status !== 'ready' && !previous.delivery_notification_sent_at) {
      result = await client.query(
        `UPDATE orders
         SET status=$1,
             updated_at=NOW(),
             delivery_notification_due_at=NULL,
             delivery_notification_claimed_at=NULL
         WHERE id=$2
         RETURNING *`,
        [status, id]
      );
    } else {
      result = await client.query(
        'UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
        [status, id]
      );
    }

    await recordAuditEvent(client, req, 'order.status_changed', 'order', id, { from: previous.status, to: status });
    await client.query('COMMIT');
    const { rows } = result;
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Order not found' });
    res.json({ success: true, data: mapOrder(rows[0]) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code && err.statusCode) {
      return res.status(err.statusCode).json({ success: false, error: err.message, code: err.code, details: err.details });
    }
    console.error('❌ Error en PATCH /api/orders/:id/status:', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ============================================
// RESERVATIONS
// ============================================

app.get('/api/reservations', requireRole('owner'), async (req, res) => {
  try {
    const { filter } = req.query;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

    let queryText = 'SELECT * FROM reservations';
    const params = [];

    if (filter === 'today') {
      queryText += ' WHERE date = $1';
      params.push(today);
    } else if (filter === 'month') {
      queryText += ' WHERE date >= $1';
      params.push(monthStart);
    }

    queryText += ' ORDER BY date DESC, time DESC';
    const { rows } = await pool.query(queryText, params);
    res.json({ success: true, data: rows.map(r => mapReservation(r)) });
  } catch (err) {
    console.error('❌ Error en GET /api/reservations:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/reservations', requireRole('owner'), async (req, res) => {
  try {
    const v = reservationSchema.safeParse(req.body);
    if (!v.success) return res.status(400).json({ success: false, error: v.error.errors.map(e => e.message).join(', ') });

    const { customer_name, customer_phone, date, time, guests, status = 'confirmed', notes } = v.data;
    const { rows } = await pool.query(
      `INSERT INTO reservations (customer_name, phone, date, time, people, table_number, status, observations)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [customer_name, customer_phone || null, date, time, guests, null, status, notes]
    );
    res.json({ success: true, data: mapReservation(rows[0]) });
    notifyTelegram(`🗓️ <b>Nueva reserva</b>\n${customer_name} · ${guests} pers.\n${date} ${time}${notes ? `\n📝 ${notes}` : ''}`);
  } catch (err) {
    console.error('❌ Error en POST /api/reservations:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/reservations/:id/status', requireRole('owner'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const { rows } = await pool.query(
      'UPDATE reservations SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [status, id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Reservation not found' });
    res.json({ success: true, data: mapReservation(rows[0]) });
  } catch (err) {
    console.error('❌ Error en PATCH /api/reservations/:id/status:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/reservations/:id', requireRole('owner'), async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM reservations WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error en DELETE /api/reservations/:id:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// SERVER START
// ============================================

async function ensureAgentOrderColumns() {
  await pool.query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS source VARCHAR(50),
      ADD COLUMN IF NOT EXISTS fulfillment_type VARCHAR(20),
      ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS observations TEXT,
      ADD COLUMN IF NOT EXISTS stock_reserved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS stock_restored_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(50),
      ADD COLUMN IF NOT EXISTS delivery_notification_due_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS delivery_notification_claimed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS delivery_notification_sent_at TIMESTAMPTZ
  `);
  // Los pedidos antiguos de OpenLivery ya guardaban "Recogida" o una dirección.
  // Lo ambiguo se considera domicilio para no enviar por error un aviso de recogida.
  await pool.query(`
    UPDATE orders
    SET fulfillment_type = CASE
      WHEN lower(trim(COALESCE(direccion, ''))) = 'recogida' THEN 'pickup'
      ELSE 'delivery'
    END
    WHERE fulfillment_type IS NULL
       OR fulfillment_type NOT IN ('pickup', 'delivery')
  `);
  await pool.query(`
    UPDATE orders
    SET stock_reserved_at = created_at
    WHERE stock_reserved_at IS NULL
      AND source = 'openlivery'
  `);
  await pool.query(`
    UPDATE orders
    SET delivery_notification_due_at = NULL,
        delivery_notification_claimed_at = NULL
    WHERE fulfillment_type = 'delivery'
      AND delivery_notification_sent_at IS NULL
      AND (delivery_notification_due_at IS NOT NULL OR delivery_notification_claimed_at IS NOT NULL)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_order_cancellation_confirmations (
      token UUID PRIMARY KEY,
      order_id INTEGER NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function ensureDashboardUserSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'kitchen', 'driver')),
      password_hash TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS dashboard_users_email_lower_idx ON dashboard_users (lower(email))');
  const { rows } = await pool.query('SELECT EXISTS(SELECT 1 FROM dashboard_users) AS configured');
  dashboardUsersConfigured = rows[0].configured;
}

async function ensureAuditSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id BIGSERIAL PRIMARY KEY,
      actor_user_id INTEGER REFERENCES dashboard_users(id) ON DELETE SET NULL,
      actor_role VARCHAR(20),
      action VARCHAR(100) NOT NULL,
      entity_type VARCHAR(50) NOT NULL,
      entity_id VARCHAR(100) NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS audit_events_entity_idx ON audit_events (entity_type, entity_id, created_at DESC)');
}

async function startServer() {
  try {
    await ensureAgentOrderColumns();
    await ensureDashboardUserSchema();
    await ensureAuditSchema();
    app.listen(port, () => {
      console.log(`✅ API server running on http://localhost:${port}`);
      console.log('📊 Database: Neon PostgreSQL');
    });
  } catch (err) {
    console.error('❌ Error preparando el esquema de pedidos del agente:', err.message);
    process.exit(1);
  }
}

startServer();

process.on('SIGINT', () => { console.log('\n👋 Shutting down...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\n👋 Shutting down...'); process.exit(0); });
