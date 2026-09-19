import { useState } from 'react';
import { z } from 'zod';
import { Pencil, Trash2, UserPlus } from 'lucide-react';
import { Drawer, ListRow, RowActions } from '@/components/misc';
import { Button } from '@/components/button';
import { Badge } from '@/components/badge';
import { SearchInput } from '@/components/input';
import { Spinner, EmptyState } from '@/components/feedback';
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/dialog';
import { Form, TextField, EmailField, SelectField } from '@/components/form';
import { useDebounce } from '@/hooks/useDebounce';
import {
  useCustomers,
  useCreateCustomer,
  useUpdateCustomer,
  useDeleteCustomer,
} from '@/features/customers/hooks/useCustomers';
import type { CustomerDTO } from '@/services/wails-types';
import { formatCurrency } from '@/utils/format';
import { useNotificationStore } from '@/stores/notification';

const documentTypes = [
  { value: '', label: 'Sin documento' },
  { value: 'DNI', label: 'DNI' },
  { value: 'RUC', label: 'RUC' },
];

const customerSchema = z
  .object({
    businessName: z.string().trim().min(1, 'Ingrese el nombre o razón social.'),
    documentType: z.enum(['', 'DNI', 'RUC']),
    documentNumber: z.string().optional().or(z.literal('')),
    email: z.string().email('Correo inválido.').optional().or(z.literal('')),
    phone: z.string().optional().or(z.literal('')),
    address: z.string().optional().or(z.literal('')),
  })
  .superRefine((v, ctx) => {
    const num = (v.documentNumber ?? '').trim();
    if (v.documentType === '') {
      if (num) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['documentNumber'], message: 'Seleccione el tipo de documento.' });
      }
      return;
    }
    if (v.documentType === 'DNI' && !/^\d{8}$/.test(num)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['documentNumber'], message: 'El DNI debe tener 8 dígitos.' });
    }
    if (v.documentType === 'RUC' && !/^(10|20)\d{9}$/.test(num)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['documentNumber'], message: 'El RUC debe tener 11 dígitos e iniciar con 10 o 20.' });
    }
  });

type CustomerValues = z.infer<typeof customerSchema>;

function defaultValues(customer?: CustomerDTO | null): CustomerValues {
  return {
    businessName: customer?.businessName ?? '',
    documentType: (customer?.documentType || '') as CustomerValues['documentType'],
    documentNumber: customer?.documentNumber ?? '',
    email: customer?.email ?? '',
    phone: customer?.phone ?? '',
    address: customer?.address ?? '',
  };
}

function CustomerFormDialog({
  open,
  onOpenChange,
  customer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: CustomerDTO | null;
}) {
  const create = useCreateCustomer();
  const update = useUpdateCustomer();
  const push = useNotificationStore((s) => s.push);
  const isEditing = Boolean(customer);
  const pending = create.isPending || update.isPending;
  const values = defaultValues(customer);

  async function submit(v: CustomerValues) {
    const input = {
      businessName: v.businessName,
      documentType: v.documentType,
      documentNumber: v.documentNumber ?? '',
      email: v.email ?? '',
      phone: v.phone ?? '',
      address: v.address ?? '',
    };
    try {
      if (isEditing && customer) {
        await update.mutateAsync({ id: customer.id, ...input });
        push({ title: 'Cliente actualizado', variant: 'success' });
      } else {
        await create.mutateAsync(input);
        push({ title: 'Cliente creado', variant: 'success' });
      }
      onOpenChange(false);
    } catch (err) {
      push({
        title: isEditing ? 'No se pudo actualizar' : 'No se pudo crear',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar cliente' : 'Nuevo cliente'}</DialogTitle>
        </DialogHeader>
        <Form<CustomerValues> key={customer?.id ?? 'new'} schema={customerSchema} defaultValues={values} onSubmit={submit}>
          {({ formState }) => (
            <>
              <DialogBody>
                <div className="form-grid">
                  <TextField name="businessName" label="Nombre / Razón social" required className="form-grid__wide" />
                  <SelectField name="documentType" label="Tipo de documento" options={documentTypes} clearable={false} />
                  <TextField name="documentNumber" label="Número de documento" />
                  <EmailField name="email" label="Correo" />
                  <TextField name="phone" label="Teléfono" />
                  <TextField name="address" label="Dirección" className="form-grid__wide" />
                </div>
              </DialogBody>
              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={pending}>
                  Cancelar
                </Button>
                <Button type="submit" loading={pending} disabled={!formState.isValid}>
                  Guardar
                </Button>
              </DialogFooter>
            </>
          )}
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function CustomersDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput);
  const { data, isLoading, isError, refetch } = useCustomers({ search, pageSize: 100 });
  const remove = useDeleteCustomer();
  const push = useNotificationStore((s) => s.push);

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CustomerDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomerDTO | null>(null);

  const customers = data?.items ?? [];

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={onOpenChange}
        title="Clientes"
        footer={
          <Button
            onClick={() => {
              setEditTarget(null);
              setFormOpen(true);
            }}
          >
            <UserPlus /> Nuevo cliente
          </Button>
        }
      >
        <div className="stack">
          <SearchInput
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onClear={() => setSearchInput('')}
            placeholder="Buscar por nombre o documento…"
            aria-label="Buscar cliente"
          />
          {isLoading ? (
            <Spinner />
          ) : isError ? (
            <EmptyState title="No se pudo cargar" description="No se pudieron cargar los clientes." action={{ label: 'Reintentar', onClick: () => refetch() }} />
          ) : customers.length === 0 ? (
            <EmptyState
              title="Sin clientes"
              description="Registra tu primer cliente para asociarlo a las ventas."
              action={{ label: 'Nuevo cliente', onClick: () => setFormOpen(true) }}
            />
          ) : (
            customers.map((c) => (
              <ListRow
                key={c.id}
                title={c.businessName}
                meta={
                  c.documentNumber
                    ? `${c.documentType} ${c.documentNumber}${c.currentDebt > 0 ? ` · Deuda ${formatCurrency(c.currentDebt)}` : ''}`
                    : `Sin documento${c.currentDebt > 0 ? ` · Deuda ${formatCurrency(c.currentDebt)}` : ''}`
                }
                trailing={
                  <div className="hstack hstack--sm">
                    {c.status !== 'active' && <Badge variant="muted">Inactivo</Badge>}
                    <RowActions
                      label={`Acciones de ${c.businessName}`}
                      actions={[
                        {
                          label: 'Editar',
                          icon: Pencil,
                          onSelect: () => {
                            setEditTarget(c);
                            setFormOpen(true);
                          },
                        },
                        {
                          label: 'Eliminar',
                          icon: Trash2,
                          danger: true,
                          onSelect: () => setDeleteTarget(c),
                        },
                      ]}
                    />
                  </div>
                }
              />
            ))
          )}
        </div>
      </Drawer>

      <CustomerFormDialog open={formOpen} onOpenChange={setFormOpen} customer={editTarget} />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        title="Eliminar cliente"
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          remove.mutate(deleteTarget.id, {
            onSuccess: () => {
              push({ title: 'Cliente eliminado', variant: 'success' });
              setDeleteTarget(null);
            },
            onError: (err) => {
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
    </>
  );
}
