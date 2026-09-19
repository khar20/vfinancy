import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ShieldCheck } from 'lucide-react';
import { PageContainer, PageHeader, Section } from '@/components/layout';
import { Form, NumberField, TextField, EmailField } from '@/components/form';
import { Button } from '@/components/button';
import { Drawer } from '@/components/misc';
import { SecuritySection } from '@/features/settings/components/SecuritySection';
import { BackupSection, CloudSyncSection } from '@/features/settings/components/SyncAndBackupSection';
import { wailsClient } from '@/services/bindings';
import { queryKeys } from '@/services/queryKeys';
import { useNotificationStore } from '@/stores/notification';

const businessSchema = z.object({
  clearanceDays: z.number().int().min(1, 'Entre 1 y 365').max(365),
  importCostFactor: z.number().min(0, 'Debe ser >= 0').max(100),
  fallbackExchangeRate: z.number().min(0.01, 'Entre 0.01 y 100').max(100),
  purchaseLimitUsd: z.number().min(0, 'Debe ser >= 0').max(1_000_000),
});

type BusinessValues = z.infer<typeof businessSchema>;

function BusinessTab() {
  const queryClient = useQueryClient();
  const push = useNotificationStore((s) => s.push);
  const prefs = useQuery({ queryKey: queryKeys.settings.preferences, queryFn: () => wailsClient.getPreferences() });

  const save = async (values: BusinessValues) => {
    try {
      await wailsClient.updatePreference('clearance_days', String(values.clearanceDays));
      await wailsClient.updatePreference('import_cost_factor', String(values.importCostFactor));
      await wailsClient.updatePreference('fallback_exchange_rate', String(values.fallbackExchangeRate));
      await wailsClient.updatePreference('purchase_limit_usd', String(values.purchaseLimitUsd));
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings.preferences });
      push({ title: 'Parámetros de negocio guardados', variant: 'success' });
    } catch (cause) {
      push({
        title: 'No se pudo guardar la configuración',
        description: cause instanceof Error ? cause.message : undefined,
        variant: 'destructive',
      });
    }
  };

  if (prefs.isLoading) return null;

  const defaults = {
    clearanceDays: prefs.data?.clearanceDays ?? 25,
    importCostFactor: prefs.data?.importCostFactor ?? 0.07,
    fallbackExchangeRate: prefs.data?.fallbackExchangeRate ?? 1,
    purchaseLimitUsd: prefs.data?.purchaseLimitUSD ?? 200,
  };

  return (
    <Section title="Parámetros de negocio">
      <Form<BusinessValues> key={JSON.stringify(defaults)} schema={businessSchema} defaultValues={defaults} onSubmit={save}>
        {({ formState }) => (
          <div className="stack" style={{ maxWidth: '26rem' }}>
            <NumberField
              name="clearanceDays"
              label="Días para remate"
              description="Un lote pasa a remate tras estos días desde su ingreso."
              min={1}
              max={365}
              required
            />
            <NumberField
              name="importCostFactor"
              label="Costo de importación USD"
              description="Factor aplicado sobre el costo en dólares (ej. 0.07 = 7%)."
              min={0}
              step={0.01}
              required
            />
            <NumberField
              name="fallbackExchangeRate"
              label="TC de respaldo"
              description="Tipo de cambio de contingencia cuando no hay conexión."
              min={0.01}
              max={100}
              step={0.01}
              required
            />
            <NumberField
              name="purchaseLimitUsd"
              label="Tope de compra USD"
              description="Monto máximo por orden de compra antes de la advertencia."
              min={0}
              max={1_000_000}
              step={1}
              required
            />
            <div>
              <Button type="submit" loading={formState.isSubmitting}>
                Guardar
              </Button>
            </div>
          </div>
        )}
      </Form>
    </Section>
  );
}

const companySchema = z.object({
  name: z.string().trim().min(2, 'Ingresa la razón social.'),
  commercialName: z.string().trim().optional().or(z.literal('')),
  taxId: z.string().regex(/^(10|20)\d{9}$/, 'RUC debe tener 11 dígitos e iniciar con 10 o 20.').optional().or(z.literal('')),
  email: z.string().email('Correo inválido.').optional().or(z.literal('')),
  fiscalAddress: z.string().trim().optional().or(z.literal('')),
  phone: z.string().trim().optional().or(z.literal('')),
  website: z.string().trim().optional().or(z.literal('')),
});

type CompanyValues = z.infer<typeof companySchema>;

function CompanyTab() {
  const queryClient = useQueryClient();
  const push = useNotificationStore((s) => s.push);
  const profile = useQuery({ queryKey: queryKeys.settings.profile, queryFn: () => wailsClient.getLocalProfile() });

  const save = async (values: CompanyValues) => {
    try {
      await wailsClient.updateLocalProfile(values);
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings.profile });
      push({ title: 'Datos de la empresa guardados', variant: 'success' });
    } catch (cause) {
      push({
        title: 'No se pudo guardar la información de la empresa',
        description: cause instanceof Error ? cause.message : undefined,
        variant: 'destructive',
      });
    }
  };

  if (profile.isLoading) return null;

  const defaults = {
    name: profile.data?.name ?? '',
    commercialName: profile.data?.commercialName ?? '',
    taxId: profile.data?.taxId ?? '',
    email: profile.data?.email ?? '',
    fiscalAddress: profile.data?.fiscalAddress ?? '',
    phone: profile.data?.phone ?? '',
    website: profile.data?.website ?? '',
  };

  return (
    <Section
      title="Datos de la empresa"
      description="Identidad corporativa usada en comprobantes y documentación."
    >
      <Form<CompanyValues> key={JSON.stringify(defaults)} schema={companySchema} defaultValues={defaults} onSubmit={save}>
        {({ formState }) => (
          <div className="stack" style={{ maxWidth: '26rem' }}>
            <TextField name="name" label="Razón social" required />
            <TextField name="commercialName" label="Nombre comercial" />
            <TextField
              name="taxId"
              label="RUC"
              description="11 dígitos, iniciando con 10 o 20."
            />
            <EmailField name="email" label="Correo electrónico" />
            <TextField name="fiscalAddress" label="Dirección fiscal" />
            <TextField name="phone" label="Teléfono" />
            <TextField name="website" label="Web" />
            <div>
              <Button type="submit" loading={formState.isSubmitting}>
                Guardar
              </Button>
            </div>
          </div>
        )}
      </Form>
    </Section>
  );
}

function AuthTab() {
  const [authOpen, setAuthOpen] = useState(false);

  return (
    <>
      <Section title="Seguridad">
        <Button onClick={() => setAuthOpen(true)}>
          <ShieldCheck /> Administrar autenticación
        </Button>
      </Section>
      <Drawer
        open={authOpen}
        onOpenChange={setAuthOpen}
        title="Autenticación"
      >
        <SecuritySection />
      </Drawer>
    </>
  );
}

export function SettingsPage() {
  return (
    <PageContainer>
      <PageHeader title="Configuración" />
      <div className="stack" style={{ maxWidth: '52rem' }}>
        <BusinessTab />
        <CompanyTab />
        <AuthTab />
        <BackupSection />
        <CloudSyncSection />
      </div>
    </PageContainer>
  );
}
