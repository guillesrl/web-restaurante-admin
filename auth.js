import crypto from 'crypto';

const LEGACY_DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const SECRET = process.env.DASHBOARD_AUTH_SECRET || process.env.JWT_SECRET || LEGACY_DASHBOARD_PASSWORD || 'development-only-secret';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const SESSION_COOKIE = 'dashboard_session';

const b64url = (value) => Buffer.from(value).toString('base64url');

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

export const legacyAuthEnabled = Boolean(LEGACY_DASHBOARD_PASSWORD);
export const passwordPolicy = 'La contraseña debe tener al menos 12 caracteres.';

export function checkLegacyPassword(password) {
  if (!legacyAuthEnabled || typeof password !== 'string') return false;
  const received = Buffer.from(password);
  const expected = Buffer.from(LEGACY_DASHBOARD_PASSWORD);
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => error ? reject(error) : resolve(key));
  });
  return `scrypt$16384$8$1$${salt}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [algorithm, n, r, p, salt, encodedKey] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !encodedKey) return false;
  const expected = Buffer.from(encodedKey, 'base64url');
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p) }, (error, key) => error ? reject(error) : resolve(key));
  });
  const actual = Buffer.from(derived);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function createSession(user, kind = 'user') {
  const payload = b64url(JSON.stringify({
    sub: user.id,
    role: user.role,
    kind,
    exp: Date.now() + SESSION_TTL_SECONDS * 1000,
  }));
  return `${payload}.${sign(payload)}`;
}

export function readSession(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = sign(payload);
  const received = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (received.length !== expectedBuffer.length || !crypto.timingSafeEqual(received, expectedBuffer)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof session.exp === 'number' && Date.now() < session.exp ? session : null;
  } catch {
    return null;
  }
}

export function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}

export function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}
