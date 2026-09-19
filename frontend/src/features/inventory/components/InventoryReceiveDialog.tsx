import { useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import {
  Form,
  ProductSelectField,
  DateField,
  NumberField,
  MoneyField,
} from '@/components/form';
import { DialogBody, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/dialog';
import { Button } from '@/components/button';
import { ProductFormDialog } from '@/features/products/components/ProductsDrawer';
import { useReceiveStock } from '@/features/inventory/hooks/useInventory';
import { useNotificationStore } from '@/stores/notification';

import type { InventoryItem } from '@/types/domain';

const ReceiveSchema = z
  .object({
    productId: z.string().min(1, 'Seleccione un producto'),
    arrivalDate: z.string().min(1, 'Fecha requerida').regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido'),
    quantity: z.number().int('Debe ser entero').positive('Cantidad debe ser mayor a 0'),
    unitCost: z.number().min(0, 'Debe ser >= 0'),
  })
  .refine(
    (data) => data.arrivalDate <= today(),
    { path: ['arrivalDate'], message: 'La fecha de ingreso no puede ser posterior a la fecha actual (reloj del sistema).' },
  );

type ReceiveFormValues = z.infer<typeof ReceiveSchema>;

function today(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

interface InventoryReceiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset?: InventoryItem | null;
}

export function InventoryReceiveDialog({ open, onOpenChange, preset }: InventoryReceiveDialogProps) {
  const receive = useReceiveStock();
  const push = useNotificationStore((s) => s.push);
  const [productCreateOpen, setProductCreateOpen] = useState(false);
  const assignProduct = useRef<(id: string) => void>(() => {});

  const defaults = useMemo<ReceiveFormValues>(
    () => ({
      productId: preset?.productId ?? '',
      arrivalDate: today(),
      quantity: 1,
      unitCost: preset?.unitCost ?? 0,
    }),
    [preset],
  );

  const handleSubmit = (values: ReceiveFormValues) => {
    receive.mutate(values, {
      onSuccess: () => {
        push({ title: 'Stock registrado', variant: 'success' });
        onOpenChange(false);
      },
      onError: (err: unknown) => {
        push({
          title: 'No se pudo registrar el ingreso',
          description: err instanceof Error ? err.message : undefined,
          variant: 'destructive',
        });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Ingreso de stock</DialogTitle>
        </DialogHeader>

        <Form key={defaults.productId} schema={ReceiveSchema} defaultValues={defaults} onSubmit={handleSubmit}>
          {({ formState }) => (
            <>
              <DialogBody>
                <ProductSelectField
                  name="productId"
                  label="Producto"
                  required
                  createOption={{
                    label: 'Crear nuevo producto…',
                    onSelect: (assign) => {
                      assignProduct.current = assign;
                      setProductCreateOpen(true);
                    },
                  }}
                />
                <div className="form-grid">
                  <DateField name="arrivalDate" label="Fecha de ingreso" required max={today()} />
                  <NumberField name="quantity" label="Cantidad" required min={1} step={1} />
                </div>
                <MoneyField name="unitCost" label="Costo unitario" />
              </DialogBody>
              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={receive.isPending}>
                  Cancelar
                </Button>
                <Button type="submit" loading={receive.isPending} disabled={!formState.isValid}>
                  Registrar
                </Button>
              </DialogFooter>
            </>
          )}
        </Form>

        <ProductFormDialog
          open={productCreateOpen}
          onOpenChange={setProductCreateOpen}
          product={null}
          onCreated={(p) => assignProduct.current(p.id)}
        />
      </DialogContent>
    </Dialog>
  );
}
