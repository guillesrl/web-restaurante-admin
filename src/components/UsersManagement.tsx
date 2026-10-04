import { useEffect, useState } from 'react';
import { DashboardRole, DashboardUser, api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { useDashboardAuth } from '@/components/AuthGate';

const roleLabels: Record<DashboardRole, string> = {
  owner: 'Propietario',
  kitchen: 'Cocina',
  driver: 'Repartidor',
};

export function UsersManagement() {
  const { user: currentUser } = useDashboardAuth();
  const isLegacyBootstrap = Boolean(currentUser?.legacy);
  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: (isLegacyBootstrap ? 'owner' : 'kitchen') as DashboardRole, password: '' });

  const load = async () => {
    setLoading(true);
    const response = await api.getUsers();
    if (response.success && response.data) setUsers(response.data);
    else toast({ title: 'No se pudieron cargar los usuarios', description: response.error, variant: 'destructive' });
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const response = await api.createUser(form);
    setSaving(false);
    if (!response.success || !response.data) {
      toast({ title: 'No se pudo crear el usuario', description: response.error, variant: 'destructive' });
      return;
    }
    setUsers((current) => [...current, response.data!]);
    setForm({ name: '', email: '', role: 'kitchen', password: '' });
    if (isLegacyBootstrap) {
      toast({ title: 'Cuenta de propietario creada', description: 'La contraseña compartida acaba de desactivarse. Inicia sesión con tu correo.' });
      window.setTimeout(() => window.location.reload(), 900);
      return;
    }
    toast({ title: 'Usuario creado', description: `${response.data.name} ya puede iniciar sesión.` });
  };

  const toggleUser = async (user: DashboardUser) => {
    const response = await api.updateUser(user.id!, { is_active: !user.is_active });
    if (!response.success || !response.data) {
      toast({ title: 'No se pudo actualizar', description: response.error, variant: 'destructive' });
      return;
    }
    setUsers((current) => current.map((item) => item.id === user.id ? response.data! : item));
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Usuarios y permisos</h2>
        <p className="text-sm text-muted-foreground">Crea accesos individuales para propietario, cocina y reparto.</p>
        {isLegacyBootstrap && <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">Crea primero tu cuenta de propietario. Después se desactivará el acceso con contraseña compartida.</p>}
      </div>

      <form onSubmit={createUser} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
        <div><Label htmlFor="user-name">Nombre</Label><Input id="user-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
        <div><Label htmlFor="user-email">Correo</Label><Input id="user-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
        <div>
          <Label>Rol</Label>
          <Select value={form.role} disabled={isLegacyBootstrap} onValueChange={(role: DashboardRole) => setForm({ ...form, role })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(roleLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label htmlFor="user-password">Contraseña inicial</Label><Input id="user-password" type="password" minLength={12} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
        <div className="sm:col-span-2 flex justify-end"><Button type="submit" disabled={saving}>{saving ? 'Creando…' : 'Crear usuario'}</Button></div>
      </form>

      <div className="space-y-2">
        {loading ? <p className="text-sm text-muted-foreground">Cargando usuarios…</p> : users.map((user) => (
          <div key={user.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <div className="min-w-0"><div className="font-medium">{user.name}</div><div className="truncate text-muted-foreground">{user.email}</div></div>
            <div className="flex items-center gap-2"><Badge variant="outline">{roleLabels[user.role]}</Badge><Button size="sm" variant={user.is_active ? 'outline' : 'secondary'} onClick={() => toggleUser(user)}>{user.is_active ? 'Desactivar' : 'Activar'}</Button></div>
          </div>
        ))}
      </div>
    </div>
  );
}
