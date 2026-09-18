import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, UserRound } from 'lucide-react';
import { Drawer, ListRow, RowActions, type RowAction } from '@/components/misc';
import { Button } from '@/components/button';
import { SearchInput } from '@/components/input';
import { Badge } from '@/components/badge';
import { AlertDialog } from '@/components/dialog';
import { EmptyState, Spinner } from '@/components/feedback';
import type { SupplierDTO } from '@/services/wails-types';
import { useRemoveSupplier, useSuppliers } from '@/features/suppliers/hooks/useSuppliers';
import { SupplierFormDialog } from '@/features/suppliers/components/SupplierFormDialog';
import { useNotificationStore } from '@/stores/notification';

interface SuppliersDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SuppliersDrawer({ open, onOpenChange }: SuppliersDrawerProps) {
  const push = useNotificationStore((s) => s.push);
  const { data, isLoading, isError } = useSuppliers({ page: 1, pageSize: 500 });
  const remove = useRemoveSupplier();
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierDTO | null>(null);
  const [removeTarget, setRemoveTarget] = useState<SupplierDTO | null>(null);

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = data?.items ?? [];
    if (!q) return rows;
    return rows.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.contactName.toLowerCase().includes(q) ||
        s.phone.includes(q),
    );
  }, [data, search]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const buildActions = (s: SupplierDTO): RowAction[] => [
    {
      label: 'Editar',
      icon: Pencil,
      onSelect: () => {
        setEditing(s);
        setFormOpen(true);
      },
    },
    { label: 'Eliminar', icon: Trash2, danger: true, onSelect: () => setRemoveTarget(s) },
  ];

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Proveedores"
      description="Catálogo de proveedores usados en las órdenes de compra."
      footer={
        <Button onClick={openCreate} style={{ width: '100%' }}>
          <Plus /> Nuevo proveedor
        </Button>
      }
    >
      <div className="stack">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch('')}
          placeholder="Buscar proveedor…"
          aria-label="Buscar proveedor"
        />
        {isLoading ? (
          <Spinner />
        ) : isError ? (
          <EmptyState title="No se pudieron cargar los proveedores" />
        ) : items.length === 0 ? (
          <EmptyState
            title={search ? 'Sin resultados' : 'Sin proveedores'}
            description={search ? 'Prueba con otro término.' : 'Registra tu primer proveedor para las compras.'}
            icon={UserRound}
          />
        ) : (
          items.map((s) => (
            <ListRow
              key={s.id}
              title={s.name}
              meta={
                <>
                  {[s.contactName, s.phone, s.email].filter(Boolean).join(' · ') || '—'}
                  {!s.isActive && ' · '}
                  {!s.isActive && <Badge variant="muted">Inactivo</Badge>}
                </>
              }
              trailing={<RowActions actions={buildActions(s)} label={`Acciones de ${s.name}`} />}
            />
          ))
        )}
      </div>

      <SupplierFormDialog open={formOpen} onOpenChange={setFormOpen} edit={editing} />

      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(o) => {
          if (!o) setRemoveTarget(null);
        }}
        title={removeTarget ? `Eliminar «${removeTarget.name}»` : 'Eliminar proveedor'}
        confirmLabel="Eliminar"
        variant="destructive"
        loading={remove.isPending}
        onConfirm={() => {
          if (!removeTarget) return;
          remove.mutate(removeTarget.id, {
            onSuccess: () => {
              push({ title: 'Proveedor eliminado', variant: 'success' });
              setRemoveTarget(null);
            },
            onError: (err: unknown) => {
              push({ title: 'No se pudo eliminar el proveedor', description: err instanceof Error ? err.message : undefined, variant: 'destructive' });
              setRemoveTarget(null);
            },
          });
        }}
      />
    </Drawer>
  );
}