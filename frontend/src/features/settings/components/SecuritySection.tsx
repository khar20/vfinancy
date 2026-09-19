import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { z } from 'zod';
import { Section } from '@/components/layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/card';
import { Button } from '@/components/button';
import { PasswordInput, Label } from '@/components/input';
import { Form } from '@/components/form';
import { SecurityQuestionFields } from '@/features/settings/components/SecurityQuestionFields';
import { SECURITY_QUESTION_CUSTOM, securityQuestionLabel } from '@/constants/securityQuestions';
import { wailsClient } from '@/services/bindings';
import { queryKeys } from '@/services/queryKeys';
import { useNotificationStore } from '@/stores/notification';
import { Routes } from '@/constants/routes';

const questionSchema = z
  .object({
    securityQuestion: z.string().min(1, 'Selecciona una pregunta.'),
    customQuestion: z.string().trim().optional().or(z.literal('')),
    securityAnswer: z.string().trim().min(3, 'Usa al menos 3 caracteres.'),
  })
  .superRefine((data, ctx) => {
    if (data.securityQuestion === SECURITY_QUESTION_CUSTOM && !data.customQuestion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customQuestion'],
        message: 'Escribe tu propia pregunta.',
      });
    }
  });

type QuestionValues = z.infer<typeof questionSchema>;

function resolveQuestion(values: QuestionValues): string {
  return values.securityQuestion === SECURITY_QUESTION_CUSTOM
    ? (values.customQuestion ?? '').trim()
    : securityQuestionLabel(values.securityQuestion);
}

export function SecuritySection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const push = useNotificationStore((s) => s.push);
  const auth = useQuery({ queryKey: queryKeys.setup, queryFn: () => wailsClient.getLocalAuthState() });
  const profile = useQuery({ queryKey: queryKeys.settings.profile, queryFn: () => wailsClient.getLocalProfile() });

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const passwordEnabled = auth.data?.passwordEnabled ?? false;
  const storedQuestion = passwordEnabled && !!profile.data?.securityQuestion
    ? profile.data?.securityQuestion
    : '';

  const valid = next === '' || next.length >= 8;

  async function run(action: () => Promise<void>, okMsg: string) {
    setBusy(true);
    try {
      await action();
      push({ title: okMsg, variant: 'success' });
      setCurrent('');
      setNext('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.setup });
    } catch (cause) {
      push({
        title: 'No se pudo actualizar la contraseña',
        description: cause instanceof Error ? cause.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }

  const savePassword = () =>
    run(
      () => wailsClient.setLocalPassword({ current, next }),
      passwordEnabled ? 'Contraseña actualizada' : 'Contraseña creada',
    );

  const removePassword = () =>
    run(() => wailsClient.removeLocalPassword(current), 'Contraseña eliminada');

  const lockNow = () =>
    run(async () => {
      await wailsClient.lockLocalProfile();
      navigate(Routes.Welcome, { replace: true });
    }, 'Aplicación bloqueada');

  const saveQuestion = async (values: QuestionValues) => {
    try {
      await wailsClient.setSecurityQuestion({ question: resolveQuestion(values), answer: values.securityAnswer });
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings.profile });
      push({ title: 'Pregunta de seguridad guardada', variant: 'success' });
    } catch (cause) {
      push({
        title: 'No se pudo guardar la pregunta',
        description: cause instanceof Error ? cause.message : undefined,
        variant: 'destructive',
      });
    }
  };

  const clearQuestion = async () => {
    try {
      await wailsClient.clearSecurityQuestion();
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings.profile });
      push({ title: 'Pregunta de seguridad eliminada', variant: 'success' });
    } catch (cause) {
      push({
        title: 'No se pudo eliminar la pregunta',
        description: cause instanceof Error ? cause.message : undefined,
        variant: 'destructive',
      });
    }
  };

  return (
    <Section title="Seguridad">
      <Card>
        <CardHeader>
          <CardTitle>Contraseña local</CardTitle>
          <CardDescription>
            {passwordEnabled
              ? 'La aplicación pide la contraseña al iniciar. Usa al menos 8 caracteres.'
              : 'Aún no hay contraseña configurada. Crea una para proteger tu información.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="stack" style={{ maxWidth: '24rem' }}>
            {passwordEnabled && (
              <div className="field">
                <Label htmlFor="security-current">Contraseña actual</Label>
                <PasswordInput
                  id="security-current"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
            )}
            <div className="field">
              <Label htmlFor="security-next">
                {passwordEnabled ? 'Nueva contraseña' : 'Nueva contraseña (opcional)'}
              </Label>
              <PasswordInput
                id="security-next"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                placeholder={passwordEnabled ? 'Déjalo vacío para no cambiarla' : undefined}
                autoComplete="new-password"
                invalid={!valid}
              />
              {!valid && <p className="field-error">Usa al menos 8 caracteres.</p>}
            </div>
            <div className="hstack hstack--sm" style={{ flexWrap: 'wrap' }}>
              <Button onClick={savePassword} loading={busy} disabled={!valid}>
                <KeyRound /> {passwordEnabled ? 'Actualizar contraseña' : 'Crear contraseña'}
              </Button>
              {passwordEnabled && (
                <Button variant="outline" onClick={removePassword} loading={busy} disabled={!current}>
                  Quitar contraseña
                </Button>
              )}
              {passwordEnabled && (
                <Button variant="ghost" onClick={lockNow} loading={busy}>
                  <Lock /> Bloquear ahora
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {passwordEnabled && (
        <Card>
          <CardHeader>
            <CardTitle>Pregunta de seguridad</CardTitle>
            <CardDescription>
              Si olvidas tu contraseña, esta pregunta permite restaurar el acceso en la pantalla de bloqueo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="stack" style={{ maxWidth: '24rem' }}>
              {storedQuestion && (
                <div className="dialog-note">
                  <p className="fw-medium">Pregunta actual</p>
                  <p className="muted">{storedQuestion}</p>
                  <div className="hstack hstack--sm">
                    <Button size="sm" variant="outline" onClick={clearQuestion}>
                      Eliminar pregunta
                    </Button>
                  </div>
                </div>
              )}
              <Form<QuestionValues>
                defaultValues={{ securityQuestion: '', customQuestion: '', securityAnswer: '' }}
                schema={questionSchema}
                onSubmit={saveQuestion}
              >
                {({ formState }) => (
                  <div className="stack">
                    <SecurityQuestionFields required />
                    <div>
                      <Button type="submit" loading={formState.isSubmitting}>
                        <ShieldCheck /> {storedQuestion ? 'Cambiar pregunta' : 'Configurar pregunta'}
                      </Button>
                    </div>
                  </div>
                )}
              </Form>
            </div>
          </CardContent>
        </Card>
      )}
    </Section>
  );
}