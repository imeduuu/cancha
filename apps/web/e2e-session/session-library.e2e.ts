import { expect, test, type Page } from "@playwright/test";

// Recorrido con la pila real (fase 5J): web compilada + proxy /graphql de Vite + API
// + MongoDB en memoria. Lo que las pruebas de Vitest cubren contra un servidor falso,
// aquí pasa por el esquema, la autenticación y las transacciones reales.

const password = "una-contraseña-de-prueba";

async function createTournament(page: Page, name: string) {
  await page.getByRole("button", { name: "Crear torneo" }).click();
  const nameInput = page.getByRole("textbox", { name: /Nombre del campeonato/ });
  await nameInput.fill(name);
  await page.getByRole("spinbutton", { name: "Ruedas (veces que se enfrentan entre sí)" }).fill("1");
  await page.getByRole("button", { name: /Crear campeonato/ }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

/** Con torneos, la aplicación termina abriendo el torneo activo: se espera su botón "Biblioteca" y se vuelve. */
async function openLibrary(page: Page) {
  const library = page.getByRole("button", { name: "Biblioteca", exact: true });
  await library.waitFor({ state: "visible", timeout: 5000 }).then(() => library.click(), () => {});
}

/** Texto visible (no las opciones ocultas de un selector). */
function shown(page: Page, text: string) {
  return page.getByText(text, { exact: true }).filter({ visible: true }).first();
}

test("biblioteca con sesión de punta a punta: migrar, guardar, recargar, otro dispositivo y cerrar sesión", async ({ page, browser }) => {
  const email = `e2e-${Date.now()}@cancha.test`;
  const apiErrors: string[] = [];
  page.on("response", async response => {
    if (!response.url().endsWith("/graphql")) return;
    const body = await response.json().catch(() => null) as { errors?: { message: string; extensions?: { code?: string } }[] } | null;
    // Un CONFLICT es esperado en el paso de otro dispositivo; cualquier otro error de la API no.
    for (const error of body?.errors ?? []) if (error.extensions?.code !== "CONFLICT") apiErrors.push(error.message);
  });

  // 1. Sin sesión: una biblioteca en este navegador.
  await page.goto("/");
  await createTournament(page, "Liga del navegador");

  // 2. Crear la cuenta.
  await page.getByRole("button", { name: "Cuenta" }).click();
  const panel = page.getByRole("region", { name: "Cuenta" });
  await panel.getByRole("button", { name: "Crear cuenta" }).click();
  await panel.getByLabel("Email").fill(email);
  await panel.getByLabel("Contraseña").fill(password);
  await panel.getByRole("button", { name: "Registrarme" }).click();

  // 3. Migrar la biblioteca local a la cuenta vacía (restoreBackup real).
  const migration = page.getByRole("region", { name: "Biblioteca de este navegador" });
  await expect(migration).toContainText("Tu cuenta tiene 0 torneos");
  await migration.getByRole("button", { name: "Subir a mi cuenta" }).click();
  await expect(migration.getByRole("status")).toContainText("Se agregó a tu cuenta: 1 torneos");
  await migration.getByRole("button", { name: "Abrir la biblioteca de mi cuenta" }).click();
  await expect(page.getByRole("button", { name: `Cuenta · ${email}` })).toBeVisible();

  // 4. Guardar con sesión (commitLibraryChanges real) y comprobar que sobrevive a recargar.
  await page.getByRole("button", { name: "Cerrar panel de cuenta" }).click().catch(() => {});
  await createTournament(page, "Liga de la cuenta");
  await page.reload();
  await expect(page.getByRole("button", { name: `Cuenta · ${email}` })).toBeVisible();
  await openLibrary(page);
  await expect(shown(page, "Liga del navegador")).toBeVisible();
  await expect(shown(page, "Liga de la cuenta")).toBeVisible();

  // 5. Otro dispositivo escribe; al volver a esta pestaña se avisa el cambio externo.
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: "es-CL" });
  const device = await other.newPage();
  await device.goto("/");
  await device.getByRole("button", { name: "Cuenta" }).click();
  const otherPanel = device.getByRole("region", { name: "Cuenta" });
  await otherPanel.getByLabel("Email").fill(email);
  await otherPanel.getByLabel("Contraseña").fill(password);
  await otherPanel.getByRole("button", { name: "Entrar" }).click();
  // Su navegador está vacío: no hay migración que ofrecer.
  await expect(device.getByRole("button", { name: `Cuenta · ${email}` })).toBeVisible();
  await device.getByRole("button", { name: "Cerrar panel de cuenta" }).click();
  await createTournament(device, "Liga de otro dispositivo");
  await other.close();

  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  const alert = page.getByRole("alert", { name: "Cambios externos en la biblioteca" });
  await expect(alert).toContainText("otra pestaña o dispositivo");
  await alert.getByRole("button", { name: "Actualizar biblioteca conservando borradores" }).click();
  await openLibrary(page);
  await expect(shown(page, "Liga de otro dispositivo")).toBeVisible();

  // 6. Cerrar sesión: vuelve la biblioteca de este navegador, intacta.
  await page.getByRole("button", { name: `Cuenta · ${email}` }).click();
  await page.getByRole("region", { name: "Cuenta" }).getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page.getByRole("button", { name: "Cuenta", exact: true })).toBeVisible();
  await openLibrary(page);
  await expect(shown(page, "Liga del navegador")).toBeVisible();
  await expect(page.getByText("Liga de la cuenta", { exact: true })).toHaveCount(0);

  expect(apiErrors).toEqual([]);
});
