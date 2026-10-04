import { describe, expect, it } from 'vitest';
import { OrderCancellationError, cancelPendingOrder } from '../orderCancellation.js';

function fakeClient() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('UPDATE orders')) return { rows: [{ id: 9, status: 'cancelled' }] };
      return { rows: [] };
    },
  };
}

describe('cancelPendingOrder', () => {
  it('restores reserved stock exactly once when cancelling a pending order', async () => {
    const client = fakeClient();
    const result = await cancelPendingOrder(client, {
      id: 9,
      status: 'pending',
      stock_reserved_at: '2026-10-04T12:00:00Z',
      stock_restored_at: null,
      items: [{ id: 3, quantity: 2 }, { id: 4, quantity: 1 }],
    }, 'dashboard');

    expect(result.stockRestored).toBe(true);
    expect(client.calls.filter(({ sql }) => sql.startsWith('UPDATE menu'))).toHaveLength(2);
    expect(client.calls.at(-1).params).toEqual(['dashboard', true, 9]);
  });

  it('never restores stock for an order that did not reserve it', async () => {
    const client = fakeClient();
    const result = await cancelPendingOrder(client, {
      id: 9,
      status: 'pending',
      stock_reserved_at: null,
      stock_restored_at: null,
      items: [{ id: 3, quantity: 2 }],
    }, 'dashboard');

    expect(result.stockRestored).toBe(false);
    expect(client.calls.filter(({ sql }) => sql.startsWith('UPDATE menu'))).toHaveLength(0);
  });

  it('rejects orders that have already started preparation', async () => {
    const client = fakeClient();
    await expect(cancelPendingOrder(client, { id: 9, status: 'preparing', items: [] }, 'dashboard'))
      .rejects.toMatchObject({ code: 'ORDER_CANNOT_BE_CANCELLED' });
    expect(client.calls).toHaveLength(0);
  });

  it('is idempotent for an already cancelled order', async () => {
    const client = fakeClient();
    const result = await cancelPendingOrder(client, { id: 9, status: 'cancelled', stock_restored_at: 'now' }, 'dashboard');
    expect(result.alreadyCancelled).toBe(true);
    expect(client.calls).toHaveLength(0);
  });
});
