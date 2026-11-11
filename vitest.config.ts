import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: { KS_DB_PATH: ":memory:", TZ: "UTC", LLM_API_KEY: "", GNANI_STT_API_KEY: "", GNANI_TTS_API_KEY: "", GNANI_API_KEY: "", KS_TTS_CACHE_DIR: "/tmp/ks-test-tts", SCHEDULER_ENABLED: "0" },
  },
});
