import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Cloud, FolderOpen, HardDriveDownload, RefreshCw } from 'lucide-react';
import { Section } from '@/components/layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/card';
import { Button } from '@/components/button';
import { Input, Label, PasswordInput } from '@/components/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/select';
import { wailsClient } from '@/services/bindings';
import { queryKeys } from '@/services/queryKeys';
import { useNotificationStore } from '@/stores/notification';

export function CloudSyncSection() {
  const push = useNotificationStore((s) => s.push);
  const queryClient = useQueryClient();
  const sync = useQuery({ queryKey: queryKeys.settings.sync, queryFn: () => wailsClient.getSyncConfig() });

  const [cfg, setCfg] = useState({
    enabled: false,
    host: '',
    port: 5432,
    database: '',
    user: '',
    password: '',
    sslMode: 'disable',
    pollIntervalSec: 30,
  });

  const save = useMutation({
    mutationFn: () => wailsClient.saveSyncConfig({ ...cfg, port: Number(cfg.port) || 5432 }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings.sync });
      push({ title: cfg.enabled ? 'Sincronización habilitada' : 'Sincronización deshabilitada', variant: 'success' });
    },
    onError: (err: unknown) => {
      push({ title: 'No se pudo guardar la configuración', description: err instanceof Error ? err.message : undefined, variant: 'destructive' });
    },
  });

  const test = useMutation({
    mutationFn: () => wailsClient.testSyncConnection({ ...cfg, port: Number(cfg.port) || 5432 }),
    onSuccess: () => push({ title: 'Conexión exitosa', description: 'El servidor respondió correctamente.', variant: 'success' }),
    onError: (err: unknown) =>
      push({ title: 'Sin conexión', description: err instanceof Error ? err.message : undefined, variant: 'destructive' }),
  });

  const syncNow = useMutation({
    mutationFn: () => wailsClient.syncNow(),
    onSuccess: () => push({ title: 'Sincronización completada', variant: 'success' }),
    onError: (err: unknown) =>
      push({ title: 'No se pudo sincronizar', description: err instanceof Error ? err.message : undefined, variant: 'destructive' }),
  });

  useEffect(() => {
    if (sync.data) {
      setCfg({
        enabled: sync.data.enabled,
        host: sync.data.host,
        port: sync.data.port,
        database: sync.data.database,
        user: sync.data.user,
        password: sync.data.password,
        sslMode: sync.data.sslMode || 'disable',
        pollIntervalSec: sync.data.pollIntervalSec,
      });
    }
  }, [sync.data]);

  if (sync.isLoading) return null;

  return (
    <Section title="Sincronización en la nube">
      <Card>
        <CardHeader>
          <CardTitle>Conexión al servidor</CardTitle>
          <CardDescription>
            Todos los equipos que compartan este servidor mantienen la misma información maestra.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="stack" style={{ maxWidth: '24rem' }}>
            <div className="field">
              <Label htmlFor="sync-host">Servidor (host)</Label>
              <Input
                id="sync-host"
                value={cfg.host}
                onChange={(e) => setCfg({ ...cfg, host: e.target.value })}
                placeholder="db.midominio.com"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="hstack hstack--sm">
              <div className="field" style={{ flex: 1 }}>
                <Label htmlFor="sync-port">Puerto</Label>
                <Input
                  id="sync-port"
                  type="number"
                  min={1}
                  value={String(cfg.port)}
                  onChange={(e) => setCfg({ ...cfg, port: Number(e.target.value) })}
                />
              </div>
              <div className="field" style={{ flex: 2 }}>
                <Label htmlFor="sync-db">Base de datos</Label>
                <Input
                  id="sync-db"
                  value={cfg.database}
                  onChange={(e) => setCfg({ ...cfg, database: e.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
            <div className="hstack hstack--sm">
              <div className="field" style={{ flex: 1 }}>
                <Label htmlFor="sync-user">Usuario</Label>
                <Input
                  id="sync-user"
                  value={cfg.user}
                  onChange={(e) => setCfg({ ...cfg, user: e.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <Label htmlFor="sync-password">Contraseña</Label>
                <PasswordInput
                  id="sync-password"
                  value={cfg.password}
                  onChange={(e) => setCfg({ ...cfg, password: e.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <Label htmlFor="sync-ssl">Modo SSL</Label>
              <Select
                items={[
                  { value: 'disable', label: 'Desactivado' },
                  { value: 'require', label: 'Requerido' },
                  { value: 'verify-full', label: 'Verificación completa' },
                ]}
                value={cfg.sslMode}
                onValueChange={(v) => setCfg({ ...cfg, sslMode: v ?? 'disable' })}
              >
                <SelectTrigger id="sync-ssl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="disable">Desactivado</SelectItem>
                  <SelectItem value="require">Requerido</SelectItem>
                  <SelectItem value="verify-full">Verificación completa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="field">
              <Label htmlFor="sync-interval">Intervalo de sincronización (segundos)</Label>
              <Input
                id="sync-interval"
                type="number"
                min={10}
                value={String(cfg.pollIntervalSec)}
                onChange={(e) => setCfg({ ...cfg, pollIntervalSec: Number(e.target.value) || 30 })}
              />
            </div>
            <div className="field">
              <Label htmlFor="sync-enabled">Estado</Label>
              <Select
                items={[
                  { value: '1', label: 'Activado' },
                  { value: '0', label: 'Desactivado' },
                ]}
                value={cfg.enabled ? '1' : '0'}
                onValueChange={(v) => setCfg({ ...cfg, enabled: v === '1' })}
              >
                <SelectTrigger id="sync-enabled">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Activado</SelectItem>
                  <SelectItem value="0">Desactivado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="hstack hstack--sm">
              <Button onClick={() => test.mutate()} loading={test.isPending} variant="outline">
                Probar conexión
              </Button>
              <Button onClick={() => save.mutate()} loading={save.isPending}>
                <Cloud /> Guardar
              </Button>
              <Button onClick={() => syncNow.mutate()} loading={syncNow.isPending} variant="outline">
                <RefreshCw /> Sincronizar ahora
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </Section>
  );
}

export function BackupSection() {
  const push = useNotificationStore((s) => s.push);
  const queryClient = useQueryClient();
  const prefs = useQuery({ queryKey: queryKeys.settings.preferences, queryFn: () => wailsClient.getPreferences() });

  const [frequency, setFrequency] = useState('off');

  useEffect(() => {
    if (prefs.data) setFrequency(prefs.data.backupFrequency || 'off');
  }, [prefs.data]);

  const backup = useMutation({
    mutationFn: () => wailsClient.createBackup(),
    onSuccess: (result) => {
      if (result.fallbackUsed) {
        push({
          title: 'Resguardo de emergencia',
          description: result.warning || `La carpeta configurada no estaba disponible. La copia se guardó en ${result.path}.`,
          variant: 'destructive',
        });
        return;
      }
      push({ title: 'Copia de seguridad creada', description: result.path, variant: 'success' });
    },
    onError: (err: unknown) =>
      push({ title: 'No se pudo crear la copia', description: err instanceof Error ? err.message : undefined, variant: 'destructive' }),
  });

  const pickFolder = useMutation({
    mutationFn: async () => {
      const folder = await wailsClient.chooseBackupFolder();
      if (folder) await wailsClient.setBackupFolder(folder);
      return folder;
    },
    onSuccess: async (folder) => {
      if (folder) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.settings.preferences });
        push({ title: 'Carpeta de respaldos actualizada', description: folder, variant: 'success' });
      }
    },
    onError: (err: unknown) =>
      push({ title: 'No se pudo elegir la carpeta', description: err instanceof Error ? err.message : undefined, variant: 'destructive' }),
  });

  const saveFrequency = useMutation({
    mutationFn: (value: string) => wailsClient.setBackupFrequency(value),
    onSuccess: () => push({ title: 'Frecuencia de respaldo guardada', variant: 'success' }),
    onError: (err: unknown) =>
      push({ title: 'No se pudo guardar la frecuencia', description: err instanceof Error ? err.message : undefined, variant: 'destructive' }),
  });

  return (
    <Section title="Copia de seguridad">
      <Card>
        <CardHeader>
          <CardTitle>Respaldo manual</CardTitle>
          <CardDescription>
            Crea un archivo con la base de datos actual en la carpeta configurada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="stack" style={{ maxWidth: '24rem' }}>
            <div className="settings-row">
              <span className="settings-row__label">Carpeta</span>
              <div className="hstack hstack--sm">
                <strong style={{ maxWidth: '14rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {prefs.data?.backupFolder || '~/.vfinancy/backups'}
                </strong>
                <Button variant="outline" size="sm" onClick={() => pickFolder.mutate()} loading={pickFolder.isPending}>
                  <FolderOpen /> Elegir
                </Button>
              </div>
            </div>
            <div className="field">
              <Label htmlFor="backup-frequency">Frecuencia automática</Label>
              <Select
                items={[
                  { value: 'off', label: 'Desactivada' },
                  { value: 'on_close', label: 'Al cerrar la aplicación' },
                  { value: 'daily', label: 'Diaria' },
                  { value: 'weekly', label: 'Semanal' },
                ]}
                value={frequency}
                onValueChange={(v) => {
                  const value = v ?? 'off';
                  setFrequency(value);
                  saveFrequency.mutate(value);
                }}
              >
                <SelectTrigger id="backup-frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Desactivada</SelectItem>
                  <SelectItem value="on_close">Al cerrar la aplicación</SelectItem>
                  <SelectItem value="daily">Diaria</SelectItem>
                  <SelectItem value="weekly">Semanal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => backup.mutate()} loading={backup.isPending}>
              <HardDriveDownload /> Crear copia ahora
            </Button>
          </div>
        </CardContent>
      </Card>
    </Section>
  );
}
