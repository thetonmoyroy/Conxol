import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import "./mobile.css";
import App from "./App";
import { WorkspaceSecurity } from "./WorkspaceSecurity";
import { PptpBrowser } from "./PptpBrowser";

if (/Android/i.test(navigator.userAgent)) document.documentElement.classList.add("android");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {location.search === "?pptp-browser" ? <PptpBrowser /> : <WorkspaceSecurity><App /></WorkspaceSecurity>}
  </StrictMode>,
);
