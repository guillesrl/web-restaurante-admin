import { describe, expect, it } from 'vitest';
import { decryptBackupPayload, encryptBackupPayload } from '../backupService.js';

describe('backup encryption', () => {
  it('encrypts and decrypts a backup payload', () => {
    const payload = Buffer.from(JSON.stringify({ table: [{ id: 1, name: 'Pedido' }] }));
    const encrypted = encryptBackupPayload(payload, 'a-long-backup-key-for-the-test');

    expect(encrypted.equals(payload)).toBe(false);
    expect(decryptBackupPayload(encrypted, 'a-long-backup-key-for-the-test')).toEqual(payload);
  });

  it('rejects a different encryption key', () => {
    const encrypted = encryptBackupPayload(Buffer.from('private backup'), 'correct-key');

    expect(() => decryptBackupPayload(encrypted, 'incorrect-key')).toThrow();
  });
});
