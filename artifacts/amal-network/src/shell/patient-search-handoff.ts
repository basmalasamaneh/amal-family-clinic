/** A provider-owned, memory-only mailbox. Never serialize patient search terms. */
export function patientSearchDestination(role: string | null): string | null {
  return role === 'front-desk' ? '/desk/patients' : role === 'doctor' ? '/doctor/network-search' : null;
}

export function createPatientSearchHandoff(role: string | null) {
  const destination = patientSearchDestination(role);
  let snapshot: { revision: number; request: { id: number; query: string } | null } = { revision: 0, request: null };
  let sequence = 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  return {
    destination,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    submit(raw: string) {
      const query = raw.trim().slice(0, 120);
      if (!destination || query.length < 2) return null;
      snapshot = { ...snapshot, request: { id: ++sequence, query } };
      notify();
      return destination;
    },
    acknowledge(id: number) {
      if (snapshot.request?.id !== id) return;
      snapshot = { ...snapshot, request: null };
      notify();
    },
    clear() {
      snapshot = { revision: snapshot.revision + 1, request: null };
      notify();
    },
  };
}
