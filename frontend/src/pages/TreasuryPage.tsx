import { useMemo, useState } from 'react';
import { CreditCard, Plus, Pencil, Trash2 } from 'lucide-react';
import { PageContainer, PageHeader, Section } from '@/components/layout';
import { Button } from '@/components/button';
import { EmptyState, Spinner } from '@/components/feedback';
import { ConfirmDialog } from '@/components/dialog';
import { Badge } from '@/components/badge';
import { DataTable, type Column } from '@/components/table';
import { RowActions, type RowAction } from '@/components/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/select';
import { SearchInput } from '@/components/input';
import type { CreditCardDTO, CardProjectionDTO } from '@/services/wails-types';
import { useCreditCards, useCardProjections, usePayCard, useDeleteCreditCard } from '@/features/treasury/hooks/useTreasury';
import { CreditCardFormDialog } from '@/features/treasury/components/CreditCardFormDialog';
import { CardPaymentDialog } from '@/features/treasury/components/CardPaymentDialog';
import { formatCurrency, formatDate } from '@/utils/format';
import { useNotificationStore } from '@/stores/notification';

interface CardTarget {
  id: string;
  issuer: string;
  lastFour: string;
  creditLimit: number;
  cutOffDay: number;
  paymentDueDay: number;
  isActive: boolean;
}

function ProjectionStatusBadge({ status }: { status: string }) {
  return status === 'settled' ? (
    <Badge variant="success">Liquidado</Badge>
  ) : (
    <Badge variant="warning">Pendiente</Badge>
  );
}

