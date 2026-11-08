import { createLucideIcon } from "lucide-react";

// Match the shared Lucide viewBox, stroke and sizing used by the icon picker.
// Original vector drawings inspired by classic network topology symbols.
export const NetworkRouter = createLucideIcon("NetworkRouter", [
  ["ellipse", { key: "top", cx: "12", cy: "9", rx: "10", ry: "6" }],
  ["path", { key: "base", d: "M2 9v6c0 3.3 4.5 6 10 6s10-2.7 10-6V9" }],
  ["path", { key: "arrows", d: "m5 8 4 2m-4-2 2-.5M5 8l.5 2M19 10l-4-2m4 2-2 .5M19 10l-.5-2M10 5l4 2m-4-2 .5 2M10 5l2-.5M14 13l-4-2m4 2-.5-2M14 13l-2 .5", strokeWidth: "1.3" }],
]);

export const NetworkSwitch = createLucideIcon("NetworkSwitch", [
  ["path", { key: "case", d: "m2 9 5-5h15v11l-5 5H2V9Zm0 0h15l5-5M17 9v11" }],
  ["path", { key: "arrows", d: "M8 6H5l1-1M10 7h4l-1 1", strokeWidth: "1.3" }],
  ["path", { key: "ports", d: "M5 13v3m3-3v3m3-3v3m3-3v3", strokeWidth: "1.5" }],
]);

export const AccessPoint = createLucideIcon("AccessPoint", [
  ["path", { key: "case", d: "m3 15 4-3h10l4 3v5H3v-5Zm0 0h18M7 12V7m10 5V7" }],
  ["path", { key: "radio", d: "M4 5a5 5 0 0 1 6 0m4 0a5 5 0 0 1 6 0M6 8h2m8 0h2M6 18h1", strokeWidth: "1.5" }],
]);

export const Firewall = createLucideIcon("Firewall", [
  ["rect", { key: "wall", x: "3", y: "3", width: "18", height: "18", rx: "1" }],
  ["path", { key: "courses", d: "M3 9h18M3 15h18M9 3v6m6 0v6m-6 0v6" }],
]);

export const LoadBalancer = createLucideIcon("LoadBalancer", [
  ["rect", { key: "source", x: "2", y: "9", width: "5", height: "6", rx: "1" }],
  ["rect", { key: "top", x: "17", y: "3", width: "5", height: "6", rx: "1" }],
  ["rect", { key: "bottom", x: "17", y: "15", width: "5", height: "6", rx: "1" }],
  ["path", { key: "routes", d: "M7 12h5m5-6h-5v12h5" }],
]);
