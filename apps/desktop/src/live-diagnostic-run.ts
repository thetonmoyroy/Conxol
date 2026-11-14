export type LiveDiagnosticKind = "mtr" | "ping";
export const MAX_DIAGNOSTIC_TABS = 8;
export type DiagnosticTab = { id: string; kind: LiveDiagnosticKind; number: number; target: string; state: string };
export type DiagnosticTabsState = { tabs: DiagnosticTab[]; active: Record<LiveDiagnosticKind, string | null> };
export type DiagnosticTabAction =
  | { type: "add"; id: string; kind: LiveDiagnosticKind }
  | { type: "select"; id: string }
  | { type: "close"; id: string }
  | { type: "update"; id: string; target: string; state: string };

export function diagnosticTabsReducer(state: DiagnosticTabsState, action: DiagnosticTabAction): DiagnosticTabsState {
  if (action.type === "add") {
    if (state.tabs.length >= MAX_DIAGNOSTIC_TABS || state.tabs.some(tab => tab.id === action.id)) return state;
    const number = Math.max(0, ...state.tabs.filter(tab => tab.kind === action.kind).map(tab => tab.number)) + 1;
    return { tabs: [...state.tabs, { id: action.id, kind: action.kind, number, target: "", state: "idle" }], active: { ...state.active, [action.kind]: action.id } };
  }
  const tab = state.tabs.find(tab => tab.id === action.id);
  if (!tab) return state;
  if (action.type === "select") return { ...state, active: { ...state.active, [tab.kind]: tab.id } };
  if (action.type === "update") {
    if (tab.target === action.target && tab.state === action.state) return state;
    return { ...state, tabs: state.tabs.map(tab => tab.id === action.id ? { ...tab, target: action.target, state: action.state } : tab) };
  }
  const tabs = state.tabs.filter(tab => tab.id !== action.id);
  return { tabs, active: { ...state.active, [tab.kind]: state.active[tab.kind] === tab.id ? tabs.find(other => other.kind === tab.kind)?.id ?? null : state.active[tab.kind] } };
}

/** Each instance owns its run ID before IPC, including events preceding the response. */
export class LiveDiagnosticRun {
  id: string | null = null;
  finished = true;
  disposed = false;
  stopRequested = false;
  cancelAcknowledged = false;

  begin(id: string): boolean {
    if (this.disposed || !this.finished) return false;
    this.id = id;
    this.finished = false;
    this.stopRequested = false;
    this.cancelAcknowledged = false;
    return true;
  }

  accepts(id: string): boolean {
    return !this.disposed && !this.finished && this.id === id;
  }

  finish(id: string): void {
    if (this.id === id) this.finished = true;
  }

  requestStop(): string | null {
    this.stopRequested = true;
    return !this.finished ? this.id : null;
  }

  shouldCancel(id: string): boolean {
    return this.id === id && !this.finished && !this.cancelAcknowledged && (this.stopRequested || this.disposed);
  }

  acknowledgeCancel(id: string): void {
    if (this.id === id) this.cancelAcknowledged = true;
  }

  dispose(): string | null {
    this.disposed = true;
    return this.requestStop();
  }
}
