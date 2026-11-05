import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import App from "./App";
import { WorkspaceSecurity } from "./WorkspaceSecurity";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkspaceSecurity><App /></WorkspaceSecurity>
  </StrictMode>,
);
