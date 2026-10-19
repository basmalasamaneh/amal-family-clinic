import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, CardFooter, CardHeader, TextField, useToast } from '@workspace/amal-ui';
import { Section } from './Section';

type Errors = { name?: string; phone?: string };

export function InputsSection({ index }: { index: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const validate = (): Errors => ({
    name: name.trim().length < 2 ? t('kit.inputs.errName') : undefined,
    phone: /^05\d{8}$/.test(phone) ? undefined : t('kit.inputs.errPhone'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (errs.name) { document.getElementById('demo-name')?.focus(); return; }
    if (errs.phone) { document.getElementById('demo-phone')?.focus(); return; }
    toast.show({ tone: 'success', title: t('kit.inputs.valid'), description: t('kit.inputs.validDesc') });
  };
  const reset = () => { setName(''); setPhone(''); setNote(''); setErrors({}); };

  return (
    <Section id="inputs" index={index} intro={t('kit.inputs.intro')}>
      <Card as="div" className="kit-form-card">
        <form onSubmit={submit} noValidate aria-labelledby="demo-form-title">
          <CardHeader titleId="demo-form-title" title={t('kit.inputs.formTitle')} description={t('kit.inputs.formDesc')} />
          <CardBody className="kit-form-grid">
            <TextField id="demo-name" label={t('kit.inputs.name')} placeholder={t('kit.inputs.namePh')} required value={name} onChange={(e) => setName(e.target.value)} error={errors.name} autoComplete="off" data-testid="input-name" />
            <TextField id="demo-phone" label={t('kit.inputs.phone')} placeholder={t('kit.inputs.phonePh')} required inputMode="numeric" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} hint={t('kit.inputs.phoneHint')} error={errors.phone} autoComplete="off" data-testid="input-phone" />
            <TextField label={t('kit.inputs.note')} placeholder={t('kit.inputs.notePh')} showOptional value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-note" />
            <TextField label={t('kit.inputs.disabledLabel')} value={t('kit.inputs.disabledValue')} disabled readOnly data-testid="input-disabled" />
          </CardBody>
          <CardFooter>
            <Button type="submit" data-testid="button-form-submit">{t('kit.inputs.submit')}</Button>
            <Button type="button" variant="ghost" onClick={reset} data-testid="button-form-reset">{t('kit.inputs.reset')}</Button>
          </CardFooter>
        </form>
      </Card>
    </Section>
  );
}
