// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportOfficialTournament } from "./import-official-tournament";
import { anfaCalendarUnavailableMessage } from "../../infrastructure/external-services/anfa-third-division-source";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const repository = { findAll: () => [], save: vi.fn(), saveWithActivity: vi.fn() };

function leagueCard(title: string): HTMLElement {
  const card = screen.getByRole("heading", { name: title }).closest("article");
  if (!card) throw new Error(`No se encontró la tarjeta de ${title}.`);
  return card;
}

describe("ImportOfficialTournament · fuente no disponible", () => {
  it("avisa que ANFA está en mantenimiento sin bloquear el intento de importar", () => {
    render(<ImportOfficialTournament repository={repository} onImported={vi.fn()} />);

    for (const title of ["Tercera A Nacional 2026", "Tercera B 2026"]) {
      const card = within(leagueCard(title));
      expect(card.getByRole("note")).toHaveTextContent("Fuente en mantenimiento");
      expect(card.getByRole("note")).toHaveTextContent(/no publica calendarios/);
      expect(card.getByRole("button", { name: "Intentar importar" })).toBeEnabled();
    }

    const primera = within(leagueCard("Liga de Primera 2026"));
    expect(primera.queryByRole("note")).toBeNull();
    expect(primera.getByRole("button", { name: "Importar / actualizar" })).toBeEnabled();
  });

  it("muestra en la tarjeta el motivo cuando ANFA no publica el calendario", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("La fuente oficial respondió con HTTP 404.", { status: 502 })));
    const user = userEvent.setup();
    render(<ImportOfficialTournament repository={repository} onImported={vi.fn()} />);

    await user.click(within(leagueCard("Tercera A Nacional 2026")).getByRole("button", { name: "Intentar importar" }));

    expect(await within(leagueCard("Tercera A Nacional 2026")).findByRole("alert"))
      .toHaveTextContent(anfaCalendarUnavailableMessage("Tercera A Nacional"));
    expect(repository.saveWithActivity).not.toHaveBeenCalled();
  });
});
