import { z } from "zod/v4";

const envelope = z.object({
  idempotencyKey: z.string().min(1),
  message: z.object({ ar: z.string(), en: z.string() }).strict(),
}).strict();
export type DeliveryEnvelope = z.infer<typeof envelope>;
export type SimulatedReceipt = { channel: "simulator"; idempotencyKey: string; simulated: true };
export interface ReminderAdapter {
  deliver(input: DeliveryEnvelope): Promise<SimulatedReceipt>;
}
/** Sole registered adapter. No addresses, credentials, provider selector or IO. */
export const simulator: ReminderAdapter = Object.freeze({
  async deliver(raw: DeliveryEnvelope): Promise<SimulatedReceipt> {
    const input = envelope.parse(raw);
    return { channel: "simulator", idempotencyKey: input.idempotencyKey, simulated: true };
  },
});
