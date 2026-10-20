import { generateKeyPairSync, sign } from "node:crypto";
import type { Auth } from "./auth";

/** Process-local signing key: rotation/restart cannot extend an already issued permit. */
const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
export const OFFLINE_PERMIT_LIFETIME_MS = 30 * 60 * 1000;

export function issueOfflinePermit(a: Auth, clinic: { id: number; name: string }, nonce: string, now = Date.now()) {
  if (!["doctor", "front-desk"].includes(a.role) || clinic.id !== a.clinicId || !/^[a-f0-9]{64}$/.test(nonce)) {
    throw new Error("Invalid offline permit scope");
  }
  const expiresAt = Math.min(a.expiresAt.getTime(), now + OFFLINE_PERMIT_LIFETIME_MS);
  if (expiresAt <= now) throw new Error("Expired offline permit session");
  const payload = Buffer.from(JSON.stringify({
    version: 1, audience: "amal-offline-tab", nonce, userId: `account:${a.id}`,
    name: a.email, role: a.role, clinic, issuedAt: now, expiresAt,
  })).toString("base64url");
  const signature = sign("sha256", Buffer.from(payload), { key: keys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return { payload, signature, publicKey };
}
