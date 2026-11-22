import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: { "@app-messages": fileURLToPath(new URL("./messages/en.json", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Dummy secrets — encryption.ts / webhook-signature.ts read these
    // at module load. Tests never hit a real Meta/Supabase service, so
    // any 32-byte hex / non-empty string will do; keep them lexically
    // identical to the CI build env so behaviour matches.
    env: {
      ENCRYPTION_KEY:
        "0000000000000000000000000000000000000000000000000000000000000000",
      META_APP_SECRET: "test-meta-app-secret",
    },
    clearMocks: true,
    // Several suites import the large message catalogues; under a full parallel run
    // an unrelated test can need more than the 5 s default on a busy machine.
    testTimeout: 20_000,
    // next-intl's ESM middleware imports "next/server" without an extension,
    // which Node's strict ESM resolver rejects; let Vite resolve it.
    server: { deps: { inline: [/next-intl/] } },
  },
});
