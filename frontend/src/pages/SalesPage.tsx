import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShoppingCart, CreditCard, Ban, Plus, ReceiptText, Eye, Users } from 'lucide-react';
import { PageContainer, PageHeader, StatBand } from '@/components/layout';
import { StatCard } from '@/components/card';
import { DataTable, type Column } from '@/components/table';
import { SaleStatusBadge } from '@/components/badge';
import { SearchInput } from '@/components/input';
import { EmptyState, Spinner } from '@/components/feedback';
import { Button } from '@/components/button';
import { CancelDialog } from '@/components/dialog';
import { RegisterPaymentDialog, type RegisterPaymentInput } from '@/features/treasury/components/RegisterPaymentDialog';
import { ListRow, RowActions, type RowAction, Drawer } from '@/components/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/select';
import { useSales, useCancelSale, useCollectSalePayment } from '@/features/sales/hooks/useSales';
import { SaleFormDialog } from '@/features/sales/components/SaleFormDialog';
import { CustomersDrawer } from '@/features/customers/components/CustomersDrawer';
import { wailsClient } from '@/services/bindings';
import { PaymentMethodOptions } from '@/constants/paymentMethods';
import type { Sale } from '@/types/domain';
import { formatCurrency, formatDate, formatNumber } from '@/utils/format';
import { useNotificationStore } from '@/stores/notification';

const columns: Column<Sale>[] = [
  {
    id: 'date',
    header: 'Fecha de venta',
    sortable: true,
    cell: (row) => <span className="tabular muted">{formatDate(row.date)}</span>,
  },
  {
    id: 'number',
    header: 'Número',
    sortable: true,
    cell: (row) => <span className="fw-medium tabular">{row.number}</span>,
  },
  { id: 'customerName', header: 'Cliente', sortable: true, cell: (row) => row.customerName || '—' },
  {
    id: 'status',
    header: 'Estado',
    cell: (row) => <SaleStatusBadge status={row.status} />,
  },
  {
    id: 'total',
    header: 'Total',
    align: 'numeric',
    sortable: true,
    cell: (row) => <span className="fw-medium tabular">{formatCurrency(row.total)}</span>,
  },
  {
    id: 'profit',
    header: 'Utilidad',
    align: 'numeric',
    cell: (row) => (
      <span className={row.profit >= 0 ? 'tabular' : 'tabular text-destructive'}>
        {formatCurrency(row.profit)}
      </span>
    ),
  },
];

const methodLabel = (code: string) =>
  PaymentMethodOptions.find((o) => o.value === code)?.label ?? code;

