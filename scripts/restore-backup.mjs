import crypto from 'crypto';
import { gunzipSync } from 'zlib';
import pg from 'pg';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BACKUP_TABLES, decryptBackupPayload } from '../backupService.js';

const [objectKey] = process.argv.slice(2);
const confirmation = 'RESTORE_TO_ISOLATED_DATABASE';

if (!objectKey) {
  console.error('Uso: node scripts/restore-backup.mjs <object-key>');
  process.exit(1);
}
if (process.env.RESTORE_CONFIRM !== confirmation) {
  console.error(`Define RESTORE_CONFIRM=${confirmation} para habilitar una restauración.`);
  process.exit(1);
}
if (!process.env.RESTORE_DATABASE_URL || process.env.NODE_ENV === 'production') {
  console.error('La restauración exige RESTORE_DATABASE_URL y no se permite con NODE_ENV=production. Usa una rama aislada de Neon.');
  process.exit(1);
}

const required = ['AWS_ENDPOINT_URL_S3', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'BACKUP_BUCKET', 'BACKUP_ENCRYPTION_KEY'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Faltan variables requeridas: ${missing.join(', ')}`);
  process.exit(1);
}

const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
const s3 = new S3Client({
  endpoint: process.env.AWS_ENDPOINT_URL_S3,
  region: process.env.AWS_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
});

const object = await s3.send(new GetObjectCommand({ Bucket: process.env.BACKUP_BUCKET, Key: objectKey }));
const encrypted = Buffer.from(await object.Body.transformToByteArray());
const checksum = crypto.createHash('sha256').update(encrypted).digest('hex');
const payload = JSON.parse(gunzipSync(decryptBackupPayload(encrypted, process.env.BACKUP_ENCRYPTION_KEY)).toString('utf8'));

if (payload.format !== 'restaurant-dashboard-backup/v1') {
  throw new Error('El archivo no tiene un formato de copia compatible');
}

const client = new pg.Client({ connectionString: process.env.RESTORE_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query(`TRUNCATE TABLE ${BACKUP_TABLES.map(quoteIdentifier).join(', ')} RESTART IDENTITY CASCADE`);
  for (const table of BACKUP_TABLES) {
    const rows = payload.tables?.[table] || [];
    for (const row of rows) {
      const columns = Object.keys(row);
      if (!columns.length) continue;
      const values = columns.map((_, index) => `$${index + 1}`);
      await client.query(
        `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${values.join(', ')})`,
        columns.map((column) => row[column])
      );
    }

    const { rows: sequenceRows } = await client.query(
      'SELECT pg_get_serial_sequence($1, $2) AS sequence_name',
      [table, 'id']
    );
    const sequenceName = sequenceRows[0]?.sequence_name;
    if (sequenceName) {
      const { rows: maxRows } = await client.query(`SELECT COALESCE(MAX(id), 0) AS max_id FROM ${quoteIdentifier(table)}`);
      const maxId = Number(maxRows[0].max_id);
      await client.query('SELECT setval($1::regclass, $2, $3)', [sequenceName, maxId || 1, maxId > 0]);
    }
  }
  await client.query('COMMIT');
  console.log(`Restauración completada en base aislada. SHA-256: ${checksum}`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await client.end();
}