export function TreasuryPage() {
  const [payTarget, setPayTarget] = useState<CreditCardDTO | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editCard, setEditCard] = useState<CardTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CardTarget | null>(null);
  const [cycleFilter, setCycleFilter] = useState<'all' | 'open' | 'settled'>('all');
  const [search, setSearch] = useState('');
  const [cardSearch, setCardSearch] = useState('');

  const { data: creditCards = [], isLoading: cardsLoading } = useCreditCards();
  const { data: projections = [], isLoading: projectionsLoading } = useCardProjections();
  const payCardMutation = usePayCard();
  const deleteCardMutation = useDeleteCreditCard();
  const push = useNotificationStore((s) => s.push);

  const loading = cardsLoading || projectionsLoading;

  function openCreate() {
    setEditCard(null);
    setFormOpen(true);
  }

  function openEdit(card: CreditCardDTO) {
    setEditCard({
      id: card.id,
      issuer: card.issuer,
      lastFour: card.lastFour,
      creditLimit: card.creditLimit,
      cutOffDay: card.cutOffDay,
      paymentDueDay: card.paymentDueDay,
      isActive: card.isActive,
    });
    setFormOpen(true);
  }

  const buildActions = (row: CreditCardDTO): RowAction[] => [
    {
      label: 'Registrar pago',
      icon: CreditCard,
      disabled: row.currentBalance <= 0,
      onSelect: () => setPayTarget(row),
    },
    {
      label: 'Editar',
      icon: Pencil,
      onSelect: () => openEdit(row),
    },
    {
      label: 'Eliminar',
      icon: Trash2,
      danger: true,
      onSelect: () =>
        setDeleteTarget({
          id: row.id,
          issuer: row.issuer,
          lastFour: row.lastFour,
          creditLimit: row.creditLimit,
          cutOffDay: row.cutOffDay,
          paymentDueDay: row.paymentDueDay,
          isActive: row.isActive,
        }),
    },
  ];

  const cardColumns = useMemo<Column<CreditCardDTO>[]>(
    () => [
      {
        id: 'card',
        header: 'Tarjeta',
        sortable: true,
        cell: (row) => (
          <span className="fw-medium tabular">
            {row.issuer} •••• {row.lastFour}
          </span>
        ),
      },
      {
        id: 'creditLimit',
        header: 'Límite',
        align: 'numeric',
        sortable: true,
        cell: (row) => <span className="tabular">{formatCurrency(row.creditLimit, 'USD')}</span>,
      },
      {
        id: 'currentBalance',
        header: 'Saldo actual',
        align: 'numeric',
        sortable: true,
        cell: (row) => <span className="tabular">{formatCurrency(row.currentBalance, 'USD')}</span>,
      },
      {
        id: 'actions',
        header: '',
        width: 72,
        cell: (row) => (
          <div onClick={(e) => e.stopPropagation()}>
            <RowActions label={`Acciones de ${row.issuer} •••• ${row.lastFour}`} actions={buildActions(row)} />
          </div>
        ),
      },
    ],
    [],
  );

  const filteredCards = useMemo(() => {
    const q = cardSearch.trim().toLowerCase();
    if (!q) return creditCards;
    return creditCards.filter(
      (c) => c.issuer.toLowerCase().includes(q) || c.lastFour.includes(q),
    );
  }, [creditCards, cardSearch]);

  const filteredProjections = useMemo(() => {
    let rows = projections;
    if (cycleFilter !== 'all') rows = rows.filter((p) => p.status === cycleFilter);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((p) => p.issuer.toLowerCase().includes(q) || p.lastFour.includes(q));
    }
    return rows;
  }, [projections, cycleFilter, search]);

  const projectionColumns = useMemo<Column<CardProjectionDTO>[]>(
    () => [
      {
        id: 'paymentDue',
        header: 'Fecha de pago',
        sortable: true,
        cell: (row) => <span className="tabular muted">{formatDate(row.paymentDue)}</span>,
      },
      {
        id: 'card',
        header: 'Tarjeta',
        sortable: true,
        cell: (row) => (
          <span className="fw-medium tabular">
            {row.issuer} •••• {row.lastFour}
          </span>
        ),
      },
      {
        id: 'cycle',
        header: 'Ciclo',
        cell: (row) => (
          <span className="tabular muted">
            {formatDate(row.cycleStart)} – {formatDate(row.cycleEnd)}
          </span>
        ),
      },
      {
        id: 'totalUsd',
        header: 'Total (USD)',
        align: 'numeric',
        sortable: true,
        cell: (row) => (
          <span className="fw-medium tabular">{formatCurrency(row.totalUsd, 'USD')}</span>
        ),
      },
      {
        id: 'refundsUsd',
        header: 'Reintegros (USD)',
        align: 'numeric',
        cell: (row) => <span className="tabular">{formatCurrency(row.refundsUsd, 'USD')}</span>,
      },
      {
        id: 'status',
        header: 'Estado',
        cell: (row) => <ProjectionStatusBadge status={row.status} />,
      },
    ],
    [],
  );

  return (
    <PageContainer>
      <PageHeader
        title="Tesorería"
        subtitle="Tarjetas de crédito, ciclos de facturación y proyección de pagos"
        actions={
          <Button onClick={openCreate}>
            <Plus /> Nueva tarjeta
          </Button>
        }
      />

      <Section
        title="Tarjetas de Crédito"
        description="Deuda vigente por tarjeta en USD. La deuda proyectada del ciclo activo se detalla en la sección de ciclos."
      >
        {loading ? (
          <div className="page-loader">
            <Spinner />
          </div>
        ) : creditCards.length === 0 ? (
          <EmptyState
            title="No hay tarjetas de crédito"
            description="Registra una tarjeta de crédito para ver la proyección de pagos."
            action={{ label: 'Nueva tarjeta', onClick: openCreate }}
          />
        ) : (
          <DataTable
            columns={cardColumns}
            data={filteredCards}
            keyField="id"
            rowActions={buildActions}
            toolbarLeft={
              <SearchInput
                value={cardSearch}
                onChange={(e) => setCardSearch(e.target.value)}
                onClear={() => setCardSearch('')}
                placeholder="Buscar tarjeta…"
                className="datatable-search"
                aria-label="Buscar tarjeta"
              />
            }
          />
        )}
      </Section>

      <Section
        title="Ciclos de facturación"
        description="Proyección del ciclo activo: el monto a separar para cancelar al banco en la fecha de pago sin generar intereses."
      >
        {projections.length === 0 && !projectionsLoading ? (
          <EmptyState
            title="Sin proyecciones"
            description="Registrando compras en tarjetas aparecerá el ciclo activo de cada una."
          />
        ) : (
          <DataTable
            columns={projectionColumns}
            data={filteredProjections}
            keyField="cardId"
            defaultPreferences={{ sort: { id: 'paymentDue', direction: 'asc' } }}
            toolbarLeft={
              <SearchInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClear={() => setSearch('')}
                placeholder="Buscar tarjeta…"
                className="datatable-search"
                aria-label="Buscar tarjeta"
              />
            }
            toolbarRight={
              <Select
                items={[
                  { value: 'all', label: 'Todos los ciclos' },
                  { value: 'open', label: 'Pendientes' },
                  { value: 'settled', label: 'Liquidados' },
                ]}
                value={cycleFilter}
                onValueChange={(v) => setCycleFilter((v ?? 'all') as 'all' | 'open' | 'settled')}
              >
                <SelectTrigger style={{ width: '11rem' }} aria-label="Filtrar ciclos">
                  <SelectValue placeholder="Estado del ciclo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los ciclos</SelectItem>
                  <SelectItem value="open">Pendientes</SelectItem>
                  <SelectItem value="settled">Liquidados</SelectItem>
                </SelectContent>
              </Select>
            }
          />
        )}
      </Section>

      <CreditCardFormDialog open={formOpen} onOpenChange={setFormOpen} editCard={editCard} />

      {payTarget && (
        <CardPaymentDialog
          open
          onOpenChange={(open) => {
            if (!open) setPayTarget(null);
          }}
          card={payTarget}
          loading={payCardMutation.isPending}
          onConfirm={(amount) => {
            payCardMutation.mutate(
              { cardId: payTarget.id, amount },
              {
                onSuccess: () => {
                  push({ title: 'Pago registrado', variant: 'success' });
                  setPayTarget(null);
                },
                onError: (err: unknown) => {
                  push({
                    title: 'No se pudo registrar el pago',
                    description: err instanceof Error ? err.message : undefined,
                    variant: 'destructive',
                  });
                },
              },
            );
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Eliminar tarjeta"
        confirmLabel="Eliminar"
        loading={deleteCardMutation.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteCardMutation.mutate(deleteTarget.id, {
            onSuccess: () => {
              push({ title: 'Tarjeta eliminada', variant: 'success' });
              setDeleteTarget(null);
            },
            onError: (err: unknown) => {
              push({
                title: 'No se pudo eliminar',
                description: err instanceof Error ? err.message : undefined,
                variant: 'destructive',
              });
              setDeleteTarget(null);
            },
          });
        }}
      />
    </PageContainer>
  );
}
