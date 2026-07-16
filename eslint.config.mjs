import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const restrictedDatabaseImport =
  "^(?:@/db(?:/.*)?|(?:\\.\\.?/)+(?:[^/]+/)*db(?:/.*)?|drizzle-orm(?:/.*)?|better-sqlite3(?:/.*)?)$";
const restrictedDatabaseImportTypeSelector =
  `TSImportType[source.value=/${restrictedDatabaseImport.replaceAll("/", "\\/")}/]`;

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
  ]),
  {
    name: "moneybags/services-only-db-boundary",
    files: [
      "src/app/**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}",
      "src/components/**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}",
      "src/server/actions/**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}",
    ],
    ignores: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: restrictedDatabaseImport,
              caseSensitive: true,
              message:
                "Routes, components, and Server Actions must access persistence through server services.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: restrictedDatabaseImportTypeSelector,
          message:
            "Routes, components, and Server Actions must not access persistence through an inline import type.",
        },
      ],
    },
  },
]);

export default eslintConfig;
