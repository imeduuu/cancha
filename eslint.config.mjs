// Solo reglas de capas (ver "Regla de oro" en CLAUDE.md). Sin conjuntos recomendados.
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const tsFiles = ["**/*.ts", "**/*.tsx"];

// packages/core: solo imports relativos (dentro del paquete) y vitest en pruebas.
// Así queda fuera React, cualquier librería de servidor/Node y los demás paquetes.
const coreImportPatterns = [
  {
    regex: "^(?!\\.{1,2}/|vitest$)",
    message: "packages/core solo puede importar módulos propios (rutas relativas) o vitest: nada de React, Node, librerías de servidor ni otros paquetes.",
  },
  {
    regex: "(^|/)(apps|presentation|infrastructure)(/|$)",
    message: "packages/core no puede depender de apps/web ni de sus capas de infraestructura o presentación.",
  },
];

const browserAndServerGlobals = [
  "window", "document", "localStorage", "sessionStorage", "indexedDB", "navigator", "location",
  "process", "Buffer", "require", "__dirname", "__filename",
].map(name => ({ name, message: `packages/core no puede usar el global ${name}: entra por un puerto de application/ports.` }));

export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/playwright-report/**", "**/test-results/**", "docs/**"] },
  {
    files: tsFiles,
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
  },
  {
    // Solo dos reglas del plugin, sin su configuración recomendada.
    files: ["apps/web/**/*.tsx", "apps/web/**/*.ts"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: coreImportPatterns }],
      "no-restricted-globals": ["error", ...browserAndServerGlobals],
    },
  },
  {
    // Regla de oro, sin excepción para pruebas: domain no depende de application ni de test-utils.
    files: ["packages/core/src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        ...coreImportPatterns,
        {
          regex: "(^|/)(application|test-utils)(/|$)",
          message: "src/domain no puede depender de application ni de test-utils.",
        },
      ] }],
    },
  },
  {
    // apps/api consume el núcleo como @cancha/core/... y nunca depende de la web.
    files: ["apps/api/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        {
          regex: "^@cancha/web(/|$)|(^|/)apps/web(/|$)|^(\\.\\./)+web(/|$)",
          message: "apps/api no puede importar apps/web: lo compartido va en @cancha/core.",
        },
        {
          regex: "(^|/)packages/",
          message: "Importa el núcleo como @cancha/core/..., no con rutas relativas entre paquetes.",
        },
      ] }],
    },
  },
  {
    files: ["apps/web/**/*.ts", "apps/web/**/*.tsx", "apps/web/**/*.mjs"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        {
          regex: "(^|/)packages/",
          message: "Importa el núcleo como @cancha/core/..., no con rutas relativas entre paquetes.",
        },
      ] }],
    },
  },
];
