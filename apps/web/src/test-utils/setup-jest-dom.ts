/// <reference types="@testing-library/jest-dom/vitest" />
// Registra los matchers de jest-dom (toBeInTheDocument, toHaveTextContent…)
// en cada archivo de prueba. Vitest ejecuta setupFiles por archivo, con el
// `expect` de ese archivo; importar "@testing-library/jest-dom/vitest" desde
// cada prueba no es determinista, porque Node lo evalúa una sola vez por worker
// como dependencia externa y su `expect.extend` no se repite.
import * as matchers from "@testing-library/jest-dom/matchers";
import { configure } from "@testing-library/react";
import { expect } from "vitest";

expect.extend(matchers);

// findBy*/waitFor esperan hasta 3 s (1 s por defecto): bajo carga, los paneles
// diferidos pueden tardar más de 1 s en montarse. Un `{ timeout }` explícito en
// la prueba sigue teniendo prioridad. Ver docs/vitest-stability-audit.md.
configure({ asyncUtilTimeout: 3000 });
