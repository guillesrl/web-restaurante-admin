import crypto from 'crypto';
import { gzipSync } from 'zlib';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export const BACKUP_TABLES = [
  'menu',
  'orders',
  'reservations',
  'dashboard_users',
  'audit_events',
  'agent_order_cancellation_confirmations',
];

let backupInProgress = false;

const requiredConfig = [
  'AWS_ENDPOINT_URL_S3',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'BACKUP_BUCKET',
  'BACKUP_ENCRYPTION_KEY',
];

const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;

export function backupConfiguration() {
  const missing = requiredConfig.filter((name) => !process.env[name]);
  return { enabled: missing.length === 0, missing };
}

export function encryptBackupPayload(payload, encryptionKey) {
  const key = crypto.createHash('sha256').update(encryptionKey).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

export function decryptBackupPayload(payload, encryptionKey) {
  const key = crypto.createHash('sha256').update(encryptionKey).digest();
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function collectBackupData(pool) {
  const tables = {};
  for (const table of BACKUP_TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${quoteIdentifier(table)} ORDER BY 1 ASC`);
    tables[table] = rows;
  }
  return {
    format: 'restaurant-dashboard-backup/v1',
    created_at: new Date().toISOString(),
    tables,
  };
}

function createS3Client() {
  return new S3Client({
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    region: process.env.AWS_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

export async function ensureBackupSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS backup_runs (
      id BIGSERIAL PRIMARY KEY,
      source VARCHAR(20) NOT NULL CHECK (source IN ('automatic', 'manual')),
      status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
      object_key TEXT,
      checksum_sha256 VARCHAR(64),
      size_bytes BIGINT,
      error_message TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS backup_runs_started_idx ON backup_runs (started_at DESC)');
}

export async function listBackupRuns(pool, limit = 20) {
  const { rows } = await pool.query(
    `SELECT id, source, status, object_key, checksum_sha256, size_bytes, error_message, started_at, completed_at
     FROM backup_runs ORDER BY started_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function createBackup(pool, source = 'automatic') {
  const configuration = backupConfiguration();
  if (!configuration.enabled) {
    const error = new Error('La copia de seguridad no está configurada');
    error.code = 'BACKUP_NOT_CONFIGURED';
    error.missing = configuration.missing;
    throw error;
  }
  if (backupInProgress) {
    const error = new Error('Ya hay una copia de seguridad en curso');
    error.code = 'BACKUP_IN_PROGRESS';
    throw error;
  }

  backupInProgress = true;
  let runId;
  try {
    const { rows } = await pool.query(
      `INSERT INTO backup_runs (source, status) VALUES ($1, 'running') RETURNING id`,
      [source]
    );
    runId = rows[0].id;
    const document = await collectBackupData(pool);
    const compressed = gzipSync(Buffer.from(JSON.stringify(document)));
    const encrypted = encryptBackupPayload(compressed, process.env.BACKUP_ENCRYPTION_KEY);
    const checksum = crypto.createHash('sha256').update(encrypted).digest('hex');
    const timestamp = document.created_at.replace(/[:.]/g, '-');
    const objectKey = `restaurant-dashboard/${timestamp}-${runId}.json.gz.enc`;

    await createS3Client().send(new PutObjectCommand({
      Bucket: process.env.BACKUP_BUCKET,
      Key: objectKey,
      Body: encrypted,
      ContentType: 'application/octet-stream',
      Metadata: {
        format: 'restaurant-dashboard-backup-v1',
        compression: 'gzip',
        encryption: 'aes-256-gcm',
        checksum_sha256: checksum,
      },
    }));

    await pool.query(
      `UPDATE backup_runs
       SET status='completed', object_key=$1, checksum_sha256=$2, size_bytes=$3, completed_at=NOW()
       WHERE id=$4`,
      [objectKey, checksum, encrypted.length, runId]
    );
    return { id: runId, object_key: objectKey, checksum_sha256: checksum, size_bytes: encrypted.length };
  } catch (err) {
    if (runId) {
      await pool.query(
        `UPDATE backup_runs SET status='failed', error_message=$1, completed_at=NOW() WHERE id=$2`,
        ['No se pudo completar la copia de seguridad', runId]
      ).catch(() => {});
    }
    throw err;
  } finally {
    backupInProgress = false;
  }
}

export function startBackupScheduler(pool) {
  const configuration = backupConfiguration();
  if (!configuration.enabled) {
    console.log(`ℹ️ Copias de seguridad externas desactivadas: faltan ${configuration.missing.join(', ')}`);
    return;
  }

  const intervalHours = Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS || 24));
  const runIfDue = async () => {
    try {
      const { rows } = await pool.query(
        `SELECT completed_at FROM backup_runs WHERE status='completed' ORDER BY completed_at DESC LIMIT 1`
      );
      const latest = rows[0]?.completed_at ? new Date(rows[0].completed_at).getTime() : 0;
      if (!latest || Date.now() - latest >= intervalHours * 60 * 60 * 1000) {
        await createBackup(pool, 'automatic');
        console.log('✅ Copia de seguridad automática completada');
      }
    } catch (err) {
      console.error('❌ Error en copia de seguridad automática:', err.code || err.message);
    }
  };

  void runIfDue();
  setInterval(() => { void runIfDue(); }, 60 * 60 * 1000).unref();
}
