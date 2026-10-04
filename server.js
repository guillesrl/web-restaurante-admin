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
import { authEnabled, createToken, checkPassword, requireAuth } from './auth.js';
import { notifyTelegram, telegramEnabled } from './notify.js';

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
    id: z.number(),
    name: z.string(),
    price: z.number(),
    quantity: z.number().int().min(1),
  })).min(1),
  total: z.number().positive(),
  fulfillment_type: z.enum(['pickup', 'delivery']).optional(),
  status: z.enum(['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled']).optional(),
});

const orderStatusSchema = z.enum(['pending', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled']);

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
  res.json({ success: true, data: { enabled: authEnabled } });
});

app.post('/api/login', loginLimiter, (req, res) => {
  if (!authEnabled) return res.json({ success: true, data: { token: null, enabled: false } });
  const { password } = req.body || {};
  if (!checkPassword(password)) {
    return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
  }
  res.json({ success: true, data: { token: createToken() } });
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
    if (confirmation.status !== 'pending') {
      throw agentError('ORDER_CANNOT_BE_CANCELLED', 'El pedido ya no está pendiente; debe revisarlo el restaurante', { status: confirmation.status }, 409);
    }

    const items = Array.isArray(confirmation.items) ? confirmation.items : [];
    for (const item of items) {
      const itemId = Number(item?.id);
      const quantity = Number(item?.quantity);
      if (Number.isInteger(itemId) && Number.isInteger(quantity) && quantity > 0) {
        await client.query('UPDATE menu SET stock = stock + $1, updated_at=NOW() WHERE id=$2', [quantity, itemId]);
      }
    }

    const { rows } = await client.query(
      `UPDATE orders
       SET status='cancelled', updated_at=NOW(),
           delivery_notification_due_at=NULL, delivery_notification_claimed_at=NULL
       WHERE id=$1
       RETURNING *`,
      [confirmation.id]
    );
    await client.query('DELETE FROM agent_order_cancellation_confirmations WHERE token=$1', [parsed.data.cancellation_token]);
    await client.query('COMMIT');
    return res.json({ success: true, data: { order_id: rows[0].id, status: 'cancelled', stock_restored: true } });
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
        source, fulfillment_type, scheduled_for, observations
      ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, 'openlivery', $7, $8, $9)
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

app.get('/api/db-health', async (req, res) => {
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

app.get('/api/menu', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM menu ORDER BY id ASC');
    res.json({ success: true, data: rows.map(mapMenuItem) });
  } catch (err) {
    console.error('❌ Error en GET /api/menu:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/menu', async (req, res) => {
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

app.put('/api/menu/:id', async (req, res) => {
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

app.delete('/api/menu/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM menu WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error en DELETE /api/menu/:id:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/menu/:id/stock', async (req, res) => {
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

app.get('/api/orders', async (req, res) => {
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

app.post('/api/orders', async (req, res) => {
  try {
    const v = orderSchema.safeParse(req.body);
    if (!v.success) return res.status(400).json({ success: false, error: v.error.errors.map(e => e.message).join(', ') });

    const {
      customer_name,
      customer_phone,
      items,
      total,
      fulfillment_type = 'delivery',
      status = 'pending',
    } = v.data;
    const { rows } = await pool.query(
      `INSERT INTO orders (nombre, telefono, direccion, items, total, status, fulfillment_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        customer_name,
        customer_phone,
        fulfillment_type === 'pickup' ? 'Recogida' : 'Dirección no especificada',
        JSON.stringify(items),
        total,
        status,
        fulfillment_type,
      ]
    );
    res.json({ success: true, data: mapOrder(rows[0]) });
    notifyTelegram(`🧾 <b>Nuevo pedido</b>\n${customer_name}\n${items.length} artículo(s) · ${total.toFixed(2)}€`);
  } catch (err) {
    console.error('❌ Error en POST /api/orders:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/orders/:id/status', async (req, res) => {
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
    let result;
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

    await client.query('COMMIT');
    const { rows } = result;
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Order not found' });
    res.json({ success: true, data: mapOrder(rows[0]) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Error en PATCH /api/orders/:id/status:', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ============================================
// RESERVATIONS
// ============================================

app.get('/api/reservations', async (req, res) => {
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

app.post('/api/reservations', async (req, res) => {
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

app.patch('/api/reservations/:id/status', async (req, res) => {
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

app.delete('/api/reservations/:id', async (req, res) => {
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

async function startServer() {
  try {
    await ensureAgentOrderColumns();
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
