import type { IdentityAdapter, ShellRole } from './identity';

/** Synthetic names/IDs belong only in this isolated adapter, never shell components. */
export function createFixtureAdapter(scenario: string): IdentityAdapter {
  let signedOut = scenario === 'signed-out';
  const role: ShellRole | null = scenario === 'admin' || scenario === 'doctor' || scenario === 'front-desk' ? scenario : scenario === 'no-clinics' || scenario === 'clinic-error' ? 'admin' : null;
  const clinics = [
    { id: 91001, name: 'عيادة العرض أ · Demo A' },
    { id: 91002, name: 'عيادة العرض ب · Demo B' },
  ];
  return {
    mode: 'fixture',
    async load() {
      if (scenario === 'error') throw new Error('Explicit development fixture error');
      if (signedOut) return null;
      return {
        id: `fixture:${scenario}`,
        name: 'مستخدم تجريبي · Demo user',
        role,
        clinics: scenario === 'no-clinics' || scenario === 'clinic-error' || !role ? [] : role === 'admin' ? clinics : clinics.slice(0, 1),
        clinicsState: scenario === 'clinic-error' ? 'error' : 'ready',
      };
    },
    async logout() { signedOut = true; },
  };
}
