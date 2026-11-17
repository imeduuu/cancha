import { useEffect, useId, useRef } from "react";

interface SimulationScopeDialogProps {
  open: boolean;
  half: "Apertura" | "Clausura";
  onSelect: (includePlayoffs: boolean) => void;
  onCancel: () => void;
}

export function SimulationScopeDialog({
  open,
  half,
  onSelect,
  onCancel,
}: SimulationScopeDialogProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const leagueButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      leagueButtonRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      className="simulation-scope-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      ref={dialogRef}
    >
      <div className="simulation-scope-content">
        <span className="eyebrow">SIMULAR TORNEO {half.toUpperCase()}</span>
        <h2 id={`${id}-title`}>¿Hasta qué etapa quieres simular?</h2>
        <p id={`${id}-description`}>
          Puedes jugar solo la fase de liga o completar también las eliminatorias.
          {half === "Clausura" ? " Los cruces se generan según la tabla final." : ""}
        </p>
        <div className="simulation-scope-options">
          <button
            className="simulation-scope-option"
            onClick={() => onSelect(false)}
            ref={leagueButtonRef}
            type="button"
          >
            <strong>Solo fase de liga</strong>
            <span>Simula las fechas y deja los playoffs pendientes.</span>
          </button>
          <button
            className="simulation-scope-option featured"
            onClick={() => onSelect(true)}
            type="button"
          >
            <strong>Fase de liga + playoffs</strong>
            <span>Completa octavos, cuartos, semifinales y final.</span>
          </button>
        </div>
        <button
          className="simulation-scope-cancel"
          onClick={onCancel}
          type="button"
        >
          Cancelar
        </button>
      </div>
    </dialog>
  );
}
