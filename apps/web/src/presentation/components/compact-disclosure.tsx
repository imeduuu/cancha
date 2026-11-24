import type { ReactNode } from "react";

export function CompactDisclosure({ children, className }: { children: ReactNode; className?: string }) {
  return <details className={["compact-disclosure", className].filter(Boolean).join(" ")}>
    <summary>Datos no oficiales <span aria-hidden="true">ⓘ</span></summary>
    <div className="compact-disclosure-content">{children}</div>
  </details>;
}
