import { useState } from 'react';
import { z } from 'zod';
import { Pencil, Power, Trash2, PackagePlus } from 'lucide-react';
import { Drawer, ListRow, RowActions } from '@/components/misc';
import { Button } from '@/components/button';
import { Badge } from '@/components/badge';
import { SearchInput } from '@/components/input';
import { Spinner, EmptyState } from '@/components/feedback';
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/dialog';
import { Form, TextField, MoneyField, SelectField } from '@/components/form';
import { useDebounce } from '@/hooks/useDebounce';
import { useProducts, useCreateProduct, useUpdateProduct, useDeleteProduct, useSetProductActive } from '@/features/products/hooks/useProducts';
import type { ProductDTO } from '@/services/wails-types';
import { formatCurrency } from '@/utils/format';
import { useNotificationStore } from '@/stores/notification';

const unitCodes = [
  { value: 'Unidad', label: 'Unidad' },
  { value: 'NIU', label: 'NIU — Unidad (bienes)' },
  { value: 'KGM', label: 'KGM — Kilogramo' },
  { value: 'LTR', label: 'LTR — Litro' },
  { value: 'MTR', label: 'MTR — Metro' },
  { value: 'BX', label: 'BX — Caja' },
  { value: 'PK', label: 'PK — Paquete' },
  { value: 'SET', label: 'SET — Juego' },
  { value: 'ZZ', label: 'ZZ — Servicio' },
];

const productSchema = z.object({
  description: z.string().trim().min(1, 'Ingrese la descripción del producto.'),
  sku: z.string().trim().optional(),
  unitCode: z.string().min(1, 'Seleccione la unidad de medida.'),
  costUsd: z.number().min(0, 'No puede ser negativo.'),
  salePrice: z.number().min(0, 'No puede ser negativo.'),
});

type ProductValues = z.infer<typeof productSchema>;

export function ProductFormDialog({
  open,
  onOpenChange,
  product,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductDTO | null;
  onCreated?: (product: ProductDTO) => void;
}) {
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const push = useNotificationStore((s) => s.push);
  const isEditing = Boolean(product);
  const pending = create.isPending || update.isPending;
  const values: ProductValues = {
    description: product?.description ?? '',
    sku: product?.sku ?? '',
    unitCode: product?.unitCode ?? 'Unidad',
    costUsd: product?.costUsd ?? 0,
    salePrice: product?.salePrice ?? 0,
  };

  async function submit(input: ProductValues) {
    try {
      if (isEditing && product) {
        await update.mutateAsync({ id: product.id, ...input });
        push({ title: 'Producto actualizado', variant: 'success' });
      } else {
        const created = await create.mutateAsync(input);
        push({ title: 'Producto creado', variant: 'success' });
        onCreated?.(created);
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
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar producto' : 'Nuevo producto'}</DialogTitle>
        </DialogHeader>
        <Form<ProductValues> key={product?.id ?? 'new'} schema={productSchema} defaultValues={values} onSubmit={submit}>
          {({ formState }) => (
            <>
              <DialogBody>
                <TextField name="description" label="Descripción" required />
                <TextField
                  name="sku"
                  label="SKU"
                  description="Opcional: déjalo vacío para generarlo automáticamente."
                />
                <SelectField name="unitCode" label="Unidad de medida" required options={unitCodes} clearable={false} />
                <MoneyField name="costUsd" label="Costo (USD)" currency="USD" />
                <MoneyField name="salePrice" label="Precio de venta (PEN)" currency="PEN" />
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

export function ProductsDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput);
  const { data, isLoading, isError, refetch } = useProducts({ search });
  const remove = useDeleteProduct();
  const setActive = useSetProductActive();
  const push = useNotificationStore((s) => s.push);

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ProductDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProductDTO | null>(null);

  const products = data?.items ?? [];

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={onOpenChange}
        title="Productos"
        footer={
          <Button
            onClick={() => {
              setEditTarget(null);
              setFormOpen(true);
            }}
          >
            <PackagePlus /> Nuevo producto
          </Button>
        }
      >
        <div className="stack">
          <SearchInput
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onClear={() => setSearchInput('')}
            placeholder="Buscar por SKU o descripción…"
            aria-label="Buscar producto"
          />
          {isLoading ? (
            <Spinner />
          ) : isError ? (
            <EmptyState title="No se pudo cargar" description="No se pudieron cargar los productos." action={{ label: 'Reintentar', onClick: () => refetch() }} />
          ) : products.length === 0 ? (
            <EmptyState
              title="Sin productos"
              description="Registra un producto o créalo desde una orden de compra."
              action={{ label: 'Nuevo producto', onClick: () => setFormOpen(true) }}
            />
          ) : (
            products.map((p) => (
              <ListRow
                key={p.id}
                title={p.description}
                meta={`${p.sku} · Costo ${formatCurrency(p.costUsd, 'USD')} · Venta ${formatCurrency(p.salePrice)}`}
                trailing={
                  <div className="hstack hstack--sm">
                    {!p.isActive && <Badge variant="muted">Inactivo</Badge>}
                    <RowActions
                      label={`Acciones de ${p.description}`}
                      actions={[
                        {
                          label: p.isActive ? 'Desactivar' : 'Activar',
                          icon: Power,
                          onSelect: () =>
                            setActive.mutate(
                              { id: p.id, active: !p.isActive },
                              {
                                onSuccess: () =>
                                  push({ title: p.isActive ? 'Producto desactivado' : 'Producto activado', variant: 'success' }),
                                onError: (err) =>
                                  push({
                                    title: 'No se pudo actualizar',
                                    description: err instanceof Error ? err.message : undefined,
                                    variant: 'destructive',
                                  }),
                              },
                            ),
                        },
                        {
                          label: 'Editar',
                          icon: Pencil,
                          onSelect: () => {
                            setEditTarget(p);
                            setFormOpen(true);
                          },
                        },
                        {
                          label: 'Eliminar',
                          icon: Trash2,
                          danger: true,
                          onSelect: () => setDeleteTarget(p),
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

      <ProductFormDialog open={formOpen} onOpenChange={setFormOpen} product={editTarget} />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        title="Eliminar producto"
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          remove.mutate(deleteTarget.id, {
            onSuccess: () => {
              push({ title: 'Producto eliminado', variant: 'success' });
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
