import { describe, expect, it } from 'vitest';
import { createSession, hashPassword, readSession, verifyPassword } from '../auth.js';

describe('dashboard authentication helpers', () => {
  it('hashes passwords with a unique salt and verifies them', async () => {
    const first = await hashPassword('una-contraseña-segura');
    const second = await hashPassword('una-contraseña-segura');
    expect(first).not.toBe(second);
    await expect(verifyPassword('una-contraseña-segura', first)).resolves.toBe(true);
    await expect(verifyPassword('otra-contraseña-segura', first)).resolves.toBe(false);
  });

  it('creates a signed, expiring session cookie payload', () => {
    const token = createSession({ id: 4, role: 'kitchen' });
    const session = readSession({ headers: { cookie: `dashboard_session=${token}` } });
    expect(session).toMatchObject({ sub: 4, role: 'kitchen', kind: 'user' });
  });

  it('rejects a tampered session', () => {
    const token = createSession({ id: 4, role: 'kitchen' });
    const tampered = `${token.slice(0, -1)}x`;
    expect(readSession({ headers: { cookie: `dashboard_session=${tampered}` } })).toBeNull();
  });
});
