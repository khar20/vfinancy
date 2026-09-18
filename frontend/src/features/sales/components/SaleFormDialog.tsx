import { useRef, useState } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { ArrowLeft, ArrowRight, Plus, Trash2 } from 'lucide-react';
import {
  Form,
  DateField,
  MoneyField,
  NumberField,
  SelectField,
  TextareaField,
  type CreateSelectOption,
  type SelectOption,
} from '@/components/form';
import type { FieldPath } from 'react-hook-form';
import { DialogBody, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/dialog';
import { Button } from '@/components/button';
import { Input } from '@/components/input';
import { CreateCustomerDialog } from '@/features/customers/components/CreateCustomerDialog';
import { ProductFormDialog } from '@/features/products/components/ProductsDrawer';
import { useCreateSale } from '@/features/sales/hooks/useSales';
import { useProducts } from '@/features/products/hooks/useProducts';
import { wailsClient } from '@/services/bindings';
import { queryKeys } from '@/services/queryKeys';
import { PaymentMethodOptions } from '@/constants/paymentMethods';
import { useNotificationStore } from '@/stores/notification';
import { formatCurrency } from '@/utils/format';

const SaleFormSchema = z
  .object({
    customerId: z.string().min(1, 'Seleccione un cliente'),
    saleType: z.enum(['stock', 'client_order']),
    date: z.string().min(1, 'Fecha requerida').regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido'),
    paymentTerms: z.enum(['contado', 'credito']),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido').optional().or(z.literal('')),
    paymentMethod: z.enum(['cash', 'transfer', 'other']),
    initialPayment: z.number().min(0, 'No puede ser negativo'),
    notes: z.string().optional(),
    items: z
      .array(
        z.object({
          productId: z.string().min(1, 'Seleccione un producto'),
          quantity: z.number().int('Debe ser entero').positive('Cantidad debe ser mayor a 0'),
          unitPrice: z.number().min(0.01, 'Ingrese el precio de venta'),
        }),
      )
      .min(1, 'Agregue al menos una línea'),
  })
  .superRefine((data, ctx) => {
    if (data.paymentTerms === 'credito') {
      if (!data.dueDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dueDate'],
          message: 'Fecha de vencimiento obligatoria en ventas al crédito.',
        });
      } else if (data.date && data.dueDate < data.date) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dueDate'],
          message: 'La fecha de vencimiento debe ser igual o posterior a la fecha de venta.',
        });
      }
    }
    const total = round2(data.items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0));
    if (data.initialPayment > total) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['initialPayment'],
        message: 'El pago inicial no puede superar el total de la venta.',
      });
    }
  });

type SaleFormValues = z.infer<typeof SaleFormSchema>;

const round2 = (value: number): number => Math.round(value * 100) / 100;

function today(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

interface SegmentedChoiceProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  ariaLabel: string;
}

