import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored minified opus-recorder encoder worker (served statically).
    "public/opus/**",
    // Cloudflare/OpenNext build output + generated types (huge; linting them OOMs).
    ".open-next/**",
    ".wrangler/**",
    "cloudflare-env.d.ts",
  ]),
  {
    // New React-Compiler lint rules arrived with eslint-config-next 16.4
    // (required by @opennextjs/cloudflare). The flagged effects/memos
    // predate them and work correctly; keep them visible as warnings
    // and migrate incrementally rather than rewriting working code.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
    },
  },
]);

export default eslintConfig;
