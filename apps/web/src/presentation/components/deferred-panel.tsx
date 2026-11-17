import { Component, Suspense, type ReactNode } from "react";

interface Props { readonly children: ReactNode; readonly fallback: ReactNode }

/** Keep a failed panel from unmounting the rest of the workspace. */
class PanelErrorBoundary extends Component<{ readonly children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div role="alert">
      <p>No se pudo abrir este panel. El resto de la aplicación sigue disponible.</p>
      <p>Comprueba la conexión. Guarda las ediciones disponibles antes de recargar o abrir otra pestaña.</p>
      <button type="button" onClick={() => window.location.reload()}>Recargar la aplicación</button>
      <p>Si el panel sigue fallando, abre una pestaña vacía desde el navegador y pega la dirección actual. Las ediciones sin guardar no se trasladan.</p>
    </div>;
    return this.props.children;
  }
}

export function DeferredPanel({ children, fallback }: Props) {
  return <PanelErrorBoundary><Suspense fallback={fallback}>{children}</Suspense></PanelErrorBoundary>;
}
