// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OfficialResolutionManager } from "./official-resolution-manager";
import { memoryRepository, seedTie, multipleTie } from "@cancha/core/test-utils/official-resolution-fixtures";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);
describe("official resolution editor", () => {
  it("requires a published order and verification, then shows the revised history", async () => {
    const user = userEvent.setup(), t = seedTie(), repository = memoryRepository(t);
    function Harness() {
      const [current, setCurrent] = useState(t);
      return <OfficialResolutionManager tournament={current} repository={repository} onChange={setCurrent} />;
    }
    render(<Harness />);
    await user.click(screen.getByText(/Sorteo de ordenamiento · Reducido · Primera fase · Quintos · Pendiente/));
    await user.click(screen.getByLabelText("URL oficial de la publicación"));
    await user.paste("https://www.afa.com.ar/boletines");
    await user.click(screen.getByLabelText(/Referencia verificable/));
    await user.paste("Acta AFA de prueba");
    await user.selectOptions(screen.getByLabelText("Sorteo · posición 1"), "t22");
    await user.selectOptions(screen.getByLabelText("Sorteo · posición 2"), "t4");
    await user.selectOptions(screen.getByLabelText("Estado de verificación"), "verified");
    expect(screen.getByRole("button", { name: "Revisar registro oficial" })).toHaveProperty("disabled", true);
    await user.click(screen.getByLabelText(/Contrasté los participantes/));
    await user.click(screen.getByRole("button", { name: "Revisar registro oficial" }));
    const dialog = screen.getByRole("dialog", { name: "Guardar resolución registrada" });
    await user.click(within(dialog).getByRole("button", { name: "Guardar resolución" }));
    expect(repository.saveWithActivity).toHaveBeenCalledOnce();
    expect(screen.getByText(/Quintos · Resuelto/)).toBeTruthy();
    expect(screen.getByText("Historial de resoluciones (1)")).toBeTruthy();
  });
  it("starts an AFA programme with no generated matches or scores", async () => {
    const user = userEvent.setup(), t = multipleTie(), onChange = vi.fn();
    render(<OfficialResolutionManager tournament={t} repository={memoryRepository(t)} onChange={onChange} />);
    await user.click(screen.getByText(/Desempate múltiple de descenso · Zona A · Pendiente/));
    expect(screen.queryByText("Partido publicado 1")).toBeNull();
    await user.selectOptions(screen.getByLabelText("Formato publicado por AFA"), "round-robin");
    expect(screen.queryByText("Partido publicado 1")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Agregar partido publicado" }));
    expect(screen.getByText("Partido publicado 1")).toBeTruthy();
    expect((screen.getByLabelText("Goles local") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Goles visitante") as HTMLInputElement).value).toBe("");
    expect(screen.getByLabelText("URL AFA del resultado")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});