export function SalesPage() {
  const { data, isLoading, isError, error, refetch } = useSales();
  const cancel = useCancelSale();
  const collect = useCollectSalePayment();
  const push = useNotificationStore((s) => s.push);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [customersOpen, setCustomersOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Sale | null>(null);
  const [collectTarget, setCollectTarget] = useState<Sale | null>(null);
  const [historyTarget, setHistoryTarget] = useState<Sale | null>(null);
  const [detailTarget, setDetailTarget] = useState<Sale | null>(null);

  const detailQuery = useQuery({
    queryKey: ['sale-detail', detailTarget?.id],
    queryFn: () => wailsClient.getSale(detailTarget!.id),
    enabled: Boolean(detailTarget),
  });

  const paymentsQuery = useQuery({
    queryKey: ['sale-payments', historyTarget?.id],
    queryFn: () => wailsClient.listSalePayments({ page: 1, pageSize: 100 }, '', historyTarget!.id),
    enabled: Boolean(historyTarget),
  });

  const sales = data ?? [];
  const filtered = useMemo(() => {
    let rows = sales;
    if (statusFilter !== 'all') rows = rows.filter((x) => x.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (x) =>
          x.number.toLowerCase().includes(q) ||
          (x.customerName ?? '').toLowerCase().includes(q),
      );
    }
    return rows;
  }, [sales, statusFilter, search]);

  const totalAmount = sales.reduce((s, x) => s + x.total, 0);
  const totalProfit = sales.reduce((s, x) => s + x.profit, 0);
  const pending = sales.filter((x) => x.status === 'pending' || x.status === 'partial').length;

  const openCreate = () => setFormOpen(true);

  const buildActions = (row: Sale): RowAction[] => {
    const collectable = row.status === 'pending' || row.status === 'partial';
    const cancellable = row.status !== 'cancelled';
    const actions: RowAction[] = [
      { label: 'Ver detalle', icon: Eye, onSelect: () => setDetailTarget(row) },
      { label: 'Cobros', icon: ReceiptText, onSelect: () => setHistoryTarget(row) },
    ];
    if (collectable) {
      actions.push({ label: 'Cobrar', icon: CreditCard, onSelect: () => setCollectTarget(row) });
    }
    if (cancellable) {
      actions.push({ label: 'Anular', icon: Ban, danger: true, onSelect: () => setCancelTarget(row) });
    }
    return actions;
  };

  const tableColumns = useMemo<Column<Sale>[]>(() => {
    return [
      ...columns,
      {
        id: 'actions',
        header: '',
        width: 72,
        cell: (row) => (
          <div onClick={(e) => e.stopPropagation()}>
            <RowActions actions={buildActions(row)} label={`Acciones de ${row.number}`} />
          </div>
        ),
      },
    ];
  }, []);

  return (
    <PageContainer>
      <PageHeader
        title="Ventas"
        actions={
          <div className="hstack hstack--sm">
            <Button variant="outline" onClick={() => setCustomersOpen(true)}>
              <Users /> Clientes
            </Button>
            <Button onClick={openCreate}>
              <Plus /> Nueva venta
            </Button>
          </div>
        }
      />

      <StatBand>
        <StatCard label="Ventas registradas" value={String(sales.length)} icon={ShoppingCart} />
        <StatCard label="Monto total" value={formatCurrency(totalAmount)} />
        <StatCard label="Utilidad" value={formatCurrency(totalProfit)} />
        <StatCard label="Por Cobrar" value={String(pending)} />
      </StatBand>

      <DataTable
        columns={tableColumns}
        data={filtered}
        keyField="id"
        loading={isLoading}
        error={isError ? (error as Error) : null}
        onRetry={() => refetch()}
        onRowClick={(row) => setDetailTarget(row)}
        rowActions={buildActions}
        preferencesKey="sales-journal"
        defaultPreferences={{ sort: { id: 'date', direction: 'desc' } }}
        toolbarLeft={
          <>
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch('')}
              placeholder="Buscar venta…"
              className="datatable-search"
              aria-label="Buscar venta"
            />
            <Select
              items={[
                { value: 'all', label: 'Todos' },
                { value: 'pending', label: 'Pendientes' },
                { value: 'partial', label: 'Parciales' },
                { value: 'paid', label: 'Pagadas' },
                { value: 'cancelled', label: 'Anuladas' },
              ]}
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v ?? 'all')}
            >
              <SelectTrigger style={{ width: '11rem' }} aria-label="Filtrar por estado">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pending">Pendientes</SelectItem>
                <SelectItem value="partial">Parciales</SelectItem>
                <SelectItem value="paid">Pagadas</SelectItem>
                <SelectItem value="cancelled">Anuladas</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        empty={
          <EmptyState
            title="No hay ventas registradas"
            description="Registra tu primera venta para llevar el control de cobranza y utilidad."
            action={{ label: 'Nueva venta', onClick: openCreate }}
          />
        }
      />

      <SaleFormDialog open={formOpen} onOpenChange={setFormOpen} />
      <CustomersDrawer open={customersOpen} onOpenChange={setCustomersOpen} />

      <RegisterPaymentDialog
        open={!!collectTarget}
        onOpenChange={(open) => {
          if (!open) setCollectTarget(null);
        }}
        title="Cobrar venta"
        documentNumber={collectTarget?.number ?? ''}
        amount={collectTarget?.balance ?? 0}
        amountLabel="Saldo pendiente"
        confirmLabel="Cobrar"
        amountEditable
        loading={collect.isPending}
        onConfirm={(input: RegisterPaymentInput) => {
          if (!collectTarget) return;
          collect.mutate(
            {
              saleId: collectTarget.id,
              input: {
                amount: input.amount,
                paymentMethod: (PaymentMethodOptions.some((o) => o.value === input.method)
                  ? input.method
                  : 'other') as 'cash' | 'transfer' | 'other',
                reference: input.reference,
                date: input.paymentDate,
              },
            },
            {
              onSuccess: () => {
                push({ title: 'Cobro registrado', variant: 'success' });
                setCollectTarget(null);
              },
              onError: (err: unknown) => {
                push({
                  title: 'No se pudo registrar el cobro',
                  description: err instanceof Error ? err.message : undefined,
                  variant: 'destructive',
                });
              },
            },
          );
        }}
      />

      <CancelDialog
        key={cancelTarget?.id ?? 'cancel'}
        open={!!cancelTarget}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        title="Anular venta"
        loading={cancel.isPending}
        onConfirm={(reason) => {
          if (!cancelTarget) return;
          cancel.mutate(
            { id: cancelTarget.id, reason },
            {
              onSuccess: () => {
                push({ title: 'Venta anulada', variant: 'success' });
                setCancelTarget(null);
              },
              onError: (err: unknown) => {
                push({
                  title: 'No se pudo anular la venta',
                  description: err instanceof Error ? err.message : undefined,
                  variant: 'destructive',
                });
                setCancelTarget(null);
              },
            },
          );
        }}
      />

      <Drawer
        open={!!historyTarget}
        onOpenChange={(open) => {
          if (!open) setHistoryTarget(null);
        }}
        title="Historial de cobros"
        description={
          historyTarget ? `${historyTarget.number} · ${historyTarget.customerName}` : undefined
        }
        footer={
          <div className="hstack hstack--sm" style={{ justifyContent: 'flex-end' }}>
            <Button variant="outline" onClick={() => setHistoryTarget(null)}>
              Cerrar
            </Button>
            {(historyTarget?.status === 'pending' || historyTarget?.status === 'partial') && (
              <Button
                onClick={() => {
                  setCollectTarget(historyTarget);
                  setHistoryTarget(null);
                }}
              >
                <CreditCard /> Cobrar
              </Button>
            )}
          </div>
        }
      >
        {historyTarget && (
          <div className="stack">
            <div className="doc-summary">
              <div className="doc-summary__row">
                <div className="doc-summary__meta">
                  Total · <span className="doc-summary__doc-number">{historyTarget.number}</span>
                </div>
                <div className="doc-summary__amount">{formatCurrency(historyTarget.total)}</div>
              </div>
              <div className="doc-summary__row">
                <div className="doc-summary__meta">Pagado</div>
                <div className="doc-summary__amount">{formatCurrency(historyTarget.paid)}</div>
              </div>
              <div className="doc-summary__row">
                <div className="doc-summary__meta">Saldo</div>
                <div className="doc-summary__amount">{formatCurrency(historyTarget.balance)}</div>
              </div>
              {historyTarget.dueDate && (
                <div className="doc-summary__row">
                  <div className="doc-summary__meta">Vence</div>
                  <div className="doc-summary__amount">{formatDate(historyTarget.dueDate)}</div>
                </div>
              )}
            </div>

            {paymentsQuery.isLoading ? (
              <Spinner />
            ) : paymentsQuery.isError ? (
              <EmptyState title="No se pudo cargar" description="No se pudieron cargar los cobros de esta venta." />
            ) : paymentsQuery.data && paymentsQuery.data.items.length > 0 ? (
              <div className="stack">
                {paymentsQuery.data.items.map((p) => (
                  <ListRow
                    key={p.id}
                    title={
                      <>
                        {p.number} · {methodLabel(p.paymentMethod)}
                      </>
                    }
                    meta={
                      <>
                        {formatDate(p.paymentDate)}
                        {p.reference ? ` · ${p.reference}` : ''}
                      </>
                    }
                    trailing={<span>{formatCurrency(Number(p.amount))}</span>}
                  />
                ))}
              </div>
            ) : (
              <EmptyState title="Sin cobros" description="Esta venta aún no tiene cobros registrados." />
            )}
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!detailTarget}
        onOpenChange={(open) => {
          if (!open) setDetailTarget(null);
        }}
        title="Detalle de venta"
        description={detailTarget ? `${detailTarget.number} · ${detailTarget.customerName}` : undefined}
      >
        {detailTarget &&
          (detailQuery.isLoading ? (
            <Spinner />
          ) : detailQuery.isError ? (
            <EmptyState title="No se pudo cargar" description="No se pudo cargar el detalle de la venta." />
          ) : detailQuery.data ? (
            <div className="stack">
              <div className="doc-summary">
                <div className="doc-summary__row">
                  <div className="doc-summary__meta">Fecha</div>
                  <div className="doc-summary__amount">{formatDate(detailQuery.data.saleDate)}</div>
                </div>
                {detailQuery.data.dueDate && (
                  <div className="doc-summary__row">
                    <div className="doc-summary__meta">Vence</div>
                    <div className="doc-summary__amount">{formatDate(detailQuery.data.dueDate)}</div>
                  </div>
                )}
                <div className="doc-summary__row">
                  <div className="doc-summary__meta">Estado</div>
                  <div className="doc-summary__amount">
                    <SaleStatusBadge status={detailQuery.data.status as Sale['status']} />
                  </div>
                </div>
                <div className="doc-summary__row">
                  <div className="doc-summary__meta">Total</div>
                  <div className="doc-summary__amount">{formatCurrency(detailQuery.data.total)}</div>
                </div>
                <div className="doc-summary__row">
                  <div className="doc-summary__meta">Pagado</div>
                  <div className="doc-summary__amount">{formatCurrency(detailQuery.data.paidAmount)}</div>
                </div>
                <div className="doc-summary__row">
                  <div className="doc-summary__meta">Costo</div>
                  <div className="doc-summary__amount">{formatCurrency(detailQuery.data.costTotal)}</div>
                </div>
                <div className="doc-summary__row">
                  <div className="doc-summary__meta">Utilidad</div>
                  <div className="doc-summary__amount">{formatCurrency(detailQuery.data.profit)}</div>
                </div>
              </div>
              {detailQuery.data.notes && <p className="muted">{detailQuery.data.notes}</p>}
              {detailQuery.data.cancelledReason && (
                <p className="field-hint">Anulada: {detailQuery.data.cancelledReason}</p>
              )}
              <div className="stack">
                {detailQuery.data.items.map((it) => (
                  <ListRow
                    key={it.id}
                    title={it.description}
                    meta={
                      <>
                        {formatNumber(it.quantity)} × {formatCurrency(it.unitPrice)}
                      </>
                    }
                    trailing={<span className="tabular">{formatCurrency(it.lineTotal)}</span>}
                  />
                ))}
              </div>
            </div>
          ) : null)}
      </Drawer>
    </PageContainer>
  );
}
