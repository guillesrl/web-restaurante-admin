import { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { AuditEvent, api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/hooks/use-toast';

const actionLabels: Record<string, string> = {
  'order.created': 'Pedido creado',
  'order.status_changed': 'Estado de pedido cambiado',
  'order.cancelled': 'Pedido cancelado',
  'user.created': 'Usuario creado',
  'user.updated': 'Usuario actualizado',
  'menu.created': 'Artículo de menú creado',
  'menu.updated': 'Artículo de menú actualizado',
  'menu.deleted': 'Artículo de menú eliminado',
  'menu.stock_changed': 'Stock actualizado',
  'reservation.created': 'Reserva creada',
  'reservation.status_changed': 'Estado de reserva cambiado',
  'reservation.deleted': 'Reserva eliminada',
};

const roleLabels: Record<string, string> = {
  owner: 'Propietario',
  kitchen: 'Cocina',
  driver: 'Reparto',
};

function formatMetadata(metadata: Record<string, unknown>) {
  const entries = Object.entries(metadata ?? {}).filter(([key]) => !['password', 'password_hash'].includes(key));
  if (!entries.length) return null;
  return entries.map(([key, value]) => `${key.replaceAll('_', ' ')}: ${String(value)}`).join(' · ');
}

export function AuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const response = await api.getAuditEvents();
    if (response.success && response.data) setEvents(response.data);
    else toast({ title: 'No se pudo cargar la auditoría', description: response.error, variant: 'destructive' });
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="h-5 w-5" /> Historial de actividad</h2>
          <p className="text-sm text-muted-foreground">Últimas 100 acciones registradas desde el dashboard.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className="mr-1 h-4 w-4" />Actualizar</Button>
      </div>

      <ScrollArea className="h-[55vh] rounded-lg border">
        <div className="divide-y">
          {loading && <p className="p-4 text-sm text-muted-foreground">Cargando actividad…</p>}
          {!loading && events.length === 0 && <p className="p-4 text-sm text-muted-foreground">Aún no hay actividad registrada.</p>}
          {!loading && events.map((event) => (
            <div key={event.id} className="space-y-1 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{actionLabels[event.action] || event.action}</span>
                <Badge variant="outline">{event.entity_type} #{event.entity_id}</Badge>
              </div>
              <p className="text-muted-foreground">
                {event.actor_name || (event.actor_role ? roleLabels[event.actor_role] : 'Sistema')} · {new Date(event.created_at).toLocaleString('es-AD', { timeZone: 'Europe/Andorra' })}
              </p>
              {formatMetadata(event.metadata) && <p className="text-xs text-muted-foreground">{formatMetadata(event.metadata)}</p>}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
