/// <reference types="@testing-library/jest-dom/vitest" />
// Registra los matchers de jest-dom (toBeInTheDocument, toHaveTextContent…)
// en cada archivo de prueba. Vitest ejecuta setupFiles por archivo, con el
// `expect` de ese archivo; importar "@testing-library/jest-dom/vitest" desde
// cada prueba no es determinista, porque Node lo evalúa una sola vez por worker
// como dependencia externa y su `expect.extend` no se repite.
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect } from "vitest";

expect.extend(matchers);
