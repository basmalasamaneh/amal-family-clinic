import type { NetworkCoordination } from '@workspace/api-client-react';
export type { CoordinationMetric } from '@workspace/api-client-react';
export type CoordinationSnapshot = NetworkCoordination;
export interface CoordinationPrincipal { id: string; role: string | null; expiresAt?: string | null; offlineRestored?: boolean }
export function mayCheckCoordination(p: CoordinationPrincipal, online: boolean, fixture: boolean, now = Date.now()): boolean {
  return !!p.id && p.role === 'doctor' && online && !fixture && !p.offlineRestored
    && (!p.expiresAt || Date.parse(p.expiresAt) > now);
}
export function mayShowCoordination(p: CoordinationPrincipal, online: boolean, fixture: boolean, grant: { accountId: string; canCoordinate: boolean; validUntil: number } | null, now = Date.now()): boolean {
  return mayCheckCoordination(p, online, fixture, now) && grant?.accountId === p.id
    && grant.canCoordinate === true && grant.validUntil > now;
}
