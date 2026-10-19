// A fresh OS process proves auth state is not held in a module/process cache.
import { authenticate, verifyPin } from "../src/lib/auth";
import { pool } from "@workspace/db";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const probe = JSON.parse(input);
try {
  if (probe.kind === "session") {
    const req: any = { cookies: { amal_session: probe.session, amal_device: probe.device } };
    await authenticate(req, {} as any, (e?: any) => {
      process.stdout.write(JSON.stringify(e ? { status: e.status } : { id: req.auth.id }));
    });
  } else {
    try { await verifyPin(probe.userId, probe.pin); process.stdout.write('{"status":200}'); }
    catch(e: any) { process.stdout.write(JSON.stringify({status:e.status})); }
  }
} finally { await pool.end(); }
