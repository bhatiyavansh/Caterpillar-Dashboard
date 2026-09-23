import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    /**
     * The 3D digital twin runs on React Three Fiber, whose model is the exact
     * opposite of the React Compiler's assumptions: every frame it mutates
     * Three.js objects in place inside `useFrame`, reads live mutable
     * simulation state during render, and caches GPU resources in `useMemo`.
     * That is the supported, idiomatic way to write R3F — rendering the scene
     * through React state instead would mean sixty React renders a second.
     *
     * Scoped to the twin only; the rest of the app keeps the full rule set.
     */
    files: [
      "src/components/twin/**",
      "src/hooks/twin/**",
      "src/lib/twin/**",
      "src/store/twinStore.ts",
    ],
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/use-memo": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
