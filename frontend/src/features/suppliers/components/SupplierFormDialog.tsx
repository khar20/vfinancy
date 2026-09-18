import { z } from 'zod';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/dialog';
import { Button } from '@/components/button';
import { Form, TextField } from '@/components/form';
import type { SupplierDTO } from '@/services/wails-types';
import { useCreateSupplier, useUpdateSupplier } from '@/features/suppliers/hooks/useSuppliers';
import { useNotificationStore } from '@/stores/notification';

export const supplierSchema = z.object({
  name: z.string().trim().min(1, 'Ingrese el nombre del proveedor'),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
});

export type SupplierFormValues = z.infer<typeof supplierSchema>;

const defaults: SupplierFormValues = { name: '', contactName: '', phone: '', email: '', address: '' };

interface SupplierFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  edit?: SupplierDTO | null;
  onSaved?: (id: string) => void;
}

export function SupplierFormDialog({ open, onOpenChange, edit = null, onSaved }: SupplierFormDialogProps) {
  const push = useNotificationStore((s) => s.push);
  const create = useCreateSupplier();
  const update = useUpdateSupplier();
  const saving = create.isPending || update.isPending;

  const formDefaults: SupplierFormValues = edit
    ? {
        name: edit.name,
        contactName: edit.contactName,
        phone: edit.phone,
        email: edit.email,
        address: edit.address,
      }
    : defaults;

  const handleSubmit = (values: SupplierFormValues) => {
    const input = {
      name: values.name,
      contactName: values.contactName ?? '',
      phone: values.phone ?? '',
      email: values.email ?? '',
      address: values.address ?? '',
      status: edit?.isActive ? 'active' : 'inactive',
    };
    const done = () => {
      push({ title: edit ? 'Proveedor actualizado' : 'Proveedor creado', variant: 'success' });
      onOpenChange(false);
    };
    if (edit) {
      update.mutate(
        { id: edit.id, input },
        {
          onSuccess: (s) => {
            onSaved?.(s.id);
            done();
          },
          onError: (err: unknown) => {
            push({ title: 'No se pudo actualizar el proveedor', description: err instanceof Error ? err.message : undefined, variant: 'destructive' });
          },
        },
      );
    } else {
      create.mutate(
        input,
        {
          onSuccess: (s) => {
            onSaved?.(s.id);
            done();
          },
          onError: (err: unknown) => {
            push({ title: 'No se pudo crear el proveedor', description: err instanceof Error ? err.message : undefined, variant: 'destructive' });
          },
        },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{edit ? 'Editar proveedor' : 'Nuevo proveedor'}</DialogTitle>
        </DialogHeader>
        <Form<SupplierFormValues>
          key={edit?.id ?? 'create'}
          schema={supplierSchema}
          defaultValues={formDefaults}
          onSubmit={handleSubmit}
        >
          <DialogBody>
            <TextField name="name" label="Nombre" required />
            <TextField name="contactName" label="Persona de contacto" />
            <TextField name="phone" label="Teléfono" />
            <TextField name="email" label="Correo" type="email" />
            <TextField name="address" label="Dirección" />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              Guardar
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}