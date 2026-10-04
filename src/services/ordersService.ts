import { api } from '@/lib/api';

export interface OrderItem {
  id: number;
  name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id?: number;
  customer_name: string;
  customer_phone?: string;
  customer_email?: string;
  items: OrderItem[];
  total: number;
  status: 'pending' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled';
  fulfillment_type?: 'pickup' | 'delivery';
  address?: string;
  stock_restored?: boolean;
  already_cancelled?: boolean;
  notes?: string;
  created_at?: string;
  scheduled_for?: string;
  display_date?: string;
  time?: string;
  order_datetime?: string;
  updated_at?: string;
}

export class OrdersService {
  static async getAll(): Promise<Order[]> {
    const response = await api.getOrders();
    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to fetch orders');
    }
    return response.data;
  }

  static async getToday(): Promise<Order[]> {
    const response = await api.getOrders('today');
    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to fetch today orders');
    }
    return response.data;
  }

  static async getThisMonth(): Promise<Order[]> {
    const response = await api.getOrders('month');
    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to fetch monthly orders');
    }
    return response.data;
  }

  static async getActive(): Promise<Order[]> {
    const response = await api.getOrders('active');
    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to fetch active orders');
    }
    return response.data;
  }

  // Obtener pedido por ID
  static async getById(id: number): Promise<Order | null> {
    const orders = await this.getAll();
    return orders.find(order => order.id === id) || null;
  }

  // Crear nuevo pedido
  static async create(order: Omit<Order, 'id' | 'created_at' | 'updated_at'>): Promise<Order> {
    const response = await api.createOrder(order);
    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to create order');
    }
    return response.data;
  }

  // Actualizar pedido
  static async update(id: number, order: Partial<Order>): Promise<Order | null> {
    const response = await api.updateOrder(id, order);
    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to update order');
    }
    return response.data;
  }

  // Eliminar pedido
  static async delete(id: number): Promise<boolean> {
    const response = await api.updateOrder(id, { deleted: true });
    if (!response.success) {
      throw new Error(response.error || 'Failed to delete order');
    }
    return true;
  }

  // Actualizar estado del pedido
  static async updateStatus(id: number, status: Order['status']): Promise<Order | null> {
    const response = await api.updateOrderStatus(id, status);
    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to update order status');
    }
    return response.data;
  }

  // Obtener pedidos por estado
  static async getByStatus(status: Order['status']): Promise<Order[]> {
    const orders = await this.getAll();
    return orders.filter(order => order.status === status);
  }
}
