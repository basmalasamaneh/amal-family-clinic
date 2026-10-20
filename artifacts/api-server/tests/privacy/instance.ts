// Child-process HTTP server: independent application caches and database pool.
import app from "../../src/app";
import { pool } from "@workspace/db";
const server = app.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test address");
  process.send?.({ port: address.port });
});
process.on("message", async message => {
  if (message === "stop") {
    server.close(async () => { await pool.end(); process.exit(0); });
  }
});
