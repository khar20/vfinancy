import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFormContext } from 'react-hook-form';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/button';
import { ConfirmDialog } from '@/components/dialog';
import { EmptyState, ErrorState, Spinner } from '@/components/feedback';
import { Field, Form, NumberField, SelectField } from '@/components/form';
import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteTrigger,
} from '@/components/input';
import { ListRow } from '@/components/misc';
import {
  useDeleteExtraCost,
  useExtraCostConcepts,
  usePurchaseExtraCosts,
  useSaveExtraCost,
} from '@/features/purchasing/hooks/usePurchases';
import { wailsClient } from '@/services/bindings';
import { queryKeys } from '@/services/queryKeys';
import { Currencies } from '@/constants/currencies';
import type { ExtraCost, ExtraCostInput } from '@/services/purchasing';
import type { ExtraCostConcept } from '@/services/wails-types';
import { formatCurrency, formatNumber } from '@/utils/format';
import { useNotificationStore } from '@/stores/notification';

const rowSchema = z.object({
  concept: z.string().trim().min(1, 'Ingrese el concepto'),
  amount: z.number().positive('Debe ser mayor a 0'),
  currency: z.string().min(1, 'Seleccione la moneda'),
  exchangeRate: z.number().min(0.01, 'Tipo de cambio inválido'),
});

type RowValues = z.infer<typeof rowSchema>;

const currencyOptions = Object.values(Currencies).map((c) => ({
  value: c.code,
  label: `${c.code} — ${c.name}`,
}));

interface ConceptItem {
  value: string;
  label: string;
}

function ConceptField({ concepts }: { concepts: ExtraCostConcept[] }) {
  const { setValue, watch, formState } = useFormContext<RowValues>();
  const error = formState.errors.concept?.message as string | undefined;
  const value = (watch('concept') as string) ?? '';
  const items: ConceptItem[] = concepts.map((c) => ({ value: c.concept, label: c.concept }));

  const autofill = (concept: string) => {
    const match = concepts.find((c) => c.concept.trim().toLowerCase() === concept.trim().toLowerCase());
    if (match) {
      setValue('amount', match.amount);
      setValue('currency', match.currency);
    }
  };

  return (
    <Field label="Concepto" required error={error} className="form-grid__wide" htmlFor="extra-cost-concept">
      <Autocomplete items={items} value={value} onValueChange={(v) => setValue('concept', v)} openOnInputClick>
        <AutocompleteInputGroup>
          <AutocompleteInput
            id="extra-cost-concept"
            invalid={!!error}
            placeholder="Escriba o seleccione un concepto…"
            aria-invalid={!!error || undefined}
          />
          <AutocompleteTrigger />
        </AutocompleteInputGroup>
        <AutocompleteContent>
          <AutocompleteList>
            {(item: ConceptItem) => (
              <AutocompleteItem key={item.value} value={item} onClick={() => autofill(item.value)}>
                {item.label}
              </AutocompleteItem>
            )}
          </AutocompleteList>
          <AutocompleteEmpty>Sin conceptos guardados</AutocompleteEmpty>
        </AutocompleteContent>
      </Autocomplete>
    </Field>
  );
}

// RateSeed refreshes the exchange-rate field with the current USD->PEN
// rate once it loads, so assigning or updating a cost always records
// the rate of the moment.
function RateSeed({ rate }: { rate: number | undefined }) {
  const { setValue } = useFormContext<RowValues>();
  useEffect(() => {
    if (rate != null && rate > 0) setValue('exchangeRate', rate);
  }, [rate, setValue]);
  return null;
}

interface RowFormProps {
  concepts: ExtraCostConcept[];
  defaultValues: RowValues;
  currentRate: number | undefined;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: RowValues) => void;
}

function RowForm({ concepts, defaultValues, currentRate, saving, onCancel, onSubmit }: RowFormProps) {
  return (
    <Form schema={rowSchema} defaultValues={defaultValues} onSubmit={onSubmit}>
      <div className="card" style={{ padding: '0.75rem' }}>
        <div className="stack stack--tight">
          <div className="form-grid">
            <ConceptField concepts={concepts} />
            <NumberField name="amount" label="Monto" required min={0.01} step={0.01} />
            <SelectField name="currency" label="Moneda" required options={currencyOptions} clearable={false} />
            <NumberField
              name="exchangeRate"
              label="Tipo de cambio (USD→PEN)"
              required
              min={0.01}
              step={0.01}
              description="Se registra el tipo de cambio al momento de guardar."
            />
          </div>
          <div className="hstack hstack--sm" style={{ justifyContent: 'flex-end' }}>
            <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              Guardar
            </Button>
          </div>
        </div>
        <RateSeed rate={currentRate} />
      </div>
    </Form>
  );
}

