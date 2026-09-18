import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Boxes, Pencil, Ban, Plus, Settings2, AlertTriangle, Download, History } from 'lucide-react';
import { z } from 'zod';
import { PageContainer, PageHeader, StatBand } from '@/components/layout';
import { StatCard } from '@/components/card';
import { DataTable, type Column } from '@/components/table';
import { Badge } from '@/components/badge';
import { EmptyState, Spinner } from '@/components/feedback';
import { Button } from '@/components/button';
import { ConfirmDialog } from '@/components/dialog';
import { Drawer, ListRow, RowActions, type RowAction } from '@/components/misc';
import { Form, NumberField } from '@/components/form';
import { SearchInput } from '@/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/select';
import { useInventory, useVoidStock } from '@/features/inventory/hooks/useInventory';
import { InventoryReceiveDialog } from '@/features/inventory/components/InventoryReceiveDialog';
import { InventoryAdjustDialog } from '@/features/inventory/components/InventoryAdjustDialog';
import { ProductsDrawer } from '@/features/products/components/ProductsDrawer';
import { wailsClient } from '@/services/bindings';
import { queryKeys } from '@/services/queryKeys';
import type { InventoryItem } from '@/types/domain';
import { formatCurrency, formatDate, formatNumber } from '@/utils/format';
import { useNotificationStore } from '@/stores/notification';

const columns: Column<InventoryItem>[] = [
  {
    id: 'arrivalDate',
    header: 'Fecha de ingreso',
    sortable: true,
    cell: (row) => <span className="tabular muted">{row.arrivalDate ? formatDate(row.arrivalDate) : '—'}</span>,
  },
  {
    id: 'productSku',
    header: 'SKU',
    sortable: true,
    cell: (row) => <span className="fw-medium tabular">{row.productSku}</span>,
  },
  {
    id: 'productDescription',
    header: 'Producto',
    sortable: true,
    cell: (row) => row.productDescription,
  },
  {
    id: 'quantity',
    header: 'Cantidad',
    align: 'numeric',
    sortable: true,
    cell: (row) => <span className="tabular">{formatNumber(row.quantity)}</span>,
  },
  {
    id: 'unitCost',
    header: 'Costo unitario',
    align: 'numeric',
    sortable: true,
    cell: (row) => <span className="tabular">{formatCurrency(row.unitCost, row.currencyCode)}</span>,
  },
  {
    id: 'totalCost',
    header: 'Costo total',
    align: 'numeric',
    sortable: true,
    accessor: (row) => row.quantity * row.unitCost,
    cell: (row) => <span className="tabular">{formatCurrency(row.quantity * row.unitCost, row.currencyCode)}</span>,
  },
  {
    id: 'maxSaleDate',
    header: 'Venta máxima',
    cell: (row) => <span className="muted">{row.maxSaleDate ? formatDate(row.maxSaleDate) : '—'}</span>,
  },
  {
    id: 'daysRemaining',
    header: 'Días restantes',
    align: 'numeric',
    sortable: true,
    cell: (row) => <span className="tabular">{row.daysRemaining}</span>,
  },
  {
    id: 'status',
    header: 'Estado',
    cell: (row) => {
      if (row.status === 'voided') return <Badge variant="destructive">Anulado</Badge>;
      if (row.status === 'written_off') return <Badge variant="muted">Baja</Badge>;
      if (row.status === 'depleted') return <Badge variant="muted">Agotado</Badge>;
      if (row.isClearance) return <Badge variant="destructive" className="fw-bold">REMATE</Badge>;
      return <Badge variant="success">Normal</Badge>;
    },
  },
];

const movementTypeLabels: Record<string, string> = {
  purchase_receipt: 'Ingreso por compra',
  sale: 'Venta',
  void_sale: 'Reversión de venta',
  void_purchase: 'Anulación de compra',
  adjustment_in: 'Ajuste (entrada)',
  adjustment_out: 'Ajuste (salida)',
};

function InventoryMovementsDrawer({ open, onOpenChange, batch }: { open: boolean; onOpenChange: (open: boolean) => void; batch: InventoryItem | null }) {
  const movements = useQuery({
    queryKey: ['inventory', 'movements', batch?.productId],
    queryFn: () => wailsClient.listInventoryMovements({ page: 1, pageSize: 200 }, batch!.productId),
    enabled: open && Boolean(batch),
  });

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Movimientos (Kardex)"
      description={batch ? `${batch.productSku} — ${batch.productDescription}` : undefined}
    >
      {movements.isLoading ? (
        <Spinner />
      ) : movements.isError ? (
        <EmptyState title="No se pudo cargar" description="No se pudieron cargar los movimientos del producto." />
      ) : (movements.data?.items ?? []).length === 0 ? (
        <EmptyState title="Sin movimientos" description="Este producto aún no registra movimientos de inventario." />
      ) : (
        <div className="stack">
          {(movements.data?.items ?? []).map((m) => (
            <ListRow
              key={m.id}
              title={movementTypeLabels[m.type] ?? m.type}
              meta={
                <>
                  {formatDate(m.movementDate)}
                  {m.notes ? ` · ${m.notes}` : ''}
                </>
              }
              trailing={
                <span className="tabular" style={{ textAlign: 'right' }}>
                  <span className={m.quantity >= 0 ? undefined : 'text-destructive'}>
                    {m.quantity > 0 ? '+' : ''}
                    {formatNumber(m.quantity)}
                  </span>
                  <br />
                  <small className="muted">Saldo {formatNumber(m.balanceAfter)}</small>
                </span>
              }
            />
          ))}
        </div>
      )}
    </Drawer>
  );
}

