import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    settings: { next: { rootDir: "apps/web/" } },
    rules: { "@next/next/no-location-assign-relative-destination": "off" },
  },
  globalIgnores([
    "**/.next/**",
    "**/.next-preparation/**",
    "**/next-env.d.ts",
    "packages/domain/src/legacy/**",
    "legacy/**",
    ".runtime/**",
  ]),
  {
    files: ["packages/domain/**", "tests/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    files: ["**/*.mjs", "**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);
