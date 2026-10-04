import { useEffect, useState } from 'react';
import { DatabaseBackup, RefreshCw } from 'lucide-react';
import { BackupStatus, api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';

const statusLabels = {
  running: 'En curso',
  completed: 'Completada',
  failed: 'Fallida',
};

const formatSize = (value: number | null) => {
  if (!value) return '—';
  return value < 1024 * 1024 ? `${Math.round(value / 1024)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

export function BackupsManagement() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    const response = await api.getBackups();
    if (response.success && response.data) setStatus(response.data);
    else toast({ title: 'No se pudo cargar el estado de copias', description: response.error, variant: 'destructive' });
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const createBackup = async () => {
    setCreating(true);
    const response = await api.createBackup();
    setCreating(false);
    if (!response.success) {
      toast({ title: 'No se pudo crear la copia', description: response.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Copia de seguridad completada', description: 'Se ha cifrado y guardado fuera de la base de datos.' });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><DatabaseBackup className="h-5 w-5" /> Copias de seguridad</h2>
          <p className="text-sm text-muted-foreground">Exportaciones cifradas fuera de Neon y registro de las últimas ejecuciones.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className="mr-1 h-4 w-4" />Actualizar</Button>
      </div>

      {!loading && status && !status.enabled && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">La copia externa todavía no está activada.</p>
          <p className="mt-1 text-muted-foreground">Faltan: {status.missing.join(', ')}. Añádelas en EasyPanel; sus valores nunca se muestran aquí.</p>
        </div>
      )}

      {!loading && status?.enabled && (
        <div className="flex items-center justify-between rounded-lg border p-3 text-sm">
          <span>La copia automática se ejecuta cada 24 horas.</span>
          <Button size="sm" onClick={createBackup} disabled={creating}>{creating ? 'Creando…' : 'Crear copia ahora'}</Button>
        </div>
      )}

      <div className="space-y-2">
        {loading && <p className="text-sm text-muted-foreground">Cargando copias…</p>}
        {!loading && status?.runs.length === 0 && <p className="text-sm text-muted-foreground">Aún no se ha creado ninguna copia.</p>}
        {!loading && status?.runs.map((run) => (
          <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
            <div>
              <div className="font-medium">{run.source === 'automatic' ? 'Automática' : 'Manual'} · {new Date(run.started_at).toLocaleString('es-AD', { timeZone: 'Europe/Andorra' })}</div>
              <div className="text-muted-foreground">{formatSize(run.size_bytes)}{run.completed_at ? ` · Finalizada ${new Date(run.completed_at).toLocaleTimeString('es-AD', { timeZone: 'Europe/Andorra', hour: '2-digit', minute: '2-digit' })}` : ''}</div>
            </div>
            <Badge variant={run.status === 'completed' ? 'outline' : run.status === 'failed' ? 'destructive' : 'secondary'}>{statusLabels[run.status]}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