const clearanceSchema = z.object({
  clearanceDays: z.number().int().min(1, 'Usa al menos 1 día.').max(365),
  clearanceWarningDays: z.number().int().min(0).max(90),
});

type ClearanceValues = z.infer<typeof clearanceSchema>;

function InventorySettingsDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const push = useNotificationStore((s) => s.push);

  const preferences = useQuery({
    queryKey: queryKeys.settings.preferences,
    queryFn: () => wailsClient.getPreferences(),
    enabled: open,
  });

  const [saving, setSaving] = useState(false);

  const defaults: ClearanceValues = {
    clearanceDays: preferences.data?.clearanceDays ?? 25,
    clearanceWarningDays: preferences.data?.clearanceWarningDays ?? 3,
  };

  async function save(values: ClearanceValues) {
    setSaving(true);
    try {
      await wailsClient.updatePreference('clearance_days', String(values.clearanceDays));
      await wailsClient.updatePreference('clearance_warning_days', String(values.clearanceWarningDays));
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings.preferences });
      push({ title: 'Reglas de remate guardadas', variant: 'success' });
      onOpenChange(false);
    } catch (cause) {
      push({
        title: 'No se pudo guardar la configuración',
        description: cause instanceof Error ? cause.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Reglas de inventario"
      description="Controla cuándo un lote pasa a remate y con cuánta anticipación se avisa."
      footer={
        <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancelar
        </Button>
      }
    >
      <Form<ClearanceValues> key={`${defaults.clearanceDays}-${defaults.clearanceWarningDays}`} schema={clearanceSchema} defaultValues={defaults} onSubmit={save}>
        {() => (
          <div className="stack">
            <NumberField
              name="clearanceDays"
              label="Días para remate"
              description="Un lote pasa a remate cuando supera estos días desde su ingreso."
              min={1}
              max={365}
              required
            />
            <NumberField
              name="clearanceWarningDays"
              label="Días de aviso previo"
              description="Cuántos días antes del remate se marca el lote como próximo a vencer."
              min={0}
              max={90}
              required
            />
            <Button type="submit" loading={saving}>
              Guardar
            </Button>
          </div>
        )}
      </Form>
    </Drawer>
  );
}

export function InventoryPage() {
  const [statusFilter, setStatusFilter] = useState('all');
  const storeQuery = useInventory();
  const voidedQuery = useInventory({ status: 'voided' });
  const isLoading = storeQuery.isLoading || voidedQuery.isLoading;
  const isError = storeQuery.isError || voidedQuery.isError;
  const error = storeQuery.error ?? voidedQuery.error;
  const refetch = () => {
    void storeQuery.refetch();
    void voidedQuery.refetch();
  };
  const voidStock = useVoidStock();
  const push = useNotificationStore((s) => s.push);

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveTarget, setReceiveTarget] = useState<InventoryItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [adjustTarget, setAdjustTarget] = useState<InventoryItem | null>(null);
  const [voidTarget, setVoidTarget] = useState<InventoryItem | null>(null);
  const [movementsTarget, setMovementsTarget] = useState<InventoryItem | null>(null);

  const items = [...(storeQuery.data ?? []), ...(voidedQuery.data ?? [])];
  const live = items.filter((i) => i.status !== 'voided');
  const totalUnits = live.reduce((s, i) => s + i.quantity, 0);
  const inventoryValue = live.reduce((s, i) => s + i.quantity * i.unitCost, 0);
  const clearance = items.filter((i) => i.isClearance).length;
  const expiringSoon = live.filter((i) => i.daysRemaining >= 0 && i.daysRemaining < 5).length;

  const filteredItems = useMemo(() => {
    let rows = items;
    if (statusFilter === 'clearance') rows = items.filter((i) => i.isClearance && i.status !== 'voided');
    else if (statusFilter === 'expiring') rows = live.filter((i) => i.daysRemaining >= 0 && i.daysRemaining < 5);
    else if (statusFilter === 'voided') rows = items.filter((i) => i.status === 'voided');
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (i) => i.productDescription.toLowerCase().includes(q) || i.productSku.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [items, live, statusFilter, search]);

  const openCreate = () => {
    setReceiveTarget(null);
    setReceiveOpen(true);
  };

  const buildActions = (row: InventoryItem): RowAction[] | null => {
    if (row.status === 'voided') return null;
    return [
      { label: 'Ver movimientos', icon: History, onSelect: () => setMovementsTarget(row) },
      {
        label: 'Recibir',
        icon: Download,
        onSelect: () => {
          setReceiveTarget(row);
          setReceiveOpen(true);
        },
      },
      { label: 'Ajustar stock', icon: Pencil, onSelect: () => setAdjustTarget(row) },
      { label: 'Anular lote', icon: Ban, danger: true, onSelect: () => setVoidTarget(row) },
    ];
  };

  const tableColumns = useMemo<Column<InventoryItem>[]>(() => [
    ...columns,
    {
      id: 'actions',
      header: '',
      width: 72,
      cell: (row) => {
        const actions = buildActions(row);
        if (!actions || actions.length === 0) return null;
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <RowActions actions={actions} label={`Acciones de ${row.productDescription}`} />
          </div>
        );
      },
    },
  ], []);

  return (
    <PageContainer>
      <PageHeader
        title="Inventario"
        subtitle="Lotes, existencias y control de remate"
        actions={
          <>
            <Button variant="outline" onClick={() => setProductsOpen(true)}>
              <Package /> Productos
            </Button>
            <Button variant="outline" onClick={() => setSettingsOpen(true)}>
              <Settings2 /> Reglas
            </Button>
            <Button onClick={openCreate}>
              <Plus /> Nuevo ingreso
            </Button>
          </>
        }
      />

      <StatBand>
        <StatCard label="Lotes activos" value={String(live.length)} icon={Boxes} />
        <StatCard label="Unidades en stock" value={formatNumber(totalUnits)} />
        <StatCard label="Valor de inventario" value={formatCurrency(inventoryValue)} />
        <StatCard label="En remate" value={String(clearance)} icon={AlertTriangle} />
        <StatCard label="Por vencer (5 días)" value={String(expiringSoon)} />
      </StatBand>

      <DataTable
        columns={tableColumns}
        data={filteredItems}
        keyField="id"
        loading={isLoading}
        error={isError ? (error as Error) : null}
        onRetry={() => refetch()}
        onRowClick={(row) => setMovementsTarget(row)}
        rowActions={buildActions}
        rowClassName={(row) => (row.status === 'depleted' ? 'row-dimmed' : undefined)}
        preferencesKey="inventory-journal"
        defaultPreferences={{ sort: { id: 'arrivalDate', direction: 'desc' } }}
        toolbarLeft={
          <>
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch('')}
              placeholder="Buscar producto o SKU…"
              className="datatable-search"
              aria-label="Buscar producto"
            />
            <Select
            items={[
              { value: 'all', label: 'Todos los lotes' },
              { value: 'clearance', label: 'En remate' },
              { value: 'expiring', label: 'Por vencer (5 días)' },
              { value: 'voided', label: 'Anulados' },
            ]}
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v ?? 'all')}
          >
            <SelectTrigger style={{ width: '13rem' }} aria-label="Filtrar por estado">
              <SelectValue placeholder="Todos los lotes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los lotes</SelectItem>
              <SelectItem value="clearance">En remate</SelectItem>
              <SelectItem value="expiring">Por vencer (5 días)</SelectItem>
              <SelectItem value="voided">Anulados</SelectItem>
            </SelectContent>
          </Select>
          </>
        }
        empty={
          <EmptyState
            title="Sin existencias en inventario"
            description="Registra tu primer ingreso de stock; los lotes llegarán desde compras."
            action={{ label: 'Nuevo ingreso', onClick: openCreate }}
          />
        }
      />

      <InventoryReceiveDialog key={receiveTarget?.id ?? 'receive'} open={receiveOpen} onOpenChange={setReceiveOpen} preset={receiveTarget} />
      <InventoryAdjustDialog open={!!adjustTarget} onOpenChange={(o) => { if (!o) setAdjustTarget(null); }} batch={adjustTarget} />
      <InventorySettingsDrawer open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ProductsDrawer open={productsOpen} onOpenChange={setProductsOpen} />
      <InventoryMovementsDrawer
        open={!!movementsTarget}
        onOpenChange={(o) => { if (!o) setMovementsTarget(null); }}
        batch={movementsTarget}
      />

      <ConfirmDialog
        open={!!voidTarget}
        onOpenChange={(open) => {
          if (!open) setVoidTarget(null);
        }}
        title="Anular lote"
        confirmLabel="Anular"
        loading={voidStock.isPending}
        onConfirm={() => {
          if (!voidTarget) return;
          voidStock.mutate(
            { batchId: voidTarget.id, reason: 'Anulado por error en el ingreso' },
            {
              onSuccess: () => {
                push({ title: 'Lote anulado', variant: 'success' });
                setVoidTarget(null);
              },
              onError: (err: unknown) => {
                push({ title: 'No se pudo anular el lote', description: err instanceof Error ? err.message : undefined, variant: 'destructive' });
                setVoidTarget(null);
              },
            },
          );
        }}
      />
    </PageContainer>
  );
}
