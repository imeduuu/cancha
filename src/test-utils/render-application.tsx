import type { ReactElement } from "react";
import { render, waitFor } from "@testing-library/react";

/** Startup may coordinate a migration/progression before the editor is ready. */
export async function renderApplication(element: ReactElement) {
  const view = render(element);
  await waitFor(() => {
    if (view.container.querySelector("main")?.getAttribute("aria-busy") !== "false")
      throw new Error("Application initialization is still pending");
  });
  return view;
}
