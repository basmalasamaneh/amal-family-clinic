import { configurePrivacyDatabase } from "./privacy/guard";

await configurePrivacyDatabase();
// Reuse the prerequisite's real API tests, not mock policy implementations.
await import("./consent-api.test");
