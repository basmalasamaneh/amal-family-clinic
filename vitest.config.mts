import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false,
    watch: false,
    env: { TZ: "UTC" },
  },
});
