import type { ReactElement } from "react";
import { render, waitFor } from "@testing-library/react";
import { navigate } from "../presentation/client-routing";

/** Startup may coordinate a migration/progression before the editor is ready. */
export async function renderApplication(element: ReactElement) {
  navigate("/", { replace: true });
  const view = render(element);
  await waitFor(() => {
    if (view.container.querySelector("main")?.getAttribute("aria-busy") !== "false")
      throw new Error("Application initialization is still pending");
  });
  return view;
}
