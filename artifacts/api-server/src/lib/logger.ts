import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
    "password", "pin", "password_hash", "pin_hash", "token", "credential",
    "*.password", "*.pin", "*.password_hash", "*.pin_hash", "*.token", "*.credential",
    "req.body", "req.headers['x-csrf-token']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