interface ExtraCostsEditorProps {
  purchaseId: string;
  disabled?: boolean;
  defaultRate?: number;
}

export function ExtraCostsEditor({ purchaseId, disabled = false, defaultRate }: ExtraCostsEditorProps) {
  const costs = usePurchaseExtraCosts(purchaseId);
  const conceptsQuery = useExtraCostConcepts();
  const save = useSaveExtraCost(purchaseId);
  const remove = useDeleteExtraCost(purchaseId);
  const push = useNotificationStore((s) => s.push);

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExtraCost | null>(null);

  const concepts = conceptsQuery.data ?? [];
  const rows = costs.data ?? [];
  const editingRow = editingId ? rows.find((r) => r.id === editingId) : undefined;
  const busy = adding || editingRow != null;

  const rateQuery = useQuery({
    queryKey: queryKeys.treasury.exchangeRate('USD', 'PEN'),
    queryFn: () => wailsClient.latestExchangeRate(),
    staleTime: 60 * 1000,
    enabled: busy && !disabled,
  });
  const currentRate = rateQuery.data != null && rateQuery.data.rate > 0 ? rateQuery.data.rate : undefined;

  const closeForm = () => {
    setAdding(false);
    setEditingId(null);
  };

  const handleError = (title: string, err: unknown) =>
    push({
      title,
      description: err instanceof Error ? err.message : undefined,
      variant: 'destructive',
    });

  const submit = (values: RowValues) => {
    const input: ExtraCostInput = {
      concept: values.concept,
      amount: values.amount,
      currency: values.currency,
      exchangeRate: values.exchangeRate,
    };
    save.mutate(
      { id: editingRow?.id, input },
      {
        onSuccess: () => {
          push({ title: 'Costo extra guardado', variant: 'success' });
          closeForm();
        },
        onError: (err: unknown) => handleError('No se pudo guardar el costo extra', err),
      },
    );
  };

  const newDefaults: RowValues = {
    concept: '',
    amount: 0,
    currency: 'USD',
    exchangeRate: defaultRate != null && defaultRate > 0 ? defaultRate : 1,
  };
  const editDefaults: RowValues | undefined = editingRow
    ? {
        concept: editingRow.concept,
        amount: editingRow.amount,
        currency: editingRow.currencyCode,
        exchangeRate: editingRow.exchangeRate,
      }
    : undefined;

  return (
    <div className="stack">
      {costs.isLoading && <Spinner />}
      {costs.isError && (
        <ErrorState
          title="No se pudieron cargar los costos extras"
          onRetry={() => void costs.refetch()}
        />
      )}
      {!costs.isLoading && !costs.isError && rows.length === 0 && !busy && (
        <EmptyState title="Sin costos extras" description="Adjunte fletes, aranceles u otros gastos de la compra." />
      )}

      <div className="stack stack--tight">
        {rows.map((row) =>
          editDefaults && editingRow?.id === row.id ? (
            <RowForm
              key={`${row.id}-edit`}
              concepts={concepts}
              defaultValues={editDefaults}
              currentRate={currentRate}
              saving={save.isPending}
              onCancel={closeForm}
              onSubmit={submit}
            />
          ) : (
            <ListRow
              key={row.id}
              title={row.concept}
              meta={
                <span className="tabular">
                  {formatCurrency(row.amount, row.currencyCode)} · TC {formatNumber(row.exchangeRate, 4)}
                </span>
              }
              trailing={
                !disabled && !busy ? (
                  <div className="hstack hstack--sm">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Editar ${row.concept}`}
                      onClick={() => setEditingId(row.id)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Eliminar ${row.concept}`}
                      onClick={() => setDeleteTarget(row)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ) : undefined
              }
            />
          ),
        )}
        {adding && (
          <RowForm
            key="new"
            concepts={concepts}
            defaultValues={newDefaults}
            currentRate={currentRate}
            saving={save.isPending}
            onCancel={closeForm}
            onSubmit={submit}
          />
        )}
      </div>

      {!disabled && !busy && (
        <div>
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus /> Agregar costo extra
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Eliminar costo extra «${deleteTarget?.concept ?? ''}»`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          remove.mutate(deleteTarget.id, {
            onSuccess: () => {
              push({ title: 'Costo extra eliminado', variant: 'success' });
              setDeleteTarget(null);
            },
            onError: (err: unknown) => {
              handleError('No se pudo eliminar el costo extra', err);
              setDeleteTarget(null);
            },
          });
        }}
      />
    </div>
  );
}
