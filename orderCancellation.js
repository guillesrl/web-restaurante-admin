export class OrderCancellationError extends Error {
  constructor(code, message, details, statusCode = 409) {
    super(message);
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

function stockLines(items) {
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    const id = Number(item?.id);
    const quantity = Number(item?.quantity);
    return Number.isInteger(id) && Number.isInteger(quantity) && quantity > 0
      ? [{ id, quantity }]
      : [];
  });
}

// The caller must hold a FOR UPDATE lock on the order before calling this.
export async function cancelPendingOrder(client, order, cancelledBy) {
  if (order.status === 'cancelled') {
    return { order, alreadyCancelled: true, stockRestored: Boolean(order.stock_restored_at) };
  }
  if (order.status !== 'pending') {
    throw new OrderCancellationError(
      'ORDER_CANNOT_BE_CANCELLED',
      'El pedido ya no está pendiente; debe revisarlo el restaurante',
      { status: order.status }
    );
  }

  const shouldRestoreStock = Boolean(order.stock_reserved_at) && !order.stock_restored_at;
  if (shouldRestoreStock) {
    for (const item of stockLines(order.items)) {
      await client.query(
        'UPDATE menu SET stock = stock + $1, updated_at=NOW() WHERE id=$2',
        [item.quantity, item.id]
      );
    }
  }

  const { rows } = await client.query(
    `UPDATE orders
     SET status='cancelled',
         updated_at=NOW(),
         cancelled_at=NOW(),
         cancelled_by=$1,
         stock_restored_at=CASE WHEN $2 THEN NOW() ELSE stock_restored_at END,
         delivery_notification_due_at=NULL,
         delivery_notification_claimed_at=NULL
     WHERE id=$3
     RETURNING *`,
    [cancelledBy, shouldRestoreStock, order.id]
  );

  return { order: rows[0], alreadyCancelled: false, stockRestored: shouldRestoreStock };
}