function SegmentedChoice({ value, onChange, options, ariaLabel }: SegmentedChoiceProps) {
  return (
    <div className="hstack" role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => (
        <Button
          key={opt.value}
          type="button"
          variant={value === opt.value ? 'primary' : 'outline'}
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}

interface SaleLinesProps {
  productOptions: SelectOption[];
  priceById: Map<string, number>;
  productCreateOption?: CreateSelectOption;
}

function SaleLines({ productOptions, priceById, productCreateOption }: SaleLinesProps) {
  const { control, watch, setValue } = useFormContext<SaleFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const rows = watch('items');

  const total = round2(
    (rows ?? []).reduce((sum, it) => sum + (it.unitPrice ?? 0) * (it.quantity ?? 0), 0),
  );

  return (
    <div className="line-items">
      {fields.map((field, index) => {
        const row = rows?.[index];
        const lineTotal = round2((row?.unitPrice ?? 0) * (row?.quantity ?? 0));
        return (
          <div key={field.id} className="line-item">
            <div className="line-item__head">
              <div className="line-item__field">
                <SelectField
                  name={`items.${index}.productId` as FieldPath<SaleFormValues>}
                  label={`Producto ${index + 1}`}
                  required
                  options={productOptions}
                  clearable={false}
                  createOption={productCreateOption}
                  onChange={(v) => {
                    const price = priceById.get(v);
                    if (price) {
                      setValue(`items.${index}.unitPrice` as FieldPath<SaleFormValues>, price);
                    }
                  }}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="line-item__remove"
                aria-label={`Quitar línea ${index + 1}`}
                onClick={() => remove(index)}
              >
                <Trash2 />
              </Button>
            </div>
            <div className="grid-2">
              <NumberField
                name={`items.${index}.quantity` as FieldPath<SaleFormValues>}
                label="Cantidad"
                required
                min={1}
                step={1}
              />
              <MoneyField
                name={`items.${index}.unitPrice` as FieldPath<SaleFormValues>}
                label="Precio unitario"
                currency="PEN"
              />
            </div>
            <p className="field-hint tabular">Total de línea: {formatCurrency(lineTotal)}</p>
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => append({ productId: '', quantity: 1, unitPrice: 0 })}
      >
        <Plus /> Agregar línea
      </Button>

      <div className="line-items-totals">
        <div className="totals-row totals-row--total">
          <span>Total</span>
          <span className="tabular">{formatCurrency(total)}</span>
        </div>
      </div>
    </div>
  );
}

function CartStep({ productOptions, priceById, productCreateOption }: SaleLinesProps) {
  const { control, setValue } = useFormContext<SaleFormValues>();
  const saleType = useWatch({ control, name: 'saleType' });
  return (
    <div className="stack">
      <div className="field">
        <span className="label">Tipo de venta</span>
        <SegmentedChoice
          ariaLabel="Tipo de venta"
          value={saleType}
          onChange={(v) => setValue('saleType', v as SaleFormValues['saleType'])}
          options={[
            { value: 'stock', label: 'General (stock)' },
            { value: 'client_order', label: 'Pedido de Cliente' },
          ]}
        />
        {saleType === 'stock' && (
          <p className="field-hint">
            El stock disponible se valida al guardar; un producto sin stock bloquea la venta general.
          </p>
        )}
      </div>
      <SaleLines productOptions={productOptions} priceById={priceById} productCreateOption={productCreateOption} />
    </div>
  );
}

function PaymentStep() {
  const { control, watch, setValue } = useFormContext<SaleFormValues>();
  const paymentTerms = useWatch({ control, name: 'paymentTerms' });
  const items = useWatch({ control, name: 'items' });
  const date = watch('date');
  const total = round2(
    (items ?? []).reduce((sum, it) => sum + (it.unitPrice ?? 0) * (it.quantity ?? 0), 0),
  );

  return (
    <div className="form-grid">
      <div className="field form-grid__wide">
        <span className="label">Condición de pago</span>
        <SegmentedChoice
          ariaLabel="Condición de pago"
          value={paymentTerms}
          onChange={(v) => {
            setValue('paymentTerms', v as SaleFormValues['paymentTerms']);
            if (v === 'contado') setValue('dueDate', '');
          }}
          options={[
            { value: 'contado', label: 'Contado' },
            { value: 'credito', label: 'Crédito' },
          ]}
        />
      </div>
      <SelectField
        name="paymentMethod"
        label="Método de pago"
        required
        options={PaymentMethodOptions}
        clearable={false}
      />
      {paymentTerms === 'credito' && (
        <>
          <DateField name="dueDate" label="Fecha de vencimiento" min={date} required />
          <MoneyField
            name="initialPayment"
            label="Pago inicial (opcional)"
            currency="PEN"
            description={`Déjalo en S/ 0.00 para no registrar cobro. Máximo ${formatCurrency(total)}`}
          />
        </>
      )}
      {paymentTerms === 'contado' && (
        <p className="field-hint form-grid__wide">
          Contado: se registrará un cobro inicial automático de{' '}
          <span className="tabular">{formatCurrency(total)}</span>.
        </p>
      )}
      <TextareaField name="notes" label="Notas" rows={2} className="form-grid__wide" />
    </div>
  );
}

interface SaleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SaleFormDialog({ open, onOpenChange }: SaleFormDialogProps) {
  const create = useCreateSale();
  const push = useNotificationStore((s) => s.push);
  const productsQuery = useProducts();
  const customersQuery = useQuery({
    queryKey: queryKeys.customers.options,
    queryFn: () => wailsClient.customerOptions(),
  });

  const customerOptions: SelectOption[] = (customersQuery.data ?? []).map((c) => ({
    value: c.id,
    label: c.businessName,
  }));
  const priceById = new Map(
    (productsQuery.data?.items ?? []).map((p) => [p.id, p.salePrice]),
  );
  const productOptions: SelectOption[] = (productsQuery.data?.items ?? []).map((p) => ({
    value: p.id,
    label: `${p.sku} — ${p.description}`,
  }));

  const defaults: SaleFormValues = {
    customerId: '',
    saleType: 'stock',
    date: today(),
    paymentTerms: 'contado',
    dueDate: '',
    paymentMethod: 'cash',
    initialPayment: 0,
    notes: '',
    items: [{ productId: '', quantity: 1, unitPrice: 0 }],
  };

  const [step, setStep] = useState(0);
  const [stockError, setStockError] = useState<string | null>(null);
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const assignCustomer = useRef<(id: string) => void>(() => {});
  const [productCreateOpen, setProductCreateOpen] = useState(false);
  const assignProduct = useRef<(id: string) => void>(() => {});
  const productCreateOption: CreateSelectOption = {
    label: 'Crear nuevo producto…',
    onSelect: (assign) => {
      assignProduct.current = assign;
      setProductCreateOpen(true);
    },
  };

  const steps = [
    { description: 'Identifica al comprador y la fecha.' },
    { description: 'Agrega los productos de la venta.' },
    { description: 'Condición de pago y confirmación.' },
  ];

  async function handleSubmit(values: SaleFormValues) {
    if (values.saleType === 'stock') {
      const ids = [...new Set(values.items.map((it) => it.productId))];
      const stocks = await Promise.all(
        ids.map(async (id) => ({ id, stock: await wailsClient.getProductStock(id) })),
      );
      const empty = stocks.filter((s) => Number(s.stock) === 0);
      if (empty.length > 0) {
        const names = empty.map((s) => productOptions.find((o) => o.value === s.id)?.label ?? s.id);
        setStockError(
          `Sin stock disponible para: ${names.join(', ')}. Cambia la venta a Pedido de Cliente para continuar.`,
        );
        return;
      }
    }
    setStockError(null);
    try {
      await create.mutateAsync({
        customerId: values.customerId,
        saleType: values.saleType,
        date: values.date,
        dueDate: values.paymentTerms === 'credito' ? values.dueDate ?? '' : '',
        paymentMethod: values.paymentMethod,
        notes: values.notes ?? '',
        initialPayment:
          values.paymentTerms === 'contado'
            ? round2(values.items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0))
            : values.initialPayment,
        items: values.items,
      });
      push({ title: 'Venta registrada', variant: 'success' });
      onOpenChange(false);
    } catch (err: unknown) {
      push({
        title: 'No se pudo registrar la venta',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <div className="stack stack--xs">
            <DialogTitle>Nueva venta</DialogTitle>
            <p className="dialog-subheader">Paso {step + 1} de 3 · {steps[step].description}</p>
          </div>
        </DialogHeader>

        <Form
          key={String(open)}
          schema={SaleFormSchema}
          defaultValues={defaults}
          onSubmit={handleSubmit}
        >
          {(form) => (
            <>
              <DialogBody>
                {stockError && (
                  <div className="banner banner--warning" role="alert">
                    <div className="hstack" style={{ justifyContent: 'space-between', gap: '0.75rem' }}>
                      <span>{stockError}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          form.setValue('saleType', 'client_order');
                          setStockError(null);
                        }}
                      >
                        Usar Pedido de Cliente
                      </Button>
                    </div>
                  </div>
                )}
                {step === 0 && (
                  <div className="form-grid">
                    <SelectField
                      name="customerId"
                      label="Cliente"
                      required
                      options={customerOptions}
                      loading={customersQuery.isLoading}
                      createOption={{
                        label: 'Crear nuevo cliente…',
                        onSelect: (assign) => {
                          assignCustomer.current = assign;
                          setNewCustomerOpen(true);
                        },
                      }}
                    />
                    <DateField name="date" label="Fecha de venta" required />
                    <div className="field">
                      <span className="label">Moneda</span>
                      <Input value="PEN — Soles" disabled readOnly aria-label="Moneda de la venta" />
                    </div>
                  </div>
                )}
                {step === 1 && <CartStep productOptions={productOptions} priceById={priceById} productCreateOption={productCreateOption} />}
                {step === 2 && <PaymentStep />}
              </DialogBody>
              <DialogFooter>
                <Button variant="ghost" type="button" onClick={() => onOpenChange(false)} disabled={create.isPending}>
                  Cancelar
                </Button>
                {step > 0 && (
                  <Button variant="outline" type="button" onClick={() => setStep((s) => s - 1)} disabled={create.isPending}>
                    <ArrowLeft /> Atrás
                  </Button>
                )}
                {step < steps.length - 1 ? (
                  <Button
                    type="button"
                    onClick={async () => {
                      const fields: Array<FieldPath<SaleFormValues>> =
                        step === 0 ? ['customerId', 'date'] : ['items'];
                      if (await form.trigger(fields)) setStep((s) => s + 1);
                    }}
                  >
                    Continuar <ArrowRight />
                  </Button>
                ) : (
                  <Button type="submit" loading={create.isPending}>
                    Guardar
                  </Button>
                )}
              </DialogFooter>

              <CreateCustomerDialog
                open={newCustomerOpen}
                onOpenChange={setNewCustomerOpen}
                onCreated={(id) => assignCustomer.current(id)}
              />
              <ProductFormDialog
                open={productCreateOpen}
                onOpenChange={setProductCreateOpen}
                product={null}
                onCreated={(p) => assignProduct.current(p.id)}
              />
            </>
          )}
        </Form>
      </DialogContent>
    </Dialog>
  );
}
