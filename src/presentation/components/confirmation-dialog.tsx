import { useEffect, useId, useRef, type ReactNode } from "react";

interface ConfirmationDialogProps {
  busy?: boolean;
  open: boolean;
  title: string;
  description: string;
  details?: ReactNode;
  warning?: string;
  confirmLabel: string;
  cancelLabel?: string;
  eyebrow?: string;
  icon?: string;
  alternateActions?: readonly {
    label: string;
    onSelect: () => void;
  }[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationDialog({
  busy = false,
  open,
  title,
  description,
  details,
  warning,
  confirmLabel,
  cancelLabel = "Cancelar",
  eyebrow = "ACTUALIZACIÓN OFICIAL",
  icon = "↻",
  alternateActions = [],
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const warningId = `${id}-warning`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
      cancelButtonRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
      aria-describedby={warning ? `${id}-description ${warningId}` : `${id}-description`}
      className="confirmation-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          if (!busy) onCancel();
        }
      }}
      ref={dialogRef}
    >
      <div className="confirmation-dialog-content">
        <div className="confirmation-dialog-icon" aria-hidden="true">{icon}</div>
        <span className="eyebrow confirmation-dialog-eyebrow">{eyebrow}</span>
        <h2 id={`${id}-title`}>{title}</h2>
        <p id={`${id}-description`} className="confirmation-dialog-description">
          {description}
        </p>
        {details}
        {warning && (
          <div className="confirmation-dialog-warning" id={warningId}>
            <span aria-hidden="true">!</span>
            <p>{warning}</p>
          </div>
        )}
        <div className="confirmation-dialog-actions">
          {alternateActions.map(({ label, onSelect }) => (
            <button
              className="confirmation-dialog-confirm"
              disabled={busy}
              key={label}
              onClick={onSelect}
              type="button"
            >
              {label}
            </button>
          ))}
          <button
            className="confirmation-dialog-cancel"
            disabled={busy}
            onClick={onCancel}
            ref={cancelButtonRef}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className="confirmation-dialog-confirm"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
