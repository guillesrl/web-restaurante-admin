/* eslint-disable @typescript-eslint/no-explicit-any */
// Cliente HTTP para comunicarse con una API REST
// Esto evita el problema de usar pg directamente en el navegador

import { handleUnauthorized } from './auth';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export type DashboardRole = 'owner' | 'kitchen' | 'driver';
export interface DashboardUser {
  id: number | null;
  name: string;
  email: string | null;
  role: DashboardRole;
  is_active: boolean;
  legacy?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface AuditEvent {
  id: number;
  actor_user_id: number | null;
  actor_role: DashboardRole | null;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface BackupRun {
  id: number;
  source: 'automatic' | 'manual';
  status: 'running' | 'completed' | 'failed';
  object_key: string | null;
  checksum_sha256: string | null;
  size_bytes: number | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface BackupStatus {
  enabled: boolean;
  missing: string[];
  runs: BackupRun[];
}

class ApiClient {
  // Auth endpoints
  async getAuthStatus() {
    return this.request<{ enabled: boolean; migration_required: boolean }>('/auth/status');
  }

  async login(email: string, password: string) {
    return this.request<{ user: DashboardUser }>('/login', {
      method: 'POST',
      body: JSON.stringify({ email: email || undefined, password }),
    });
  }

  async getCurrentUser() {
    return this.request<{ user: DashboardUser }>('/auth/me');
  }

  async logout() {
    return this.request<null>('/logout', { method: 'POST' });
  }

  async getUsers() {
    return this.request<DashboardUser[]>('/users');
  }

  async createUser(user: { name: string; email: string; role: DashboardRole; password: string }) {
    return this.request<DashboardUser>('/users', { method: 'POST', body: JSON.stringify(user) });
  }

  async updateUser(id: number, user: Partial<Pick<DashboardUser, 'name' | 'role' | 'is_active'>> & { password?: string }) {
    return this.request<DashboardUser>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(user) });
  }

  async getAuditEvents(limit = 100) {
    return this.request<AuditEvent[]>(`/audit-events?limit=${limit}`);
  }

  async getBackups() {
    return this.request<BackupStatus>('/backups');
  }

  async createBackup() {
    return this.request<BackupRun>('/backups', { method: 'POST' });
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        ...options,
      });

      if (response.status === 401) {
        if (endpoint !== '/auth/me' && endpoint !== '/login') handleUnauthorized();
        return { success: false, error: 'No autorizado' };
      }

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || `HTTP ${response.status}`,
        };
      }

      return {
        success: true,
        data: data.data || data,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Menu endpoints
  async getMenuItems() {
    return this.request<any[]>('/menu');
  }

  async createMenuItem(item: any) {
    return this.request<any>('/menu', {
      method: 'POST',
      body: JSON.stringify(item),
    });
  }

  async updateMenuItem(id: number, item: any) {
    return this.request<any>(`/menu/${id}`, {
      method: 'PUT',
      body: JSON.stringify(item),
    });
  }

  async deleteMenuItem(id: number) {
    return this.request<any>(`/menu/${id}`, {
      method: 'DELETE',
    });
  }

  async updateMenuItemStock(id: number, stock: number) {
    return this.request<any>(`/menu/${id}/stock`, {
      method: 'PATCH',
      body: JSON.stringify({ stock }),
    });
  }

  // Orders endpoints
  async getOrders(filter?: 'today' | 'month' | 'active') {
    const query = filter ? `?filter=${filter}` : '';
    return this.request<any[]>(`/orders${query}`);
  }

  async createOrder(order: any) {
    return this.request<any>('/orders', {
      method: 'POST',
      body: JSON.stringify(order),
    });
  }

  async updateOrder(id: number, order: any) {
    return this.request<any>(`/orders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(order),
    });
  }

  async updateOrderStatus(id: number, status: string) {
    return this.request<any>(`/orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  // Reservations endpoints
  async getReservations(filter?: 'today' | 'month') {
    const query = filter ? `?filter=${filter}` : '';
    return this.request<any[]>(`/reservations${query}`);
  }

  async createReservation(reservation: any) {
    return this.request<any>('/reservations', {
      method: 'POST',
      body: JSON.stringify(reservation),
    });
  }

  async updateReservation(id: number, reservation: any) {
    return this.request<any>(`/reservations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(reservation),
    });
  }

  async updateReservationStatus(id: number, status: string) {
    return this.request<any>(`/reservations/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  async deleteReservation(id: number) {
    return this.request<any>(`/reservations/${id}`, {
      method: 'DELETE',
    });
  }
}

export const api = new ApiClient();
