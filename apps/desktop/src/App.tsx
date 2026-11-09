import { PptpAttachment } from "./PptpAttachment";
import { WebglAddon } from "@xterm/addon-webgl";
import { attachTerminalGpuRenderer } from "./terminal-gpu-renderer";
import { ANDROID_TERMINAL_COLUMNS, fitAndroidTerminal, attachTerminalTouchPan } from "./terminal-mobile-layout";
import { useStoreUpdates } from "./StoreUpdates";
import { literalInputProps } from "./literal-input";
import { ApplicationMenuBar } from "./ApplicationMenuBar";
import { canReconnectTerminal, isReconnectKey } from "./terminal-reconnect";
import { SessionRowActions } from "./SessionRowActions";
import { mergeScanResults, openScanResults, scanProgress } from "./network-scan-model";
import { branchTerminalLayout, findLayoutPath, layoutTerminalIds, rememberTerminalLayout, removeLayoutNode, replaceLayoutNode, selectTerminalLayout, updateLayoutRatio, type SplitDirection, type SplitPath, type TerminalLayoutNode } from "./terminal-layout";
import { FloatingDiagnostics } from "./FloatingDiagnostics";
import { ThirdPartyCredits } from "./ThirdPartyCredits";
import { registerTerminalPasteReveal, revealPastedTerminal } from "./terminal-paste-reveal";
import { createTerminalFitScheduler } from "./terminal-fit";
import { handleTerminalControlKey } from "./terminal-control-keys";
import { FileTransferClient } from "./FileTransferClient";
import { SyntaxHighlightSettings } from "./SyntaxHighlightSettings";
import { PptpManager } from "./PptpManager";
import { WorkspaceBackup } from "./WorkspaceBackup";
import { applyWorkspacePreferences } from "./workspace-backup-model";
import { handleTerminalFindKey } from "./terminal-find";
import { ShortcutCenter } from "./ShortcutCenter";
import { DoubleShift, shortcutFromSelection, isCommandShortcut, shortcutDevice, shortcutText, type ShortcutRecord } from "./command-shortcuts";
import { ConfigGenerator } from "./ConfigGenerator";
import { defaultTerminalAppearance, resolveTerminalTheme, terminalSurface, type TerminalAppearance } from "./terminal-appearance";
import { FolderCustomization, SessionFolderIcon } from "./FolderCustomization";
import { readFolderStyles, defaultFolderStyle, type FolderStyle } from "./folder-appearance";
import { Save, ArrowRight, FolderInput } from "lucide-react";
import { FileText } from "lucide-react";
import { NotesModal } from "./NotesModal";
import { useCallback, useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type UIEvent as ReactUIEvent, type WheelEvent as ReactWheelEvent } from "react";
import { attachNetworkHighlighting } from "./network-highlighting";
import { readClipboardText, writeClipboardText } from "./clipboard-access";
import { TerminalContextMenu } from "./TerminalContextMenu";
import { pasteTerminalClipboard } from "./terminal-clipboard";
import { WorkspaceLockSettings } from "./WorkspaceSecurity";
import { useWorkspaceLock, isWorkspaceLocked } from "./workspace-lock-state";
import { approveUnknownHost } from "./ssh-host-trust";
import { ConnectionAttemptGate } from "./connection-attempt";
import { parseSessionFolderState, parseSessionFolders, unfileSessionFolder, groupSessionFolders, planSessionFolderMove, sessionFolderAncestors, sessionFolderWithin, sessionFolderParent, sessionFolderOpenState } from "./session-folders";
import { TerminalAuthentication } from "./terminal-authentication";
import { TerminalSshLogin } from "./TerminalSshLogin";
import { sidebarWidth, DEFAULT_SIDEBAR_WIDTH } from "./sidebar-layout";
import { Channel, invoke } from "@tauri-apps/api/core";
import { RemoteFramebufferQueue } from "./remote-desktop-framebuffer";
import { listen, type Event as TauriEvent, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import {
  experimentalDesktopTargetError,
} from "./connection-safety";
import { parseQuickConnectUri } from "./connection-uri";
import { countTextMatches, highlightRemoteCode, remoteEditorLanguage, remoteEditorSaveNotice, reloadRemoteEditorDocument, replaceTextMatches } from "./remote-editor";
import {
  parseRemoteDesktopProfile,
  remoteDesktopCanResize,
  remoteDesktopCanReceiveClipboard,
  remoteDesktopCanSendClipboard,
  remoteDesktopTransportLabel,
  supportsNativeRdpClipboard,
} from "./remote-desktop-profile";
import { formatSessionEnvironment, parseSessionEnvironment } from "./session-environment";
import { createTerminalHttpLinkProvider } from "./terminal-links";
import { approveTerminalPaste, prepareTerminalPaste, settleTerminalWrites, TerminalInputQueue } from "./terminal-input";
import { sanitizeTerminalTitle } from "./terminal-title";
import { terminalFontSizeAfterZoom } from "./terminal-zoom";
import { focusConnectedTerminal } from "./terminal-focus";
import { createSshAuthHandler, type SshAuthEvent } from "./ssh-authentication";
import { parseTunnelPort } from "./tunnel-port";
import { retainOperationHistory } from "./operation-history";
import { chooseOverwrite, confirmAction, confirmSessionStartup, promptText } from "./text-prompt";
import { remoteSessionCloseError, remoteSessionCloseStatus, remoteSessionStateError, sanitizeTerminalErrorDetail } from "./terminal-session-close";
import { cachedTheme, type ColorTheme } from "./theme";
import { boundedRemoteDesktopSize, enqueueRemoteDesktopPointer, mapRemoteDesktopPoint, remoteDesktopKeyCode, remoteDesktopKeyState, remoteDesktopPointerPoint, remoteDesktopSizeChanged, type RemoteDesktopPointerQueueItem, type RemoteDesktopPoint, type RemoteDesktopSize } from "./remote-desktop-input";
import { isRemoteMonitorRefreshInterval, REMOTE_MONITOR_REFRESH_INTERVALS } from "./remote-monitor";
import { remoteChildPath, remoteParentPath } from "./remote-path";
import { quoteRemotePromptPath } from "./remote-prompt";
import { normalizeDroppedUploadPaths } from "./transfer-input";
import desktopPackage from "../package.json";
import {
  preserveRemoteDesktopError,
  REMOTE_DESKTOP_FALLBACK_ERROR,
} from "./remote-desktop-errors";
import {
  appendMacroAction,
  appendMacroRecordingInput,
  createRecordedMacroDraft,
  macroTargetsStillBound,
  MAX_MACRO_ACTIONS,
  pinMacroTargets,
  type MacroAction,
  type MacroApprovalPolicy,
  type MacroKey,
  type MacroRecord,
  type MacroRecordingState,
  type MacroTargetBinding,
} from "./macro-recording";
import { isCurrentSessionRequest } from "./session-request";
import { resolveSavedJumpAlias } from "./saved-jump-alias";
import { acceptNetworkDiagnosticEvent, acceptNetworkDiagnosticResponse, beginNetworkDiagnostic, failNetworkDiagnosticStart, requestNetworkDiagnosticCancel, takePendingNetworkDiagnosticCancel, type NetworkDiagnosticRun } from "./network-diagnostic-lifecycle";
import {
  Activity,
  Monitor,
  LockKeyhole,
  Cable,
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  List,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleHelp,
  CircleX,
  Command,
  Copy,
  Download,
  ExternalLink,
  Folder,
  FolderPlus,
  Gauge,
  History,
  Home,
  KeyRound,
  LoaderCircle,
  LayoutDashboard,
  Maximize2,
  MoreHorizontal,
  Minimize2,
  Network,
  PanelBottom,
  PanelLeftClose,
  PanelRight,
  Pencil,
  Plus,
  Play,
  Radio,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Star,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";

type View = "generator" | "home" | "terminal" | "files" | "tunnels" | "monitor" | "transfers" | "audit";

type AppSettings = {
  general: {
    theme: "dark" | "light" | "system";
    confirmMultilinePaste: boolean;
    pastePreview: boolean;
    alwaysShowTerminalSearch: boolean;
    rightClickToPaste: boolean;
    tabPlusSavedSessions: boolean;
  };
  appearance: {
    fontSize: number;
  };
  terminal: TerminalAppearance & {
    scrollbackLines: number;
    cursorBlink: boolean;
    copyOnSelect: boolean;
  };
  keyboard: {
    newTerminal: string;
    quickConnect: string;
    commandPalette: string;
    closeTab: string;
    nextTab: string;
    previousTab: string;
    splitRight: string;
    splitDown: string;
    focusPane: string;
    searchTerminal: string;
    toggleSidebar: string;
    openMacros: string;
    emergencyBroadcastDisable: string;
  };
  ssh: {
    reconnectEnabled: boolean;
    reconnectAttempts: number;
    connectTimeoutMs: number;
  };
  network: {
    diagnosticTimeoutMs: number;
    scanConcurrency: number;
  };
};

type PortableVaultStatus = {
  enabled: boolean;
  unlocked: boolean;
  exists: boolean;
  path: string;
};


const defaultSettings: AppSettings = {
  general: { theme: "dark", confirmMultilinePaste: true, pastePreview: true, alwaysShowTerminalSearch: false, rightClickToPaste: false, tabPlusSavedSessions: false },
  appearance: { fontSize: 14 },
  terminal: { ...defaultTerminalAppearance, scrollbackLines: 5000, cursorBlink: true, copyOnSelect: false },
  keyboard: {
    newTerminal: "Mod+N",
    quickConnect: "Mod+K",
    commandPalette: "Mod+Shift+P",
    closeTab: "Mod+W",
    nextTab: "Ctrl+Tab",
    previousTab: "Ctrl+Shift+Tab",
    splitRight: "Mod+Shift+ArrowRight",
    splitDown: "Mod+Shift+ArrowDown",
    focusPane: "Mod+1",
    searchTerminal: "Mod+F",
    toggleSidebar: "Mod+Shift+B",
    openMacros: "Mod+Shift+M",
    emergencyBroadcastDisable: "Escape",
  },
  ssh: { reconnectEnabled: true, reconnectAttempts: 3, connectTimeoutMs: 12000 },
  network: { diagnosticTimeoutMs: 1500, scanConcurrency: 32 },
};

type TerminalOutputEvent = {
  terminalId: string;
  data: string;
};

type TerminalClosedEvent = {
  terminalId: string;
  reason?: string;
};

type TerminalStatus = "starting" | "connected" | "reconnecting" | "closed" | "error";

type DesktopProtocol = "rdp" | "vnc";

type RemoteDesktopConnectRequest = {
  protocol: DesktopProtocol;
  host: string;
  port: number;
  username: string;
  domain?: string;
  gatewayEndpoint?: string;
  gatewayUsername?: string;
  gatewayCredentialId?: string;
  credentialId?: string;
  width: number;
  height: number;
  colorDepth: number;
  audioEnabled: boolean;
  clipboardEnabled: boolean;
  vncQuality: "balanced" | "low-latency" | "low-bandwidth";
  allowInsecureVnc: boolean;
  reconnectEnabled: boolean;
  reconnectAttempts: number;
};

type RemoteDesktopConnectResponse = {
  sessionId: string;
  protocol: DesktopProtocol;
  host: string;
};

type RemoteDesktopCapabilities = {
  protocol: DesktopProtocol;
  clipboard: boolean;
  audio: boolean;
  serverResize: boolean;
  localScaling: boolean;
  gateway: boolean;
  transportEncrypted: boolean;
  colorDepths: number[];
};

type RemoteDesktopEvent =
    | { event: "hello"; payload: { version: number } }
    | { event: "capabilities"; payload: { capabilities: RemoteDesktopCapabilities } }
    | { event: "state"; payload: { state: "created" | "starting" | "ready" | "active" | "reconnecting" | "stopping" | "stopped" | "crashed" | "failed" } }
    | { event: "framebuffer"; payload: { width: number; height: number; generation: number } }
    | { event: "clipboard"; payload: { text: string } }
    | { event: "diagnostic"; payload: { level: string; message: string } };


type SshSessionEvent = {
  terminalId: string;
  state: "reconnecting" | "connected" | "failed" | "disconnected";
  attempt: number;
  error?: string | null;
};

type SshX11Event = {
  terminalId: string;
  state: "failed" | "disconnected";
  error?: string | null;
};

type TelnetSessionEvent = {
  terminalId: string;
  state: "connected" | "reconnecting" | "disconnected" | "failed";
  error?: string | null;
};

type SerialSessionEvent = {
  terminalId: string;
  state: "connected" | "reconnecting" | "disconnected" | "failed";
  error?: string | null;
};

type TerminalViewportProps = {
  label: string;
  colorTheme: ColorTheme;
  workspaceId: string;
  instanceKey: number;
  remoteSessionId: string | null;
  remoteProtocol: "ssh" | "telnet" | "serial" | DesktopProtocol | null;
  localTarget: LocalTerminalTarget;
  remoteDesktopRequest?: RemoteDesktopConnectRequest | null;
  terminalAppearance: TerminalAppearance;
  fontSize: number;
  scrollbackLines: number;
  cursorBlink: boolean;
  copyOnSelect: boolean;
  confirmMultilinePaste: boolean;
  rightClickToPaste: boolean;
  onStatusChange: (workspaceId: string, status: TerminalStatus) => void;
  onNativeTerminalId: (workspaceId: string, terminalId: string | null) => void;
  onInput: (workspaceId: string, terminalId: string, data: string) => void;
  onTerminalPaste: (workspaceId: string, nativeId: string | null, data: string, confirmationEnabled: boolean) => Promise<boolean>;
  onSaveSelectionShortcut: (workspaceId: string, selection: string) => void;
  onBranchSession: (workspaceId: string) => void;
  onTerminalReady: (workspaceId: string, terminal: Terminal, searchAddon: SearchAddon) => void;
  onTerminalDisposed: (workspaceId: string) => void;
  onSearchResults: (workspaceId: string, resultIndex: number, resultCount: number) => void;
  onTitleChange: (workspaceId: string, title: string) => void;
};

type WorkspaceTerminal = {
  shortcutDeviceId?: string;
  customName?: string;
  authentication?: TerminalAuthentication;
  connecting?: boolean;
  id: string;
  instanceKey: number;
  label: string;
  remoteSessionId: string | null;
  remoteProtocol: "ssh" | "telnet" | "serial" | DesktopProtocol | null;
  localTarget: LocalTerminalTarget;
  remoteDesktopRequest?: RemoteDesktopConnectRequest | null;
  remoteHost: string | null;
  status: TerminalStatus;
};


type LocalShell = "default" | "powershell" | "cmd" | "bash" | "zsh" | "fish";
type LocalShellChoice = Exclude<LocalShell, "default">;

type LocalTerminalTarget =
  | { type: "default"; shell?: LocalShell; cwd?: string; environment?: Array<[string, string]>; startupCommand?: string }
  | { type: "wsl"; distribution: string; cwd?: string; environment?: Array<[string, string]>; startupCommand?: string };

let terminalInstanceCounter = 0;

function createWorkspaceTerminal(config: Partial<Omit<WorkspaceTerminal, "id" | "instanceKey" | "status">> = {}): WorkspaceTerminal {
  terminalInstanceCounter += 1;
  return {
    id: crypto.randomUUID(),
    instanceKey: terminalInstanceCounter,
    label: "local shell",
    remoteSessionId: null,
    remoteProtocol: null,
    localTarget: { type: "default" },
    remoteHost: null,
    status: "starting",
    ...config,
  };
}

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const IS_ANDROID = /Android/i.test(navigator.userAgent);


type SessionListItem = {
  id?: string;
  name: string;
  detail: string;
  type: string;
  folder: string;
  active: boolean;
  favorite: boolean;
  tags: string[];
  lastUsedAt?: number | null;
};

type SavedSession = {
  id: string;
  name: string;
  protocol: string;
  hostname: string;
  port: number;
  username?: string | null;
  last_used_at?: number | null;
  known_hosts_path?: string | null;
  legacy_rsa?: boolean;
  pinned_fingerprint?: string | null;
  x11_display?: string | null;
  x11_single_connection?: boolean;
  server_alive_interval?: number | null;
  folder: string | null;
  pptp_profile_id?: string | null;
  jump_hosts: string[];
  tags: string[];
  favorite: boolean;
  startup_directory: string | null;
  startup_command: string | null;
  environment: Array<[string, string]>;
  notes: string | null;
  serial_profile?: {
    device: string;
    baud_rate: number;
    data_bits: "five" | "six" | "seven" | "eight";
    stop_bits: "one" | "two";
    parity: "none" | "odd" | "even";
    flow_control: "none" | "software" | "hardware";
    line_ending: "none" | "cr-lf" | "cr" | "lf";
  } | null;
  telnet_profile?: {
    terminal: string;
    encoding: "utf-8" | "windows-1252";
    columns: number;
    rows: number;
  } | null;
  jump_host_profiles?: SavedJumpHost[];
  remote_desktop_profile?: {
    domain?: string | null;
    gateway?: {
      endpoint: string;
      username: string;
      credential_ref: string;
    } | null;
    width: number;
    height: number;
    color_depth: number;
    audio_enabled: boolean;
    clipboard_enabled?: boolean;
    vnc_quality?: "balanced" | "low-latency" | "low-bandwidth";
    allow_insecure_vnc?: boolean;
    reconnect_enabled?: boolean;
    reconnect_attempts?: number;
  } | null;
  auth: SavedAuth;
};

type SavedAuth =
  | { kind: "none" }
  | { kind: "agent" }
  | { kind: "password"; credentialRef: string }
  | { kind: "privateKey"; keyRef: string; credentialRef?: string | null }
  | { kind: "keyboardInteractive"; credentialRef: string }
  | { kind: "keyboardInteractivePrompt" };

type SavedJumpHost = {
  host: string;
  port: number;
  username: string;
  known_hosts_path?: string | null;
  legacy_rsa?: boolean;
  pinned_fingerprint?: string | null;
  server_alive_interval?: number | null;
  auth: SavedAuth;
};

type OpenSshImportReport = {
  source: string;
  imported: SavedSession[];
  skippedHosts: string[];
  unsupportedDirectives: string[];
};

type SessionImportReport = {
  importedCount: number;
  skipped: string[];
};

type SessionNotice = string | { message: string; details: string[]; total: number };

type SnippetRecord = {
  id: string;
  title: string;
  description: string;
  command: string;
  tags: string[];
  variables: string[];
};

const MAX_SERVER_ALIVE_INTERVAL_SECONDS = 86_400;

function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split("+");
  const key = parts[parts.length - 1];
  const usesMod = parts.includes("Mod");
  const hasCtrl = parts.includes("Ctrl");
  if (usesMod ? !(event.metaKey || event.ctrlKey) : event.metaKey || event.ctrlKey !== hasCtrl) return false;
  if (event.altKey !== parts.includes("Alt") || event.shiftKey !== parts.includes("Shift")) return false;
  const expectedKey = key === "Space" ? " " : key;
  return event.key.toLowerCase() === expectedKey.toLowerCase();
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function formatShortcut(shortcut: string): string {
  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
  return shortcut.split("+").map((part) => {
    if (part === "Mod") return isMac ? "⌘" : "Ctrl";
    if (part === "Ctrl") return isMac ? "⌃" : "Ctrl";
    if (part === "Alt") return isMac ? "⌥" : "Alt";
    if (part === "Shift") return isMac ? "⇧" : "Shift";
    if (part === "Escape") return "Esc";
    return part;
  }).join(" ");
}

function normalizeMacroRecord(record: MacroRecord): MacroRecord {
  return { ...record, approval: record.approval ?? "beforeRun" };
}

type SshAuthRequest =
  | { method: "agent" }
  | { method: "keyboardInteractivePrompt" }
  | { method: "privateKey"; path: string; passphraseCredentialId?: string }
  | { method: "password"; credentialId: string }
  | { method: "keyboardInteractive"; credentialId: string };

type SshConnectRequest = {
  pptpProfileId?: string;
  host: string;
  port: number;
  username: string;
  auth: SshAuthRequest;
  knownHostsPath?: string;
  legacyRsa?: boolean;
  pinnedFingerprint?: string;
  jumpHosts?: SshJumpHostRequest[];
  x11?: {
    display: string;
    singleConnection: boolean;
  };
  serverAliveInterval?: number;
  environment?: Array<[string, string]>;
  startupDirectory?: string;
  startupCommand?: string;
  reconnectAttempts?: number;
  connectTimeoutMs?: number;
  cols: number;
  rows: number;
};

type SshJumpHostRequest = {
  host: string;
  port: number;
  username: string;
  auth: SshAuthRequest;
  knownHostsPath?: string;
  legacyRsa?: boolean;
  pinnedFingerprint?: string;
  serverAliveInterval?: number;
};

type SshConnectResponse = {
  terminalId: string;
  host: string;
};

type TelnetConnectRequest = {
  pptpProfileId?: string;
  username?: string;
  password?: string;
  savePassword?: boolean;
  credentialId?: string;
  host: string;
  port: number;
  terminal: string;
  encoding: "utf-8" | "windows-1252";
  columns: number;
  rows: number;
};

type TelnetConnectResponse = {
  credentialId?: string;
  terminalId: string;
  host: string;
};

type SerialConnectRequest = {
  device: string;
  baudRate: number;
  dataBits: "five" | "six" | "seven" | "eight";
  stopBits: "one" | "two";
  parity: "none" | "odd" | "even";
  flowControl: "none" | "software" | "hardware";
  lineEnding: "none" | "cr-lf" | "cr" | "lf";
};

type SerialDeviceInfo = {
  device: string;
  kind: string;
};

type SerialConnectResponse = {
  terminalId: string;
  device: string;
};

type RemoteEntry = {
  name: string;
  path: string;
  size: number | null;
  isDirectory: boolean;
  isRegular: boolean;
  isSymlink: boolean;
  modifiedUnixSeconds?: number | null;
  uid?: number | null;
  owner?: string | null;
  gid?: number | null;
  group?: string | null;
  permissions?: number | null;
};

type RemoteTextDocument = {
  path: string;
  content: string;
  revision: string;
  size: number;
  modifiedUnixSeconds?: number | null;
  permissions?: number | null;
  encoding: "utf-8" | "windows-1252";
  backupCleanupFailed?: boolean;
};

type RemoteMonitorSnapshot = {
  hostname?: string | null;
  kernel?: string | null;
  uptimeSeconds?: number | null;
  loadAverage?: [number, number, number] | null;
  memoryTotalBytes?: number | null;
  memoryAvailableBytes?: number | null;
  rootDiskUsedPercent?: number | null;
  processCount?: number | null;
  supportedMetrics: string[];
};

type TransferProtocol = "sftp" | "scp";
type LocalUploadPickerKind = "files" | "directory";
type RemoteFileSort = "name" | "type" | "size" | "modified";

type TransferState = "queued" | "preparing" | "running" | "paused" | "cancelling" | "cancelled" | "completed" | "failed";

type SshTransferEvent = {
  transferId: string;
  terminalId: string;
  direction: "download" | "upload";
  protocol: TransferProtocol;
  source: string;
  destination: string;
  recursive: boolean;
  bytesTransferred: number;
  totalBytes?: number | null;
  bytesPerSecond?: number | null;
  etaSeconds?: number | null;
  state: TransferState;
  error?: string | null;
};

type AuditEventKind = "sessionOpened" | "connectionSucceeded" | "connectionFailed" | "disconnected" | "transferCompleted" | "transferFailed";
type AuditProtocol = "SSH" | "SFTP" | "SCP" | "RDP" | "VNC" | "TELNET" | "SERIAL" | "LOCAL";
type AuditEvent = {
  id: string;
  timestamp: number;
  kind: AuditEventKind;
  sessionId?: string | null;
  protocol?: AuditProtocol | null;
};

type TunnelState = "listening" | "running" | "stopping" | "stopped" | "failed";

type SshTunnelEvent = {
  tunnelId: string;
  terminalId: string;
  localHost: string;
  localPort: number;
  targetHost: string;
  targetPort: number;
  kind: "local" | "dynamic" | "remote";
  state: TunnelState;
  connections: number;
  bytesForwarded: number;
  error?: string | null;
};

type TcpCheckResult = {
  host: string;
  port: number;
  status: "open" | "closed" | "timed-out" | "open-or-filtered" | "failed";
};

type TcpConnectReport = TcpCheckResult & { elapsedMs: number; output: string };

type SshHostKeyInspection = {
  host: string;
  port: number;
  fingerprint: string;
};

type NetworkScanEvent = {
  scanId: string;
  state: "running" | "completed" | "cancelled" | "failed";
  scanned: number;
  total: number;
  results: TcpCheckResult[];
  error?: string | null;
};

type PingResult = {
  host: string;
  sent: number;
  received: number;
  elapsedMs: number;
  intervalMs: number;
  packetSize: number;
  lines: string[];
};

type TracerouteResult = {
  host: string;
  reached: boolean;
  hops: string[];
  elapsedMs: number;
};

type NetworkDiagnosticEvent = {
  operationId: string;
  kind: "ping" | "mtr";
  state: "running" | "completed" | "cancelled" | "failed";
  ping?: PingResult | null;
  traceroute?: TracerouteResult | null;
  error?: string | null;
};

const previewSessions: SessionListItem[] = [
  { name: "Local workstation", detail: "zsh · localhost", type: "LOCAL", folder: "Local terminals", active: true, favorite: true, tags: ["local"], lastUsedAt: 3 },
  { name: "Production bastion", detail: "ops@bastion.example", type: "SSH", folder: "Production", active: false, favorite: true, tags: ["production"], lastUsedAt: 2 },
  { name: "Staging cluster", detail: "dev@staging.example", type: "SSH", folder: "Staging", active: false, favorite: false, tags: ["staging"], lastUsedAt: 1 },
];

function quickActions(keyboard: AppSettings["keyboard"]): Array<{ label: string; hint: string; icon: LucideIcon; shell?: LocalShellChoice }> {
  const isWindows = typeof navigator !== "undefined" && navigator.platform.includes("Win");
  const shellActions = isWindows
    ? [
      { label: "New PowerShell terminal", hint: "Windows", icon: TerminalIcon, shell: "powershell" as const },
      { label: "New cmd terminal", hint: "Windows", icon: TerminalIcon, shell: "cmd" as const },
    ]
    : [
      { label: "New bash terminal", hint: "Unix", icon: TerminalIcon, shell: "bash" as const },
      { label: "New zsh terminal", hint: "Unix", icon: TerminalIcon, shell: "zsh" as const },
      { label: "New fish terminal", hint: "Unix", icon: TerminalIcon, shell: "fish" as const },
    ];
  return [
    { label: "New local terminal", hint: formatShortcut(keyboard.newTerminal), icon: TerminalIcon },
    ...shellActions,
    ...(isWindows ? [{ label: "New WSL terminal", hint: "Windows", icon: TerminalIcon }] : []),
    { label: "Quick connect", hint: formatShortcut(keyboard.quickConnect), icon: Network },
    { label: "Open SFTP", hint: "", icon: Folder },
    { label: "Focus pane", hint: formatShortcut(keyboard.focusPane), icon: PanelRight },
    { label: "Settings", hint: "", icon: Settings2 },
    { label: "Credential vault", hint: "", icon: KeyRound },
    { label: "Snippets", hint: "", icon: BookOpen },
    { label: "Macros", hint: formatShortcut(keyboard.openMacros), icon: Play },
    { label: "Notes", hint: "Vendor CLI reference", icon: FileText },
    { label: "Audit history", hint: "", icon: History },
    { label: "Command palette", hint: formatShortcut(keyboard.commandPalette), icon: Command },
  ];
}

function auditProtocol(protocol: string | null | undefined): AuditProtocol | null {
  const normalized = protocol?.toUpperCase();
  return normalized === "SSH" || normalized === "SFTP" || normalized === "SCP" || normalized === "RDP" || normalized === "VNC" || normalized === "TELNET" || normalized === "SERIAL" || normalized === "LOCAL"
    ? normalized
    : null;
}

function TerminalViewport({ label, colorTheme, workspaceId, instanceKey, remoteSessionId, remoteProtocol, localTarget, terminalAppearance, fontSize, scrollbackLines, cursorBlink, copyOnSelect, confirmMultilinePaste, rightClickToPaste, onStatusChange, onNativeTerminalId, onInput, onTerminalPaste, onSaveSelectionShortcut, onBranchSession, onTerminalReady, onTerminalDisposed, onSearchResults, onTitleChange }: TerminalViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalIdRef = useRef<string | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const terminalFitRef = useRef<ReturnType<typeof createTerminalFitScheduler> | null>(null);
  const terminalOptionsRef = useRef({ fontSize, scrollbackLines, cursorBlink, colorTheme, terminalAppearance });
  const confirmMultilinePasteRef = useRef(confirmMultilinePaste);
  const copyOnSelectRef = useRef(copyOnSelect);
  useEffect(() => { copyOnSelectRef.current = copyOnSelect; }, [copyOnSelect]);
  const networkHighlightingRef = useRef<ReturnType<typeof attachNetworkHighlighting> | null>(null);
  const [clipboardError, setClipboardError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selection: string } | null>(null);
  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    const terminal = terminalRef.current;
    if (terminal && !isWorkspaceLocked()) focusConnectedTerminal(terminal, () => terminalRef.current === terminal && !isWorkspaceLocked());
  }, []);
  const pasteFromContextMenu = useCallback(async () => {
    const terminal = terminalRef.current, nativeId = terminalIdRef.current;
    if (!terminal || (!IS_TAURI && !navigator.clipboard?.readText)) throw new Error("Clipboard reader unavailable.");
    await pasteTerminalClipboard(readClipboardText, () => terminalRef.current === terminal && terminalIdRef.current === nativeId && !isWorkspaceLocked() && !!hostRef.current?.getClientRects().length && !hostRef.current?.closest('[hidden], [aria-hidden="true"]'), async text => {
      setContextMenu(null);
      const handled = await onTerminalPaste(workspaceId, nativeId, text, confirmMultilinePasteRef.current);
      if (!handled && terminalRef.current === terminal && !isWorkspaceLocked()) { revealPastedTerminal(terminal); terminal.paste(text); }
    });
  }, [onTerminalPaste, workspaceId]);


  useEffect(() => {
    terminalOptionsRef.current = { fontSize, scrollbackLines, cursorBlink, colorTheme, terminalAppearance };
    if (terminalRef.current) {
      const fontChanged = terminalRef.current.options.fontSize !== fontSize;
      const atBottom = terminalRef.current.buffer.active.viewportY >= terminalRef.current.buffer.active.baseY;
      terminalRef.current.options.fontSize = fontSize;
      terminalRef.current.options.cursorBlink = cursorBlink;
      terminalRef.current.options.theme = resolveTerminalTheme(colorTheme, terminalAppearance);
      terminalRef.current.options.scrollback = scrollbackLines;
      if (fontChanged) terminalFitRef.current?.schedule(atBottom);
      networkHighlightingRef.current?.refresh();
    }
  }, [colorTheme, cursorBlink, fontSize, scrollbackLines, terminalAppearance]);

  useEffect(() => {
    confirmMultilinePasteRef.current = confirmMultilinePaste;
  }, [confirmMultilinePaste]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let unlistenOutput: UnlistenFn | undefined;
    let unlistenClosed: UnlistenFn | undefined;
    let unlistenState: UnlistenFn | undefined;
    let unlistenX11: UnlistenFn | undefined;
    let hasReportedRemoteError = false;
    let terminalClosed = false;
    const releaseListeners = () => {
      unlistenOutput?.();
      unlistenClosed?.();
      unlistenState?.();
      unlistenX11?.();
      unlistenOutput = undefined;
      unlistenClosed = undefined;
      unlistenState = undefined;
      unlistenX11 = undefined;
    };
    const terminal = new Terminal({
      allowProposedApi: true,
      cols: IS_ANDROID ? ANDROID_TERMINAL_COLUMNS : 80,
      // Serial devices may emit bare LF; start the next prompt at column zero.
      convertEol: remoteProtocol === "serial",
      cursorBlink: terminalOptionsRef.current.cursorBlink,
      cursorStyle: "bar",
      fontFamily: '"Conxol Terminal", Consolas, "SFMono-Regular", monospace',
      fontWeight: "normal",
      fontWeightBold: "bold",
      minimumContrastRatio: 4.5,
      fontSize: terminalOptionsRef.current.fontSize,
      lineHeight: 1.2,
      scrollback: terminalOptionsRef.current.scrollbackLines,
      theme: resolveTerminalTheme(terminalOptionsRef.current.colorTheme, terminalOptionsRef.current.terminalAppearance),
    });
    terminalRef.current = terminal;
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    const searchAddon = new SearchAddon({ highlightLimit: 1000 });
    terminal.loadAddon(searchAddon);
    terminal.open(host);
    const gpuRenderer = IS_ANDROID ? attachTerminalGpuRenderer(terminal, () => new WebglAddon()) : null;
    // Terminal commands and credentials must not use browser writing assistance.
    const terminalInput = terminal.textarea;
    if (terminalInput) {
      terminalInput.spellcheck = false;
      terminalInput.setAttribute("autocomplete", "off");
      terminalInput.setAttribute("autocorrect", "off");
      terminalInput.setAttribute("autocapitalize", "off");
      terminalInput.setAttribute("writingsuggestions", "false");
      terminalInput.setAttribute("textprediction", "false");
    }
    const networkHighlighting = attachNetworkHighlighting(terminal, IS_ANDROID);
    networkHighlightingRef.current = networkHighlighting;
    const title = terminal.onTitleChange((value) => onTitleChange(workspaceId, value));
    const selectionCopy = terminal.onSelectionChange(() => {
      if (!copyOnSelectRef.current || disposed || isWorkspaceLocked() || !host.getClientRects().length || host.closest('[hidden], [aria-hidden="true"]')) return;
      const selection = terminal.getSelection();
      if (selection) void writeClipboardText(selection).catch(() => console.warn("Terminal selection could not be copied."));
    });
    const searchResults = searchAddon.onDidChangeResults((event) => onSearchResults(workspaceId, event.resultIndex, event.resultCount));
    const terminalLinks = terminal.registerLinkProvider(createTerminalHttpLinkProvider(
      (bufferLineNumber) => terminal.buffer.active.getLine(bufferLineNumber),
      async (url) => {
        if (await confirmAction(`Open this external URL?\n\n${url}`) && !disposed) window.open(url, "_blank", "noopener,noreferrer");
      },
    ));
    onTerminalReady(workspaceId, terminal, searchAddon);

    const fit = () => {
      if (disposed || host.clientWidth <= 0 || host.clientHeight <= 0) return false;
      if (IS_ANDROID) {
        if (!fitAndroidTerminal(terminal, fitAddon)) return false;
      } else { fitAddon.fit(); }
      const terminalId = terminalIdRef.current;
      if (IS_TAURI && terminalId && remoteProtocol !== "serial") {
        const resizeCommand = remoteProtocol === "ssh" ? "ssh_resize" : remoteProtocol === "telnet" ? "telnet_resize" : "terminal_resize";
        void invoke(resizeCommand, {
          terminalId,
          cols: terminal.cols,
          rows: terminal.rows,
        }).catch(() => undefined);
      }
      return true;
    };
    const fitScheduler = createTerminalFitScheduler(fit, () => terminal.scrollToBottom(), callback => window.requestAnimationFrame(callback), id => window.cancelAnimationFrame(id));
    terminalFitRef.current = fitScheduler;
    const pasteReveal = registerTerminalPasteReveal(terminal, () => fitScheduler.schedule());

    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(host);
    if (IS_ANDROID && host.parentElement) resizeObserver.observe(host.parentElement);
    const disposeHorizontalPan = IS_ANDROID && host.parentElement
      ? attachTerminalTouchPan(host.parentElement, () => !disposed && !isWorkspaceLocked() && host.isConnected && !host.closest('[hidden], [aria-hidden="true"]'), {
        rowHeight: () => (host.querySelector<HTMLElement>(".xterm-screen")?.clientHeight ?? host.clientHeight) / terminal.rows,
        scrollLines: lines => terminal.scrollLines(lines),
        viewportY: () => terminal.buffer.active.viewportY,
        normalBuffer: () => terminal.buffer.active.type === "normal",
      })
      : () => {};
    const initialFitFrame = window.requestAnimationFrame(fit);
    // A fallback font has different cell metrics. Re-measure after the bundled
    // faces load so glyphs and terminal columns stay aligned on first launch.
    void Promise.all([
      document.fonts.load(`400 ${terminalOptionsRef.current.fontSize}px "Conxol Terminal"`),
      document.fonts.load(`700 ${terminalOptionsRef.current.fontSize}px "Conxol Terminal"`),
    ]).then(() => {
      if (disposed) return;
      // Toggle the family to invalidate fallback measurements even when the
      // configured family string has not changed.
      terminal.options.fontFamily = "monospace";
      terminal.options.fontFamily = '"Conxol Terminal", Consolas, "SFMono-Regular", monospace';
      fit();
      terminal.refresh(0, terminal.rows - 1);
    }).catch(() => { /* The platform monospace fallback remains usable. */ });

    const sendTerminalInput = (data: string) => {
      const terminalId = terminalIdRef.current;
      if (!IS_TAURI || !terminalId) {
        terminal.write(data.replace(/\r/g, "\r\n"));
        return;
      }
      onInput(workspaceId, terminalId, data);
    };

    terminal.attachCustomKeyEventHandler(event => !handleTerminalControlKey(
      event, terminal,
      () => !disposed && !isWorkspaceLocked() && !!host.getClientRects().length && !host.closest('[hidden], [aria-hidden="true"]'),
      sendTerminalInput,
      text => { void writeClipboardText(text).catch(() => console.warn("Terminal selection could not be copied.")); },
    ));

    const input = terminal.onData((data) => {
      sendTerminalInput(data);
    });

    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData?.getData("text/plain");
      if (data === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      const nativeId = terminalIdRef.current;
      void onTerminalPaste(workspaceId, nativeId, data, confirmMultilinePasteRef.current).then((handled) => {
        // Only the browser preview falls back to xterm paste. A native paste is
        // sent to the exact destinations pinned before asynchronous approval.
        if (!handled && !disposed && terminalIdRef.current === nativeId) { revealPastedTerminal(terminal); terminal.paste(data); }
      }).catch(() => {
        if (!disposed) terminal.writeln("\r\nPaste could not be completed. Check the terminal before retrying.");
      });
    };
    host.addEventListener("paste", onPaste, true);

    const boot = async () => {
      onStatusChange(workspaceId, "starting");
      if (!IS_TAURI) {
        terminal.writeln("Conxol browser preview");
        terminal.writeln("The real PTY is enabled in the desktop runtime.");
        terminal.writeln("\x1b[38;5;179m$\x1b[0m preview --ready");
        onStatusChange(workspaceId, "connected");
        return;
      }

      try {
        const reportStateError = (state: "reconnecting" | "failed", reason: string | null | undefined) => {
          const error = remoteSessionStateError(remoteProtocol, state, reason);
          if (!error) return;
          terminal.writeln(`\r\n\x1b[38;5;203m${error}\x1b[0m`);
          hasReportedRemoteError = true;
        };
        const updateRemoteState = (terminalId: string, state: SshSessionEvent["state"], error?: string | null) => {
          if (terminalId !== terminalIdRef.current) return;
          if (state === "connected") {
            hasReportedRemoteError = false;
            onStatusChange(workspaceId, "connected");
          } else if (state === "reconnecting") {
            reportStateError("reconnecting", error);
            if (!error) hasReportedRemoteError = false;
            onStatusChange(workspaceId, "reconnecting");
          } else if (state === "failed") {
            reportStateError("failed", error);
            onStatusChange(workspaceId, "error");
          } else if (state === "disconnected") onStatusChange(workspaceId, remoteSessionCloseStatus(remoteProtocol, error));
        };
        const outputEvent = remoteProtocol === "ssh" ? "ssh://output" : remoteProtocol === "telnet" ? "telnet://output" : remoteProtocol === "serial" ? "serial://output" : "terminal://output";
        const closedEvent = remoteProtocol === "ssh" ? "ssh://closed" : remoteProtocol === "telnet" ? "telnet://closed" : remoteProtocol === "serial" ? "serial://closed" : "terminal://closed";
        unlistenOutput = await listen<TerminalOutputEvent>(outputEvent, (event) => {
          if (event.payload.terminalId === terminalIdRef.current) terminal.write(event.payload.data);
        });
        unlistenClosed = await listen<TerminalClosedEvent>(closedEvent, (event) => {
          if (event.payload.terminalId !== terminalIdRef.current) return;
          terminalClosed = true;
          const error = remoteSessionCloseError(remoteProtocol, event.payload.reason);
          if (error && !hasReportedRemoteError) terminal.writeln(`\r\n\x1b[38;5;203m${error}\x1b[0m`);
          onStatusChange(workspaceId, remoteSessionCloseStatus(remoteProtocol, event.payload.reason));
        });
        if (remoteProtocol === "ssh") {
          unlistenState = await listen<SshSessionEvent>("ssh://state", (event) => {
            updateRemoteState(event.payload.terminalId, event.payload.state, event.payload.error);
          });
          unlistenX11 = await listen<SshX11Event>("ssh://x11", (event) => {
            if (event.payload.terminalId !== terminalIdRef.current) return;
            if (event.payload.state === "failed") {
              const error = sanitizeTerminalErrorDetail(event.payload.error) ?? "display unavailable";
              terminal.writeln(`\r\n\x1b[38;5;203mX11 forwarding stopped: ${error}\x1b[0m`);
            }
          });
        }
        if (remoteProtocol === "telnet") {
          unlistenState = await listen<TelnetSessionEvent>("telnet://state", (event) => {
            updateRemoteState(event.payload.terminalId, event.payload.state, event.payload.error);
          });
        }
        if (remoteProtocol === "serial") {
          unlistenState = await listen<SerialSessionEvent>("serial://state", (event) => {
            updateRemoteState(event.payload.terminalId, event.payload.state, event.payload.error);
          });
        }
        if (disposed) {
          releaseListeners();
          return;
        }
        if (remoteSessionId) {
          terminalIdRef.current = remoteSessionId;
          onNativeTerminalId(workspaceId, remoteSessionId);
          const attachCommand = remoteProtocol === "ssh" ? "ssh_attach" : remoteProtocol === "telnet" ? "telnet_attach" : "serial_attach";
          const closeCommand = remoteProtocol === "ssh" ? "ssh_close" : remoteProtocol === "telnet" ? "telnet_close" : "serial_close";
          await invoke(attachCommand, { terminalId: remoteSessionId });
          if (disposed) {
            void invoke(closeCommand, { terminalId: remoteSessionId }).catch(() => undefined);
            return;
          }
          // A close event may arrive before attachment's IPC reply.
          if (terminalClosed) return;
          onStatusChange(workspaceId, "connected");
          fit();
          return;
        }
        const terminalId = await invoke<string>("terminal_spawn", {
          cols: terminal.cols,
          rows: terminal.rows,
          target: localTarget,
        });
        if (disposed) {
          void invoke("terminal_close", { terminalId }).catch(() => undefined);
          return;
        }
        terminalIdRef.current = terminalId;
        onNativeTerminalId(workspaceId, terminalId);
        fit();
        await invoke("terminal_attach", { terminalId });
        if (!disposed && !terminalClosed) onStatusChange(workspaceId, "connected");
      } catch {
        if (disposed) {
          releaseListeners();
          return;
        }
        if (!remoteProtocol && terminalIdRef.current) {
          const terminalId = terminalIdRef.current;
          terminalIdRef.current = null;
          onNativeTerminalId(workspaceId, null);
          void invoke("terminal_close", { terminalId }).catch(() => undefined);
        }
        onStatusChange(workspaceId, "error");
        const message = remoteProtocol
          ? `Unable to initialize the ${remoteProtocol.toUpperCase()} terminal session.`
          : "Unable to start the local PTY. Close this pane and retry; check the saved shell and startup settings.";
        terminal.writeln(`\r\n\x1b[38;5;203m${message}\x1b[0m`);
      }
    };
    void boot();

    return () => {
      disposed = true;
      input.dispose();
      title.dispose();
      selectionCopy.dispose();
      searchResults.dispose();
      networkHighlighting.dispose();
      networkHighlightingRef.current = null;
      terminalLinks.dispose();
      host.removeEventListener("paste", onPaste, true);
      pasteReveal.dispose();
      disposeHorizontalPan();
      fitScheduler.dispose();
      if (terminalFitRef.current === fitScheduler) terminalFitRef.current = null;
      resizeObserver.disconnect();
      window.cancelAnimationFrame(initialFitFrame);
      releaseListeners();
      const terminalId = terminalIdRef.current;
      onNativeTerminalId(workspaceId, null);
      if (IS_TAURI && terminalId) {
        const closeCommand = remoteProtocol === "ssh" ? "ssh_close" : remoteProtocol === "telnet" ? "telnet_close" : remoteProtocol === "serial" ? "serial_close" : "terminal_close";
        void invoke(closeCommand, { terminalId }).catch(() => undefined);
      }
      terminalIdRef.current = null;
      terminalRef.current = null;
      onTerminalDisposed(workspaceId);
      gpuRenderer?.dispose();
      terminal.dispose();
    };
  }, [instanceKey, localTarget, onTerminalPaste, onInput, onNativeTerminalId, onSearchResults, onStatusChange, onTerminalDisposed, onTerminalReady, onTitleChange, remoteProtocol, remoteSessionId, workspaceId]);

  useEffect(() => {
    // Renaming a pane updates its input name without restarting its session.
    terminalRef.current?.textarea?.setAttribute("aria-label", `${label} terminal input`);
  }, [label, instanceKey, localTarget, remoteProtocol, remoteSessionId]);

  return <><div className="terminal-scroll-frame"><div className="terminal-host" ref={hostRef} role="group" aria-label={`${label} · ${remoteProtocol ? remoteProtocol.toUpperCase() : "local"} terminal`} onContextMenuCapture={event => {
    event.preventDefault(); event.stopPropagation(); if (isWorkspaceLocked()) return;
    setClipboardError(null);
    if (rightClickToPaste && event.button === 2 && !event.shiftKey) {
      void pasteFromContextMenu().catch(() => setClipboardError("Clipboard access was blocked. Use the keyboard shortcut or Shift+right-click for terminal actions."));
      return;
    }
    setContextMenu({ x: event.clientX, y: event.clientY, selection: terminalRef.current?.getSelection() ?? "" });
  }} /></div>{clipboardError && <p role="alert">{clipboardError}</p>}{contextMenu && <TerminalContextMenu {...contextMenu} onClose={closeContextMenu} onCopy={async () => {
    if (isWorkspaceLocked()) return;
    if (!IS_TAURI && !navigator.clipboard?.writeText) throw new Error("Clipboard writer unavailable.");
    await writeClipboardText(contextMenu.selection);
  }} onBranch={remoteProtocol === "ssh" && remoteSessionId ? () => { setContextMenu(null); onBranchSession(workspaceId); } : undefined} onSaveShortcut={selection => { if (isWorkspaceLocked()) return; setContextMenu(null); onSaveSelectionShortcut(workspaceId, selection); }} onPaste={pasteFromContextMenu} onSelectAll={() => { if (!isWorkspaceLocked()) terminalRef.current?.selectAll(); }} />}</>;
}

function RemoteDesktopViewport({ workspaceId, instanceKey, request, onStatusChange, onNativeTerminalId }: {
  workspaceId: string;
  instanceKey: number;
  request: RemoteDesktopConnectRequest;
  onStatusChange: (workspaceId: string, status: TerminalStatus) => void;
  onNativeTerminalId: (workspaceId: string, terminalId: string | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const capabilitiesRef = useRef<RemoteDesktopCapabilities | null>(null);
  const [capabilities, setCapabilities] = useState<RemoteDesktopCapabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: request.width, height: request.height });
  const [remoteClipboard, setRemoteClipboard] = useState<string | null>(null);
  const [clipboardCopied, setClipboardCopied] = useState(false);
  const [connectAttempt, setConnectAttempt] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const lastRemotePointerRef = useRef<RemoteDesktopPoint | null>(null);
  const pressedRemoteKeysRef = useRef<Set<number>>(new Set());
  const pointerQueueRef = useRef<RemoteDesktopPointerQueueItem[]>([]);
  const pointerFlushActiveRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    let disposed = false;
    let failed = false;
    let resizeTimer: number | null = null;
    let pendingResize: RemoteDesktopSize | null = null;
    let lastSentResize: RemoteDesktopSize | null = null;

    const setErrorAndFail = (message: string) => {
      if (disposed) return;
      failed = true;
      frames.reset();
      const sessionId = sessionIdRef.current;
      if (sessionId) void invoke("remote_desktop_stop", { sessionId }).catch(() => undefined);
      setError(message);
      onStatusChange(workspaceId, "error");
    };

    const sendResize = () => {
      if (!remoteDesktopCanResize(request.protocol, capabilitiesRef.current)) return;
      const size = boundedRemoteDesktopSize(host.clientWidth, host.clientHeight);
      if (!size) return;
      setDimensions(size);
      pendingResize = size;
      if (resizeTimer !== null) return;
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        const next = pendingResize;
        pendingResize = null;
        const sessionId = sessionIdRef.current;
        if (disposed || !next || !IS_TAURI || !sessionId || !remoteDesktopSizeChanged(lastSentResize, next)) return;
        lastSentResize = next;
        void invoke("remote_desktop_resize", { sessionId, ...next }).catch(() => undefined);
      }, 75);
    };

    const frames = new RemoteFramebufferQueue(
      async (generation) => {
        const sessionId = sessionIdRef.current;
        if (disposed || !sessionId) return new ArrayBuffer(0);
        return invoke<ArrayBuffer>("remote_desktop_framebuffer", { sessionId, generation });
      },
      ({ width, height, pixels }) => {
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
          setDimensions({ width, height });
        }
        const context = canvas.getContext("2d");
        if (!context) throw new Error("The remote desktop renderer is unavailable.");
        context.putImageData(new ImageData(pixels, width, height), 0, 0);
      },
      (error) => setErrorAndFail(String(error)),
    );

    const boot = async () => {
      setError(null);
      setCapabilities(null);
      capabilitiesRef.current = null;
      setRemoteClipboard(null);
      setClipboardCopied(false);
      setFullscreenError(null);
      lastRemotePointerRef.current = null;
      pressedRemoteKeysRef.current.clear();
      pointerQueueRef.current = [];
      onStatusChange(workspaceId, "starting");
      if (!IS_TAURI) {
        setError(`${request.protocol.toUpperCase()} requires the desktop runtime; browser preview does not open remote hosts.`);
        onStatusChange(workspaceId, "error");
        return;
      }
      try {
        const onEvent = new Channel<RemoteDesktopEvent>((helperEvent) => {
          if (disposed) return;
          if (helperEvent.event === "capabilities") {
            if (helperEvent.payload.capabilities.protocol !== request.protocol) {
              setErrorAndFail("The remote desktop helper reported the wrong protocol.");
              return;
            }
            capabilitiesRef.current = helperEvent.payload.capabilities;
            setCapabilities(helperEvent.payload.capabilities);
            if (helperEvent.payload.capabilities.serverResize) sendResize();
          }
          if (helperEvent.event === "state") {
            if (helperEvent.payload.state === "ready" || helperEvent.payload.state === "active") {
              setError(null);
              onStatusChange(workspaceId, "connected");
            }
            if (helperEvent.payload.state === "reconnecting") {
              frames.reset();
              canvas.width = request.width;
              canvas.height = request.height;
              canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
              setDimensions({ width: request.width, height: request.height });
              capabilitiesRef.current = null;
              setCapabilities(null);
              setRemoteClipboard(null);
              setClipboardCopied(false);
              lastRemotePointerRef.current = null;
              pressedRemoteKeysRef.current.clear();
              pointerQueueRef.current = [];
              onStatusChange(workspaceId, "reconnecting");
            }
            if (helperEvent.payload.state === "failed" || helperEvent.payload.state === "crashed") {
              failed = true;
              frames.reset();
              setError((current) => preserveRemoteDesktopError(current, REMOTE_DESKTOP_FALLBACK_ERROR));
              onStatusChange(workspaceId, "error");
            }
            if (helperEvent.payload.state === "stopped") { failed = true; frames.reset(); onStatusChange(workspaceId, "closed"); }
          }
          if (helperEvent.event === "framebuffer") frames.request(helperEvent.payload.generation);
          if (helperEvent.event === "clipboard") {
            if (!remoteDesktopCanReceiveClipboard(request.protocol, request.clipboardEnabled, capabilitiesRef.current)) {
              setErrorAndFail("The remote desktop helper sent clipboard data without negotiated opt-in.");
              return;
            }
            setRemoteClipboard(helperEvent.payload.text);
            setClipboardCopied(false);
          }
          if (helperEvent.event === "diagnostic") setError(helperEvent.payload.message);
        });
        const response = await invoke<RemoteDesktopConnectResponse>("remote_desktop_start", { request, onEvent });
        if (disposed || failed) {
          void invoke("remote_desktop_stop", { sessionId: response.sessionId }).catch(() => undefined);
          return;
        }
        sessionIdRef.current = response.sessionId;
        onNativeTerminalId(workspaceId, response.sessionId);
        frames.refresh();
        sendResize();
      } catch (startError) {
        setErrorAndFail(String(startError));
      }
    };

    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === host);
    document.addEventListener("fullscreenchange", syncFullscreen);

    const observer = new ResizeObserver(sendResize);
    observer.observe(host);
    void boot();

    return () => {
      disposed = true;
      frames.dispose();
      lastRemotePointerRef.current = null;
      pressedRemoteKeysRef.current.clear();
      pointerQueueRef.current = [];
      observer.disconnect();
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = null;
      pendingResize = null;
      document.removeEventListener("fullscreenchange", syncFullscreen);
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      onNativeTerminalId(workspaceId, null);
      if (IS_TAURI && sessionId) void invoke("remote_desktop_stop", { sessionId }).catch(() => undefined);
    };
  }, [connectAttempt, instanceKey, onNativeTerminalId, onStatusChange, request, workspaceId]);

  const copyRemoteClipboard = async () => {
    if (remoteClipboard === null) return;
    if (!IS_TAURI && !navigator.clipboard?.writeText) {
      setError("The desktop runtime does not expose a safe clipboard writer.");
      return;
    }
    try {
      await writeClipboardText(remoteClipboard);
      setClipboardCopied(true);
    } catch {
      setError("Copying remote clipboard text was blocked by the desktop runtime.");
    }
  };

  const dismissRemoteClipboard = () => {
    setRemoteClipboard(null);
    setClipboardCopied(false);
  };

  const toggleFullscreen = async () => {
    const host = hostRef.current;
    if (!host) return;
    setFullscreenError(null);
    try {
      if (document.fullscreenElement === host) await document.exitFullscreen();
      else await host.requestFullscreen();
    } catch {
      setFullscreenError("Fullscreen mode was blocked by the desktop runtime.");
    }
  };

  const sendKey = (event: ReactKeyboardEvent<HTMLCanvasElement>, pressed: boolean) => {
    const sessionId = sessionIdRef.current;
    const code = remoteDesktopKeyCode(request.protocol, event.code, event.key);
    if (!IS_TAURI || !sessionId || code === null) return;
    event.preventDefault();
    pressedRemoteKeysRef.current = new Set(remoteDesktopKeyState([...pressedRemoteKeysRef.current], code, pressed));
    void invoke("remote_desktop_key", { sessionId, scancode: code, pressed }).catch((sendError) => setError(String(sendError)));
  };

  const flushPointerQueue = useCallback(async () => {
    if (pointerFlushActiveRef.current) return;
    pointerFlushActiveRef.current = true;
    try {
      while (pointerQueueRef.current.length > 0) {
        const item = pointerQueueRef.current.shift();
        if (!item || item.command.sessionId !== sessionIdRef.current) continue;
        try {
          await invoke("remote_desktop_pointer", item.command);
        } catch (sendError) {
          pointerQueueRef.current = [];
          setError(String(sendError));
          break;
        }
      }
    } finally {
      pointerFlushActiveRef.current = false;
    }
  }, []);

  const queuePointer = useCallback((command: { sessionId: string; x: number; y: number; buttons: number }, coalescible: boolean) => {
    pointerQueueRef.current = enqueueRemoteDesktopPointer(pointerQueueRef.current, { command, coalescible });
    if (!pointerFlushActiveRef.current) void flushPointerQueue();
  }, [flushPointerQueue]);

  const sendPointer = (event: ReactPointerEvent<HTMLCanvasElement>, coalescible = false) => {
    const sessionId = sessionIdRef.current;
    const canvas = canvasRef.current;
    if (!IS_TAURI || !sessionId || !canvas) return;
    const mapped = mapRemoteDesktopPoint(event.clientX, event.clientY, canvas.getBoundingClientRect(), canvas.width, canvas.height);
    const point = remoteDesktopPointerPoint(mapped, lastRemotePointerRef.current, event.buttons);
    if (!point) return;
    if (mapped) lastRemotePointerRef.current = mapped;
    const { x, y } = point;
    queuePointer({ sessionId, x, y, buttons: event.buttons }, coalescible);
    if (event.buttons === 0) lastRemotePointerRef.current = null;
  };

  const capturePointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    sendPointer(event);
  };

  const releasePointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    sendPointer(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const releaseRemoteInput = useCallback(() => {
    const sessionId = sessionIdRef.current;
    const lastPointer = lastRemotePointerRef.current;
    if (IS_TAURI && sessionId && lastPointer) {
      queuePointer({ sessionId, ...lastPointer, buttons: 0 }, false);
    }
    if (IS_TAURI && sessionId) {
      for (const scancode of pressedRemoteKeysRef.current) {
        void invoke("remote_desktop_key", { sessionId, scancode, pressed: false }).catch((sendError) => setError(String(sendError)));
      }
    }
    lastRemotePointerRef.current = null;
    pressedRemoteKeysRef.current.clear();
  }, [queuePointer]);

  useEffect(() => {
    window.addEventListener("blur", releaseRemoteInput);
    return () => window.removeEventListener("blur", releaseRemoteInput);
  }, [releaseRemoteInput]);

  const sendWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    const sessionId = sessionIdRef.current;
    const canvas = canvasRef.current;
    if (!IS_TAURI || !sessionId || !canvas || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    const point = mapRemoteDesktopPoint(event.clientX, event.clientY, canvas.getBoundingClientRect(), canvas.width, canvas.height);
    if (!point) return;
    const { x, y } = point;
    event.preventDefault();
    void invoke("remote_desktop_wheel", { sessionId, x, y, delta: event.deltaY > 0 ? 120 : -120 }).catch((sendError) => setError(String(sendError)));
  };

  const paste = (event: ReactClipboardEvent<HTMLCanvasElement>) => {
    const sessionId = sessionIdRef.current;
    const text = event.clipboardData.getData("text/plain");
    if (!IS_TAURI || !sessionId || !text) return;
    if (!remoteDesktopCanSendClipboard(request.protocol, request.clipboardEnabled, capabilitiesRef.current)) {
      event.preventDefault();
      setError(!request.clipboardEnabled
        ? `${request.protocol.toUpperCase()} clipboard redirection is disabled for this session.`
        : "The native helper does not advertise clipboard input for this session.");
      return;
    }
    event.preventDefault();
    void invoke("remote_desktop_clipboard", { payload: { sessionId, text } }).catch((sendError) => setError(String(sendError)));
  };

  return <div className="remote-desktop-viewport" ref={hostRef} aria-label={`${request.protocol.toUpperCase()} remote desktop`}>
    <canvas ref={canvasRef} className="remote-desktop-canvas" tabIndex={0} onKeyDown={(event) => sendKey(event, true)} onKeyUp={(event) => sendKey(event, false)} onPointerDown={capturePointer} onPointerUp={releasePointer} onPointerCancel={releasePointer} onPointerMove={(event) => event.buttons > 0 && sendPointer(event, true)} onWheel={sendWheel} onPaste={paste} onContextMenu={(event) => event.preventDefault()} />
    {remoteClipboard !== null && <div className="remote-desktop-clipboard" role="status" aria-live="polite"><div><strong>Remote clipboard received</strong><small>Review it before copying to this computer.</small></div><button type="button" className="outline-button" onClick={() => void copyRemoteClipboard()}><Copy size={13} />{clipboardCopied ? "Copied" : "Copy text"}</button><button type="button" className="outline-button" onClick={dismissRemoteClipboard}>Dismiss</button></div>}
    {error && <div className="remote-desktop-reconnect" role="alert"><div><strong>Remote desktop unavailable</strong><small>{error}</small></div><button type="button" className="outline-button" onClick={() => setConnectAttempt((attempt) => attempt + 1)}><RefreshCw size={13} />Reconnect</button></div>}
    {fullscreenError && <div className="remote-desktop-notice" role="status" aria-live="polite">{fullscreenError}</div>}
    <button type="button" className="remote-desktop-fullscreen" aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={() => void toggleFullscreen()}>{isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
    <div className="remote-desktop-overlay"><span className="eyebrow">{request.protocol.toUpperCase()} / NATIVE HELPER</span><strong>{dimensions.width} × {dimensions.height}</strong><small>Click the canvas to focus · input stays inside the native protocol boundary</small>{capabilities && <small>{capabilities.clipboard ? "Clipboard available" : "Clipboard unavailable"} · {capabilities.serverResize ? "server resize" : "local scaling"}{capabilities.gateway ? " · Gateway" : ""} · {remoteDesktopTransportLabel(capabilities)}</small>}{request.protocol === "vnc" && <small>Server resolution is unchanged · viewport scaling is local</small>}</div>
  </div>;
}

function TerminalLayoutView({
  node,
  terminals,
  renderPane,
  onFocus,
  onStartResize,
  onAdjustResize,
  onResetResize,
}: {
  node: TerminalLayoutNode;
  terminals: WorkspaceTerminal[];
  renderPane: (terminal: WorkspaceTerminal) => ReactNode;
  onFocus: (terminalId: string) => void;
  onStartResize: (event: ReactMouseEvent<HTMLDivElement>, path: SplitPath, direction: Exclude<SplitDirection, "none">) => void;
  onAdjustResize: (event: ReactKeyboardEvent<HTMLDivElement>, path: SplitPath, direction: Exclude<SplitDirection, "none">) => void;
  onResetResize: (path: SplitPath) => void;
}) {
  const paneBounds = new Map<string, { left: number; top: number; width: number; height: number }>();
  const collectBounds = (current: TerminalLayoutNode, left: number, top: number, width: number, height: number) => {
    if (current.kind === "pane") {
      paneBounds.set(current.terminalId, { left, top, width, height });
      return;
    }
    if (current.direction === "right") {
      const firstWidth = width * current.ratio / 100;
      collectBounds(current.first, left, top, firstWidth, height);
      collectBounds(current.second, left + firstWidth, top, width - firstWidth, height);
    } else {
      const firstHeight = height * current.ratio / 100;
      collectBounds(current.first, left, top, width, firstHeight);
      collectBounds(current.second, left, top + firstHeight, width, height - firstHeight);
    }
  };
  collectBounds(node, 0, 0, 100, 100);

  const renderGuides = (current: TerminalLayoutNode, path: SplitPath): ReactNode => {
    if (current.kind === "pane") return <div key={`slot-${current.terminalId}`} />;
    const dividerPath = path;
    const gridStyle = current.direction === "right"
      ? { gridTemplateColumns: `minmax(0, ${current.ratio}fr) 1px minmax(0, ${100 - current.ratio}fr)` }
      : { gridTemplateRows: `minmax(0, ${current.ratio}fr) 1px minmax(0, ${100 - current.ratio}fr)` };
    return <div key={`split-${path.join("-") || "root"}`} className={`terminal-layout-split terminal-layout-split-${current.direction}`} style={gridStyle}>
      {renderGuides(current.first, [...path, "first"])}
      <div
        className={`terminal-split-divider terminal-split-divider-${current.direction}`}
        role="separator"
        aria-orientation={current.direction === "right" ? "vertical" : "horizontal"}
        tabIndex={0}
        aria-label="Resize split panes"
        aria-valuemin={20}
        aria-valuemax={80}
        aria-valuenow={Math.round(current.ratio)}
        onMouseDown={(event) => onStartResize(event, dividerPath, current.direction)}
        onDoubleClick={() => onResetResize(dividerPath)}
        onKeyDown={(event) => onAdjustResize(event, dividerPath, current.direction)}
      />
      {renderGuides(current.second, [...path, "second"])}
    </div>;
  };

  return <div className="terminal-layout-root">
    {terminals.map((terminal) => {
      const bounds = paneBounds.get(terminal.id);
      const style = bounds ? {
        left: `${bounds.left}%`,
        top: `${bounds.top}%`,
        width: `${bounds.width}%`,
        height: `${bounds.height}%`,
      } : undefined;
      return <div key={`pane-${terminal.id}`} className={`terminal-pane terminal-layout-pane ${bounds ? "active" : "terminal-pane-hidden"}`} style={style} aria-hidden={!bounds} onMouseDown={() => onFocus(terminal.id)} onFocusCapture={() => onFocus(terminal.id)}>{renderPane(terminal)}</div>;
    })}
    {node.kind === "split" && <div className="terminal-layout-guides">{renderGuides(node, [])}</div>}
  </div>;
}

// One owner prevents tool dialogs from stacking. A stale close callback may
// close its own dialog only, so it cannot dismiss a tool opened afterward.
function useToolDialog(name: string, active: string | null, setActive: React.Dispatch<React.SetStateAction<string | null>>) {
  const setOpen = useCallback((open: React.SetStateAction<boolean>) => {
    setActive(current => (typeof open === "function" ? open(current === name) : open) ? name : current === name ? null : current);
  }, [name, setActive]);
  return [active === name, setOpen] as const;
}

function App() {
  const workspaceSecurity = useWorkspaceLock();
  const storeUpdates = useStoreUpdates(workspaceSecurity.status?.locked === false);
  useEffect(() => {
    if (!IS_TAURI) return;
    void invoke<{ workspaceId: string; preferences: Record<string, string> } | null>("workspace_backup_preferences").then(snapshot => {
      if (!snapshot || localStorage.getItem("conxol.restoredWorkspace") === snapshot.workspaceId) return;
      applyWorkspacePreferences(snapshot);
      window.location.reload();
    }).catch(() => { /* Restored preferences are applied after workspace unlock as well. */ });
  }, [workspaceSecurity.status?.locked]);

  const [activeView, setActiveView] = useState<View>("home");
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [terminalTabs, setTerminalTabs] = useState<WorkspaceTerminal[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState("");
  const [terminalLayout, setTerminalLayout] = useState<TerminalLayoutNode>({ kind: "pane", terminalId: "" });
  const rememberedTerminalLayouts = useRef(new Map<string, TerminalLayoutNode>());
  useEffect(() => { rememberTerminalLayout(rememberedTerminalLayouts.current, terminalLayout); }, [terminalLayout]);
  const terminalSearchInputRef = useRef<HTMLInputElement>(null);
  const [terminalSearchOpen, setTerminalSearchOpen] = useState(false);
  const [terminalSearchQuery, setTerminalSearchQuery] = useState("");
  const [terminalSearchCaseSensitive, setTerminalSearchCaseSensitive] = useState(false);
  const [terminalSearchResult, setTerminalSearchResult] = useState({ resultIndex: -1, resultCount: 0 });
  const [search, setSearch] = useState("");
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [sidebarSize, setSidebarSize] = useState(() => {
    try { const value = localStorage.getItem("conxol.sidebarWidth") ?? localStorage.getItem("termix.sidebarWidth") ?? localStorage.getItem("mobarust.sidebarWidth"); return sidebarWidth(value ? Number(value) : DEFAULT_SIDEBAR_WIDTH, window.innerWidth); } catch { return DEFAULT_SIDEBAR_WIDTH; }
  });
  const sidebarDrag = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => { try { localStorage.setItem("conxol.sidebarWidth", String(sidebarSize)); } catch { /* Storage is optional. */ } }, [sidebarSize]);
  useEffect(() => {
    const clamp = () => setSidebarSize((width) => sidebarWidth(width, window.innerWidth));
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, []);
  const [sidebarMode, setSidebarMode] = useState<"sessions" | "files" | "shortcuts" | "notes">("sessions");
  const [activeToolDialog, setActiveToolDialog] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useToolDialog("palette", activeToolDialog, setActiveToolDialog);
  const [savedSessionPickerOpen, setSavedSessionPickerOpen] = useToolDialog("savedSessionPicker", activeToolDialog, setActiveToolDialog);
  const [quickConnectOpen, setQuickConnectOpen] = useToolDialog("quickConnect", activeToolDialog, setActiveToolDialog);
  const [wslTerminalOpen, setWslTerminalOpen] = useToolDialog("wslTerminal", activeToolDialog, setActiveToolDialog);
  const [helpOpen, setHelpOpen] = useToolDialog("help", activeToolDialog, setActiveToolDialog);
  const [aboutOpen, setAboutOpen] = useToolDialog("about", activeToolDialog, setActiveToolDialog);
  const [settingsOpen, setSettingsOpen] = useToolDialog("settings", activeToolDialog, setActiveToolDialog);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const openSettings = () => { setSettingsError(null); setSettingsOpen(true); };
  const [credentialsOpen, setCredentialsOpen] = useToolDialog("credentials", activeToolDialog, setActiveToolDialog);
  const [snippetsOpen, setSnippetsOpen] = useToolDialog("snippets", activeToolDialog, setActiveToolDialog);
  const [macrosOpen, setMacrosOpen] = useToolDialog("macros", activeToolDialog, setActiveToolDialog);
  const setNotesOpen = useCallback((open: boolean) => {
    if (open) setSidebarOpen(true);
    setSidebarMode(current => open ? "notes" : current === "notes" ? "sessions" : current);
  }, []);
  const [broadcastOpen, setBroadcastOpen] = useToolDialog("broadcast", activeToolDialog, setActiveToolDialog);
  const [broadcastEnabled, setBroadcastEnabled] = useState(false);
  const [broadcastTargetIds, setBroadcastTargetIds] = useState<string[]>([]);
  const [macroRun, setMacroRun] = useState<{ title: string; step: number; total: number; targets: string[] } | null>(null);
  const [macroRecording, setMacroRecording] = useState<MacroRecordingState | null>(null);
  const [recordedMacroDraft, setRecordedMacroDraft] = useState<MacroRecord | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => ({ ...defaultSettings, general: { ...defaultSettings.general, theme: cachedTheme() } }));
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const colorTheme: ColorTheme = settings.general.theme === "system" ? (systemDark ? "dark" : "light") : settings.general.theme;
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = colorTheme;
    document.documentElement.style.colorScheme = colorTheme;
    try { localStorage.setItem("conxol-theme", settings.general.theme); } catch { /* Native settings still persist when browser storage is unavailable. */ }
  }, [colorTheme, settings.general.theme]);
  const windowThemeUpdate = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!IS_TAURI) return;
    let cancelled = false;
    windowThemeUpdate.current = windowThemeUpdate.current.catch(() => undefined).then(async () => {
      if (!cancelled) await getCurrentWindow().setTheme(colorTheme);
    }).catch(error => console.warn("Could not update window theme", error));
    return () => { cancelled = true; };
  }, [colorTheme]);
  const settingsRef = useRef(settings);
  const zoomPersistTimerRef = useRef<number | null>(null);
  const [portableVaultStatus, setPortableVaultStatus] = useState<PortableVaultStatus | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [pendingSavedSession, setPendingSavedSession] = useState<{ id: string; name: string } | null>(null);
  const [sessionFolderState, setSessionFolderState] = useState<Record<string, boolean>>(() => {
    try { return parseSessionFolderState(localStorage.getItem("conxol.sessionFolders") ?? localStorage.getItem("termix.sessionFolders")); } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem("conxol.sessionFolders", JSON.stringify(sessionFolderState)); } catch { /* Keep in-memory state when storage is unavailable. */ }
  }, [sessionFolderState]);
  const [createdSessionFolders, setCreatedSessionFolders] = useState<string[]>(() => {
    try { return parseSessionFolders(localStorage.getItem("conxol.createdSessionFolders")); } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem("conxol.createdSessionFolders", JSON.stringify(createdSessionFolders)); } catch { /* Keep folders in memory if storage is unavailable. */ }
  }, [createdSessionFolders]);
  const [folderStyles, setFolderStyles] = useState<Record<string, FolderStyle>>(() => {
    try { return readFolderStyles(localStorage.getItem("conxol.folderStyles")); } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem("conxol.folderStyles", JSON.stringify(folderStyles)); } catch { /* Keep in memory. */ } }, [folderStyles]);
  const [hostStyles, setHostStyles] = useState<Record<string, FolderStyle>>(() => {
    try { return readFolderStyles(localStorage.getItem("conxol.hostStyles")); } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem("conxol.hostStyles", JSON.stringify(hostStyles)); } catch { /* Keep in memory. */ } }, [hostStyles]);
  const [customizingHost, setCustomizingHost] = useState<SavedSession | null>(null);
  const [customizingFolder, setCustomizingFolder] = useState<string | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<{ folder: string; x: number; y: number } | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null);
  const folderDeletionInProgress = useRef(false);
  const draggedSessionId = useRef<string | null>(null);
  const folderMoveInProgress = useRef(false);
  const folderDrag = useRef<{ folder: string; x: number; y: number; active: boolean } | null>(null);
  const suppressFolderClick = useRef(false);
  const [sessionDropTarget, setSessionDropTarget] = useState<string | null>(null);
  const createSessionFolder = async (parent = "") => {
    const name = (await promptText("New session folder (use / for nesting)", parent ? `${parent}/` : ""))?.trim();
    if (!name) return;
    if (name.length > 128) { setConnectionError("Folder names must be 128 characters or fewer."); return; }
    setCreatedSessionFolders(current => [...new Set([...current, name])]);
    setSessionFolderState(current => ({ ...current, ...sessionFolderOpenState(name) }));
  };
  const changeSessionFolder = (key: string, open: boolean) => setSessionFolderState(current =>
    (current[key] ?? true) === open ? current : { ...current, [key]: open });
  const expandSessionFolders = (open: boolean) => setSessionFolderState(Object.fromEntries([
    ...createdSessionFolders.flatMap(folder => sessionFolderAncestors(folder).map(path => [`folder:${path}`, open])),
    ...sessionRows.flatMap(session => sessionFolderAncestors(session.folder.trim()).map(path => [`folder:${path}`, open])),
  ]));
  const savedSessionAttempt = useRef(new ConnectionAttemptGate());
  const sshConnectionAttempt = useRef(new ConnectionAttemptGate());
  const [sshConnecting, setSshConnecting] = useState(false);
  const [sessionListError, setSessionListError] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState<SessionNotice | null>(null);
  useEffect(() => {
    if (typeof sessionNotice !== "string") return;
    const timer = window.setTimeout(() => {
      setSessionNotice(current => current === sessionNotice ? null : current);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [sessionNotice]);
  const [closing, setClosing] = useState(false);
  const [tftpServerRunning, setTftpServerRunning] = useState(false);
  const [fileTransferOpen, setFileTransferOpen] = useToolDialog("fileTransfer", activeToolDialog, setActiveToolDialog);
  const [syntaxSettingsOpen, setSyntaxSettingsOpen] = useToolDialog("syntaxSettings", activeToolDialog, setActiveToolDialog);
  const [pptpManagerOpen, setPptpManagerOpen] = useToolDialog("pptpManager", activeToolDialog, setActiveToolDialog);
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === "undefined" || !window.matchMedia("(max-width: 720px)").matches);
  const notesOpen = sidebarOpen && sidebarMode === "notes";
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [appVersion, setAppVersion] = useState(desktopPackage.version);
  const [sessionRows, setSessionRows] = useState<SessionListItem[]>(IS_TAURI ? [] : previewSessions);
  const [recentOnly, setRecentOnly] = useState(false);
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [snippets, setSnippets] = useState<SnippetRecord[]>([]);
  const setShortcutsOpen = useCallback((open: boolean) => {
    if (open) setSidebarOpen(true);
    setSidebarMode(current => open ? "shortcuts" : current === "shortcuts" ? "sessions" : current);
  }, []);
  const [shortcutSelectionDraft, setShortcutSelectionDraft] = useState<ShortcutRecord | null>(null);
  const [macros, setMacros] = useState<MacroRecord[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [editingSession, setEditingSession] = useState<SavedSession | null>(null);
  const [remotePath, setRemotePath] = useState(".");
  const [remoteEntries, setRemoteEntries] = useState<RemoteEntry[]>([]);
  const [remoteListingSessionId, setRemoteListingSessionId] = useState<string | null>(null);
  const [remoteDirectoryError, setRemoteDirectoryError] = useState<string | null>(null);
  const [editingRemoteFile, setEditingRemoteFile] = useState<{ sessionId: string; document: RemoteTextDocument; stillConnected: () => boolean } | null>(null);
  const [sftpStatus, setSftpStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const sftpAvailabilityRef = useRef(new Map<string, boolean>());
  const [localDropActive, setLocalDropActive] = useState(false);
  const [transfers, setTransfers] = useState<SshTransferEvent[]>([]);
  const [tunnels, setTunnels] = useState<SshTunnelEvent[]>([]);
  const [tunnelDraft, setTunnelDraft] = useState<{ kind: "local" | "remote" | "dynamic"; terminalId: string } | null>(null);
  const [remoteMonitor, setRemoteMonitor] = useState<RemoteMonitorSnapshot | null>(null);
  const [remoteMonitorStatus, setRemoteMonitorStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [remoteMonitorError, setRemoteMonitorError] = useState<string | null>(null);
  const [remoteMonitorLive, setRemoteMonitorLive] = useState(false);
  const [remoteMonitorIntervalSeconds, setRemoteMonitorIntervalSeconds] = useState<number>(30);
  const remoteMonitorRequestRef = useRef<{ requestId: number; sessionId: string } | null>(null);
  const remoteMonitorRequestSequenceRef = useRef(0);
  const remoteMonitorGenerationRef = useRef(0);
  const remoteDirectoryRequestRef = useRef(0);
  const remoteFileOpenRequestRef = useRef(0);
  const remoteSessionIdRef = useRef<string | null>(null);
  const [networkHost, setNetworkHost] = useState("");
  const [networkPort, setNetworkPort] = useState("22");
  const [networkTcpPort, setNetworkTcpPort] = useState("80");
  const [networkTimeout, setNetworkTimeout] = useState(() => String(settings.network.diagnosticTimeoutMs));
  const [networkStatus, setNetworkStatus] = useState<"idle" | "running" | "ready" | "error">("idle");
  const [dnsReport, setDnsReport] = useState<{ tool: string; output: string; elapsedMs: number } | null>(null);
  const [dnsRecordType, setDnsRecordType] = useState("A");
  const [dnsServer, setDnsServer] = useState("");
  const [networkResult, setNetworkResult] = useState<TcpConnectReport | null>(null);
  const [networkFingerprint, setNetworkFingerprint] = useState<SshHostKeyInspection | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [networkDiagnosticKind, setNetworkDiagnosticKind] = useState<"ping" | "mtr" | null>(null);
  const [networkDiagnosticStatus, setNetworkDiagnosticStatus] = useState<"idle" | "running" | "completed" | "cancelled" | "failed">("idle");
  const [pingInterval, setPingInterval] = useState("1000");
  const [pingPacketSize, setPingPacketSize] = useState("32");
  const [networkPingResult, setNetworkPingResult] = useState<PingResult | null>(null);
  const [networkMtrResult, setNetworkMtrResult] = useState<TracerouteResult | null>(null);
  const [networkTraceMaxHops, setNetworkTraceMaxHops] = useState("8");
  const [networkScanId, setNetworkScanId] = useState<string | null>(null);
  const [networkScanStatus, setNetworkScanStatus] = useState<"idle" | "running" | "completed" | "cancelled" | "failed">("idle");
  const [networkScanProtocol, setNetworkScanProtocol] = useState<"tcp" | "udp">("tcp");
  const [networkScanStart, setNetworkScanStart] = useState("1");
  const [networkScanEnd, setNetworkScanEnd] = useState("1024");
  const [networkScanConcurrency, setNetworkScanConcurrency] = useState(() => String(settings.network.scanConcurrency));
  useEffect(() => {
    setNetworkTimeout(String(settings.network.diagnosticTimeoutMs));
    setNetworkScanConcurrency(String(settings.network.scanConcurrency));
  }, [settings.network.diagnosticTimeoutMs, settings.network.scanConcurrency]);
  const [networkScanScanned, setNetworkScanScanned] = useState(0);
  const [networkScanTotal, setNetworkScanTotal] = useState(0);
  const [networkScanResults, setNetworkScanResults] = useState<TcpCheckResult[]>([]);
  const networkScanIdRef = useRef<string | null>(null);
  const networkDiagnosticRunRef = useRef<NetworkDiagnosticRun>({ generation: 0, currentId: null, finishedId: null, ignoredId: null, starting: false, cancelRequested: false });
  const nativeTerminalIdsRef = useRef(new Map<string, string>());
  const terminalInputQueueRef = useRef(new TerminalInputQueue());
  const terminalInstancesRef = useRef(new Map<string, { terminal: Terminal; searchAddon: SearchAddon }>());
  const selectedTerminalIdRef = useRef("");
  const terminalTabsRef = useRef(terminalTabs);
  const broadcastEnabledRef = useRef(broadcastEnabled);
  const broadcastTargetIdsRef = useRef(broadcastTargetIds);
  const macroRecordingRef = useRef<MacroRecordingState | null>(macroRecording);
  const macroCancelRef = useRef(false);
  const macroRunRef = useRef<{ title: string; step: number; total: number; targets: string[] } | null>(null);
  const terminalAuditStateRef = useRef(new Map<string, TerminalStatus>());
  const terminalGenerationsRef = useRef(new Map<string, number>());
  const transferAuditStateRef = useRef(new Map<string, TransferState>());
  const splitResizeRef = useRef<{ direction: Exclude<SplitDirection, "none">; frame: HTMLElement; path: SplitPath } | null>(null);
  terminalTabsRef.current = terminalTabs;
  settingsRef.current = settings;
  broadcastEnabledRef.current = broadcastEnabled;
  broadcastTargetIdsRef.current = broadcastTargetIds;
  macroRecordingRef.current = macroRecording;
  macroRunRef.current = macroRun;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 720px)");
    const syncSidebarToViewport = () => setSidebarOpen(!mediaQuery.matches);
    syncSidebarToViewport();
    mediaQuery.addEventListener("change", syncSidebarToViewport);
    return () => mediaQuery.removeEventListener("change", syncSidebarToViewport);
  }, []);

  useEffect(() => {
    const onPointerMove = (event: MouseEvent) => {
      const resize = splitResizeRef.current;
      if (!resize) return;
      const bounds = resize.frame.getBoundingClientRect();
      const position = resize.direction === "right"
        ? event.clientX - bounds.left
        : event.clientY - bounds.top;
      const length = resize.direction === "right" ? bounds.width : bounds.height;
      if (length <= 0) return;
      const ratio = Math.max(20, Math.min(80, (position / length) * 100));
      setTerminalLayout((current) => updateLayoutRatio(current, resize.path, ratio));
    };
    const onPointerUp = () => {
      splitResizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp);
    return () => {
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("mouseup", onPointerUp);
      onPointerUp();
    };
  }, []);

  const activeTerminal = terminalTabs.find((terminal) => terminal.id === activeTerminalId) ?? terminalTabs[0];
  const selectedTerminalId = activeTerminal?.id ?? "";

  useEffect(() => {
    if (!IS_ANDROID || activeView !== "terminal") return;
    document.querySelector(".desktop-session-tabs .terminal-tab.selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedTerminalId, activeView]);

  selectedTerminalIdRef.current = selectedTerminalId;
  const remoteSessionId = activeTerminal?.remoteSessionId ?? null;
  remoteSessionIdRef.current = remoteSessionId;
  const remoteProtocol = activeTerminal?.remoteProtocol ?? null;
  const remoteHost = activeTerminal?.remoteHost ?? null;
  const terminalStatus = activeTerminal?.status ?? "closed";
  const selectedWindowTitle = workspaceSecurity.status?.locked ? "Conxol - Workspace locked" : activeView === "home"
    ? "Conxol - Your network, in command"
    : activeView === "terminal"
      ? `${sanitizeTerminalTitle(activeTerminal?.label ?? "") || sanitizeTerminalTitle(remoteHost ?? "") || "Terminal"} - Conxol`
      : `${activeView === "files" ? "Remote files" : activeView === "monitor" ? "Remote monitoring" : activeView[0].toUpperCase() + activeView.slice(1)} - Conxol`;
  const windowTitleUpdate = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    document.title = selectedWindowTitle;
    if (!IS_TAURI) return;
    let cancelled = false;
    // Keep native title updates ordered when switching tabs rapidly.
    windowTitleUpdate.current = windowTitleUpdate.current.catch(() => undefined).then(async () => {
      if (!cancelled) await getCurrentWindow().setTitle(selectedWindowTitle);
    }).catch(error => console.warn("Could not update window title", error));
    return () => { cancelled = true; };
  }, [selectedWindowTitle]);


  useEffect(() => {
    setSidebarMode(current => (current === "shortcuts" || current === "notes") ? current : remoteProtocol === "ssh" && remoteSessionId && sftpAvailabilityRef.current.get(remoteSessionId) !== false ? "files" : "sessions");
  }, [remoteProtocol, remoteSessionId]);

  useEffect(() => {
    remoteFileOpenRequestRef.current += 1;
  }, [remoteSessionId]);

  useEffect(() => {
    if (!activeTerminalId && activeTerminal) setActiveTerminalId(activeTerminal.id);
    if (activeTerminal && terminalLayout.kind === "pane" && !terminalLayout.terminalId) {
      setTerminalLayout({ kind: "pane", terminalId: activeTerminal.id });
    }
  }, [activeTerminal, activeTerminalId, terminalLayout]);

  useEffect(() => {
    const stopActivity = () => {
      macroCancelRef.current = true;
      broadcastEnabledRef.current = false;
      macroRecordingRef.current = null;
      setBroadcastEnabled(false);
      setMacroRecording(null);
      setRemoteMonitorLive(false);
    };
    window.addEventListener("conxol:workspace-locked", stopActivity);
    return () => window.removeEventListener("conxol:workspace-locked", stopActivity);
  }, []);

  const startNewTerminal = useCallback((target: LocalTerminalTarget = { type: "default" }, label?: string, shortcutDeviceId?: string) => {
    const shellLabel = target.type === "default" && target.shell && target.shell !== "default"
      ? target.shell === "powershell" ? "PowerShell" : target.shell
      : "local shell";
    const terminal = createWorkspaceTerminal({
      label: label ?? (target.type === "wsl" ? `WSL · ${target.distribution}` : shellLabel),
      localTarget: target,
      shortcutDeviceId: shortcutDeviceId ?? `local:${JSON.stringify(target.type === "wsl" ? [target.type, target.distribution] : [target.type, target.shell ?? "default"])}`,
    });
    setTerminalTabs((current) => [...current, terminal]);
    setActiveTerminalId(terminal.id);
    setTerminalLayout({ kind: "pane", terminalId: terminal.id });
    setConnectionError(null);
    setSessionNotice(null);
    setActiveView("terminal");
  }, []);

  const startExplicitShell = useCallback((shell: LocalShellChoice) => {
    const isWindowsShell = shell === "powershell" || shell === "cmd";
    const isWindows = navigator.platform.includes("Win");
    if (isWindowsShell !== isWindows) {
      setSessionNotice(`${shell === "powershell" ? "PowerShell" : shell} is available only in its supported desktop runtime.`);
      setPaletteOpen(false);
      return;
    }
    startNewTerminal({ type: "default", shell }, shell === "powershell" ? "PowerShell" : shell);
  }, [setPaletteOpen, startNewTerminal]);

  const openWslTerminalPicker = useCallback(() => {
    setPaletteOpen(false);
    setWslTerminalOpen(true);
  }, [setPaletteOpen, setWslTerminalOpen]);

  const startWslTerminal = useCallback((distribution: string) => {
    startNewTerminal({ type: "wsl", distribution });
    setWslTerminalOpen(false);
  }, [setWslTerminalOpen, startNewTerminal]);

  const openSftpView = useCallback(() => {
    if (remoteSessionId && remoteProtocol === "ssh") {
      setActiveView("files");
      return;
    }
    setConnectionError("Open an SSH session before opening SFTP.");
    setQuickConnectOpen(true);
  }, [remoteProtocol, remoteSessionId, setQuickConnectOpen]);

  const startMacroRecording = useCallback(() => {
    if (!selectedTerminalId || !activeTerminal || remoteProtocol === "rdp" || remoteProtocol === "vnc") return;
    if (macroRunRef.current) {
      setConnectionError("Stop the running macro before recording terminal input.");
      return;
    }
    if (!nativeTerminalIdsRef.current.has(selectedTerminalId)) {
      setConnectionError("The selected terminal is not ready for recording yet.");
      return;
    }
    const next = { terminalId: selectedTerminalId, terminalLabel: activeTerminal.label, actions: [], textBytes: 0 };
    macroRecordingRef.current = next;
    setMacroRecording(next);
    setRecordedMacroDraft(null);
    setConnectionError(null);
    setSessionNotice(`Recording input from “${activeTerminal.label}”. Stop recording to review it as a macro.`);
  }, [activeTerminal, remoteProtocol, selectedTerminalId]);

  const stopMacroRecording = useCallback(() => {
    const recording = macroRecordingRef.current;
    if (!recording) return;
    macroRecordingRef.current = null;
    setMacroRecording(null);
    const draft = createRecordedMacroDraft(recording, crypto.randomUUID());
    if (!draft) {
      setSessionNotice("Macro recording stopped without captured input.");
      return;
    }
    setRecordedMacroDraft(draft);
    setMacrosOpen(true);
    setSessionNotice(`Captured ${recording.actions.length} bounded macro action${recording.actions.length === 1 ? "" : "s"}. Review before saving.`);
  }, [setMacrosOpen]);

  const recordAudit = useCallback((kind: AuditEventKind, protocol: string | null | undefined, sessionId?: string | null) => {
    const normalizedProtocol = auditProtocol(protocol);
    if (!IS_TAURI || !normalizedProtocol) return;
    void invoke<AuditEvent>("audit_record", {
      payload: { kind, protocol: normalizedProtocol, sessionId: sessionId ?? null },
    })
      .then((event) => setAuditEvents((current) => [...current, event].slice(-1000)))
      .catch(() => undefined);
  }, []);

  const requestTerminalFocus = useCallback((workspaceId: string) => {
    const instance = terminalInstancesRef.current.get(workspaceId);
    if (!instance) return;
    focusConnectedTerminal(instance.terminal, () =>
      selectedTerminalIdRef.current === workspaceId
      && terminalInstancesRef.current.get(workspaceId) === instance
      && terminalAuditStateRef.current.get(workspaceId) === "connected",
    );
  }, []);

  const handleTerminalStatus = useCallback((workspaceId: string, status: TerminalStatus) => {
    setTerminalTabs((current) => current.map((terminal) => terminal.id === workspaceId ? { ...terminal, status } : terminal));
    const terminal = terminalTabsRef.current.find((item) => item.id === workspaceId);
    const protocol = auditProtocol(terminal?.remoteProtocol);
    const previous = terminalAuditStateRef.current.get(workspaceId);
    terminalAuditStateRef.current.set(workspaceId, status);
    // SSH reconnects can keep the same native ID. Invalidate old approvals.
    if (previous !== status) terminalGenerationsRef.current.set(workspaceId, (terminalGenerationsRef.current.get(workspaceId) ?? 0) + 1);
    if (!protocol || previous === status) return;
    if ((protocol === "SSH" || protocol === "TELNET") && status === "connected") requestTerminalFocus(workspaceId);
    if (status === "connected") recordAudit("connectionSucceeded", protocol);
    if (status === "error") recordAudit("connectionFailed", protocol);
    if (status === "closed") recordAudit("disconnected", protocol);
  }, [recordAudit, requestTerminalFocus]);

  const handleTerminalTitle = useCallback((workspaceId: string, title: string) => {
    const safeTitle = sanitizeTerminalTitle(title);
    if (!safeTitle) return;
    setTerminalTabs((current) => current.map((terminal) => terminal.id === workspaceId && !terminal.customName ? { ...terminal, label: safeTitle } : terminal));
  }, []);

  const handleNativeTerminalId = useCallback((workspaceId: string, terminalId: string | null) => {
    if (nativeTerminalIdsRef.current.get(workspaceId) !== (terminalId ?? undefined)) terminalGenerationsRef.current.set(workspaceId, (terminalGenerationsRef.current.get(workspaceId) ?? 0) + 1);
    if (terminalId) nativeTerminalIdsRef.current.set(workspaceId, terminalId);
    else nativeTerminalIdsRef.current.delete(workspaceId);
  }, []);

  const handleTerminalReady = useCallback((workspaceId: string, terminal: Terminal, searchAddon: SearchAddon) => {
    terminalInstancesRef.current.set(workspaceId, { terminal, searchAddon });
  }, []);

  const handleTerminalDisposed = useCallback((workspaceId: string) => {
    terminalGenerationsRef.current.set(workspaceId, (terminalGenerationsRef.current.get(workspaceId) ?? 0) + 1);
    terminalInstancesRef.current.delete(workspaceId);
  }, []);

  const handleSearchResults = useCallback((workspaceId: string, resultIndex: number, resultCount: number) => {
    if (workspaceId === selectedTerminalIdRef.current) setTerminalSearchResult({ resultIndex, resultCount });
  }, []);

  const writeTerminalInput = useCallback((workspaceId: string, terminalId: string, data: string, beforeSend?: () => void) => {
    const terminal = terminalTabsRef.current.find((item) => item.id === workspaceId);
    if (!terminal) return Promise.reject(new Error("terminal target no longer exists"));
    if (terminalAuditStateRef.current.get(workspaceId) !== "connected") return Promise.reject(new Error("terminal is not ready; input was not sent"));
    if (terminal.remoteProtocol === "rdp" || terminal.remoteProtocol === "vnc") {
      return Promise.reject(new Error("broadcast text input is not available for remote desktop sessions"));
    }
    const command = terminal.remoteProtocol === "ssh" ? "ssh_write" : terminal.remoteProtocol === "telnet" ? "telnet_write" : terminal.remoteProtocol === "serial" ? "serial_write" : "terminal_write";
    const lifecycle = pinMacroTargets([workspaceId], nativeTerminalIdsRef.current, terminalGenerationsRef.current);
    return terminalInputQueueRef.current.enqueue(terminalId, data, () => {
      beforeSend?.();
      if (!lifecycle || lifecycle[0].nativeId !== terminalId || !macroTargetsStillBound(lifecycle, nativeTerminalIdsRef.current, terminalGenerationsRef.current)) {
        return Promise.reject(new Error("terminal changed or closed; queued input was not sent"));
      }
      return invoke(command, { terminalId, data });
    });
  }, []);

  const recordTerminalInput = useCallback((workspaceId: string, data: string) => {
    const recording = macroRecordingRef.current;
    if (!recording || recording.terminalId !== workspaceId) return;
    const next = appendMacroRecordingInput(recording, data);
    if (!next) {
      macroRecordingRef.current = null;
      setMacroRecording(null);
      const draft = createRecordedMacroDraft(recording, crypto.randomUUID());
      if (draft) {
        setRecordedMacroDraft(draft);
        setMacrosOpen(true);
        setConnectionError("Macro recording stopped at its safe 64-action/64 KiB limit. Captured actions are open for review; input that exceeded the limit was not captured.");
      } else {
        setConnectionError("Macro recording stopped at its safe 64-action/64 KiB limit before any action was captured. The input that exceeded the limit was not captured.");
      }
      return;
    }
    if (next === recording) return;
    macroRecordingRef.current = next;
    setMacroRecording(next);
  }, [setMacrosOpen]);

  const handleTerminalInput = useCallback((workspaceId: string, terminalId: string, data: string) => {
    const selectedTargets = broadcastEnabledRef.current ? broadcastTargetIdsRef.current : [workspaceId];
    const targetIds = [...new Set(selectedTargets)];
    if (targetIds.length === 0) {
      setConnectionError("Broadcast is active but no target terminal is selected. Input was not sent.");
      return;
    }
    const targets = targetIds.map((targetId) => ({
      workspaceId: targetId,
      nativeId: targetId === workspaceId ? terminalId : nativeTerminalIdsRef.current.get(targetId),
    }));
    const unavailable = targets.filter((target) => !target.nativeId);
    if (unavailable.length > 0) {
      setConnectionError(`Input was not sent: ${unavailable.length} selected terminal${unavailable.length === 1 ? " is" : "s are"} not ready.`);
      return;
    }
    recordTerminalInput(workspaceId, data);
    void settleTerminalWrites(targets.map((target) => writeTerminalInput(target.workspaceId, target.nativeId!, data)))
      .catch((error) => setConnectionError(`Terminal input failed: ${String(error)}. Some selected terminals may have received it; check before retrying.`));
  }, [recordTerminalInput, writeTerminalInput]);

  const handleTerminalPaste = useCallback(async (workspaceId: string, nativeId: string | null, data: string, confirmationEnabled: boolean) => {
    const broadcasting = broadcastEnabledRef.current;
    const targetIds = [...new Set(broadcasting ? broadcastTargetIdsRef.current : [workspaceId])];
    const source = terminalInstancesRef.current.get(workspaceId)?.terminal;
    const approve = async (stillAllowed: () => boolean) => {
      if (!/[\r\n]/.test(data)) return stillAllowed();
      if (!settings.general.pastePreview) {
        if (!stillAllowed()) return false;
        if (confirmationEnabled && /[\r\n]/.test(data)) {
          return await confirmAction("Paste multiple lines into the selected terminal(s)?") && stillAllowed();
        }
        return stillAllowed();
      }
      const { previewTerminalPaste } = await import("./paste-preview");
      const reviewed = await previewTerminalPaste(data, {
        target: source?.textarea?.getAttribute("aria-label")?.replace(/ terminal input$/, "") ?? "Selected terminal",
        count: targetIds.length, warnMultiline: confirmationEnabled, stillAllowed,
      });
      if (reviewed === null) return false;
      data = reviewed;
      return true;
    };
    if (!IS_TAURI) {
      if (await approve(() => !isWorkspaceLocked() && terminalInstancesRef.current.get(workspaceId)?.terminal === source)) { if (source) { revealPastedTerminal(source); source.paste(data); } }
      return true;
    }
    const terminals = new Map(targetIds.map((id) => [id, terminalInstancesRef.current.get(id)?.terminal]));
    const lifecycle = pinMacroTargets([workspaceId, ...targetIds], nativeTerminalIdsRef.current, terminalGenerationsRef.current);
    const currentTargets = () => {
      if (!lifecycle || !macroTargetsStillBound(lifecycle, nativeTerminalIdsRef.current, terminalGenerationsRef.current) || lifecycle.some(({ workspaceId: id }) => terminalAuditStateRef.current.get(id) !== "connected")) return null;
      if (!nativeId || !source || broadcasting !== broadcastEnabledRef.current || nativeTerminalIdsRef.current.get(workspaceId) !== nativeId || terminalInstancesRef.current.get(workspaceId)?.terminal !== source) return null;
      const ids = [...new Set(broadcasting ? broadcastTargetIdsRef.current : [workspaceId])];
      const bindings = new Map<string, string>();
      for (const id of ids) {
        const target = nativeTerminalIdsRef.current.get(id);
        if (!target || !terminals.get(id) || terminals.get(id) !== terminalInstancesRef.current.get(id)?.terminal) return null;
        bindings.set(id, target);
      }
      return bindings;
    };
    try {
      const targets = await approveTerminalPaste(currentTargets, () => approve(() => !isWorkspaceLocked() && currentTargets() !== null));
      if (!targets) {
        setSessionNotice("Paste cancelled or its selected terminals changed. No input was sent.");
        return true;
      }
      setSessionNotice(null);
      setConnectionError(null);
      recordTerminalInput(workspaceId, prepareTerminalPaste(data, source!.modes.bracketedPasteMode && source!.options.ignoreBracketedPasteMode !== true));
      await settleTerminalWrites([...targets].map(([id, target]) => {
        const terminal = terminals.get(id)!;
        return writeTerminalInput(id, target, prepareTerminalPaste(data, terminal.modes.bracketedPasteMode && terminal.options.ignoreBracketedPasteMode !== true), () => {
          const current = currentTargets();
          if (current?.size !== targets.size || [...targets].some(([workspace, native]) => current.get(workspace) !== native)) {
            throw new Error("paste targets changed; queued input was not sent");
          }
          revealPastedTerminal(terminal);
        });
      }));
    } catch (error) {
      setConnectionError(`Terminal paste failed: ${String(error)}. Some selected terminals may have received it; check before retrying.`);
    }
    return true;
  }, [recordTerminalInput, settings.general.pastePreview, writeTerminalInput]);

  const saveSelectionShortcut = useCallback((workspaceId: string, selection: string) => {
    if (isWorkspaceLocked()) return;
    const terminal = terminalTabsRef.current.find(item => item.id === workspaceId);
    if (!terminal) return;
    const draft = shortcutFromSelection(crypto.randomUUID(), selection, terminal.shortcutDeviceId ?? null);
    if (!draft) return;
    setActiveTerminalId(workspaceId);
    setShortcutSelectionDraft(draft);
    setShortcutsOpen(true);
  }, [setShortcutsOpen]);

  const pasteShortcut = useCallback(async (record: ShortcutRecord) => {
    const workspaceId = selectedTerminalIdRef.current;
    const terminal = terminalTabsRef.current.find(item => item.id === workspaceId);
    const source = terminalInstancesRef.current.get(workspaceId)?.terminal;
    const nativeId = nativeTerminalIdsRef.current.get(workspaceId);
    const text = shortcutText(record);
    if (isWorkspaceLocked() || !terminal || !source || !nativeId || terminal.status !== "connected" || terminal.remoteProtocol === "rdp" || terminal.remoteProtocol === "vnc") throw Error("Select a connected text terminal first.");
    if (shortcutDevice(record) && shortcutDevice(record) !== terminal.shortcutDeviceId) throw Error("This shortcut belongs to another device.");
    if (broadcastEnabledRef.current || macroRunRef.current || macroRecordingRef.current) throw Error("Stop broadcast, recording, or the running macro before pasting.");
    if (!isCommandShortcut(record) || text === null) throw Error("Shortcuts must contain one line of command text.");
    setShortcutSelectionDraft(null); setActiveView("terminal");
    await handleTerminalPaste(workspaceId, nativeId, text, true);
    if (!isWorkspaceLocked() && terminalInstancesRef.current.get(workspaceId)?.terminal === source && selectedTerminalIdRef.current === workspaceId) source.focus();
  }, [handleTerminalPaste]);

  useEffect(() => {
    const taps = new DoubleShift();
    const allowed = (target: EventTarget | null) => {
      const element = target instanceof HTMLElement ? target : null;
      return !isWorkspaceLocked() && !document.querySelector('[role="dialog"], dialog[open]') && (!isEditableKeyboardTarget(target) || !!element?.closest(".xterm"));
    };
    const down = (event: KeyboardEvent) => { if (!allowed(event.target)) { taps.reset(); return; } taps.keydown(event); };
    const up = (event: KeyboardEvent) => { if (!allowed(event.target)) { taps.reset(); return; } if (taps.keyup(event.key, performance.now())) { event.preventDefault(); setShortcutSelectionDraft(null); setShortcutsOpen(true); } };
    const reset = () => taps.reset();
    window.addEventListener("keydown", down, true); window.addEventListener("keyup", up, true);
    window.addEventListener("blur", reset); window.addEventListener("pointerdown", reset, true);
    return () => { window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true); window.removeEventListener("blur", reset); window.removeEventListener("pointerdown", reset, true); };
  }, [setShortcutsOpen]);

  const findTerminalMatch = useCallback((direction: "next" | "previous", query = terminalSearchQuery) => {
    const instance = terminalInstancesRef.current.get(selectedTerminalIdRef.current);
    const term = query.trim();
    if (!instance || !term) {
      instance?.searchAddon.clearDecorations();
      setTerminalSearchResult({ resultIndex: -1, resultCount: 0 });
      return;
    }
    const options = {
      caseSensitive: terminalSearchCaseSensitive,
      decorations: {
        matchBackground: "#3b5148",
        matchBorder: "#7b987e",
        matchOverviewRuler: "#7b987e",
        activeMatchBackground: "#e8b45c",
        activeMatchBorder: "#f5d28f",
        activeMatchColorOverviewRuler: "#e8b45c",
      },
    };
    if (direction === "previous") instance.searchAddon.findPrevious(term, options);
    else instance.searchAddon.findNext(term, options);
  }, [terminalSearchCaseSensitive, terminalSearchQuery]);

  const updateTerminalSearch = useCallback((query: string) => {
    setTerminalSearchQuery(query);
    findTerminalMatch("next", query);
  }, [findTerminalMatch]);

  const openTerminalSearch = useCallback(() => {
    const terminal = terminalTabsRef.current.find(item => item.id === selectedTerminalIdRef.current);
    if (isWorkspaceLocked() || !terminal || terminal.remoteProtocol === "rdp" || terminal.remoteProtocol === "vnc") return;
    setActiveView("terminal");
    setTerminalSearchOpen(true);
    requestAnimationFrame(() => {
      if (isWorkspaceLocked() || document.querySelector('dialog[open], [aria-modal="true"]')) return;
      terminalSearchInputRef.current?.focus();
      terminalSearchInputRef.current?.select();
    });
  }, []);

  useEffect(() => {
    const find = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const terminal = terminalTabsRef.current.find(item => item.id === selectedTerminalIdRef.current);
      const allowed = !closing && !isWorkspaceLocked() && activeView === "terminal" && !editingRemoteFile && !!terminal && terminal.remoteProtocol !== "rdp" && terminal.remoteProtocol !== "vnc"
        && !document.querySelector('dialog[open], [aria-modal="true"]')
        && (!isEditableKeyboardTarget(event.target) || !!target?.closest(".xterm, .terminal-search-bar"));
      handleTerminalFindKey(event, allowed, matchesShortcut(event, settings.keyboard.searchTerminal), openTerminalSearch);
    };
    window.addEventListener("keydown", find, true);
    return () => window.removeEventListener("keydown", find, true);
  }, [activeView, closing, editingRemoteFile, openTerminalSearch, settings.keyboard.searchTerminal]);

  const closeTerminalSearch = useCallback(() => {
    terminalInstancesRef.current.get(selectedTerminalIdRef.current)?.searchAddon.clearDecorations();
    setTerminalSearchOpen(false);
    setTerminalSearchQuery("");
    setTerminalSearchResult({ resultIndex: -1, resultCount: 0 });
    requestTerminalFocus(selectedTerminalIdRef.current);
  }, [requestTerminalFocus]);

  const copyTerminalSelection = useCallback(async () => {
    const selection = terminalInstancesRef.current.get(selectedTerminalIdRef.current)?.terminal.getSelection() ?? "";
    if (!selection) {
      setConnectionError("Select terminal text before copying.");
      return;
    }
    try {
      if (IS_TAURI || typeof navigator.clipboard?.writeText === "function") {
        await writeClipboardText(selection);
        setSessionNotice("Terminal selection copied explicitly.");
      } else {
        setSessionNotice(null);
        await promptText("Copy this terminal selection", selection, { multiline: true, readOnly: true });
      }
      setConnectionError(null);
    } catch (error) {
      setConnectionError(`Terminal selection could not be copied: ${String(error)}`);
    }
  }, []);

  const clearTerminalScrollback = useCallback(() => {
    const instance = terminalInstancesRef.current.get(selectedTerminalIdRef.current);
    if (!instance) return;
    instance.searchAddon.clearDecorations();
    instance.terminal.clearSelection();
    instance.terminal.clear();
    setTerminalSearchResult({ resultIndex: -1, resultCount: 0 });
    setSessionNotice("Cleared the active terminal scrollback. The process remains connected.");
  }, []);

  useEffect(() => {
    setTerminalSearchResult({ resultIndex: -1, resultCount: 0 });
    if ((terminalSearchOpen || settings.general.alwaysShowTerminalSearch) && terminalSearchQuery.trim()) findTerminalMatch("next");
  }, [findTerminalMatch, selectedTerminalId, terminalSearchOpen, terminalSearchQuery, settings.general.alwaysShowTerminalSearch]);

  const closeTerminal = useCallback((workspaceId: string) => {
    terminalTabs.find(terminal => terminal.id === workspaceId)?.authentication?.cancel();
    nativeTerminalIdsRef.current.delete(workspaceId);
    terminalAuditStateRef.current.delete(workspaceId);
    terminalGenerationsRef.current.delete(workspaceId);
    setBroadcastTargetIds((current) => current.filter((id) => id !== workspaceId));
    if (terminalTabs.length === 1) {
      setTerminalTabs([]);
      setActiveTerminalId("");
      setTerminalLayout({ kind: "pane", terminalId: "" });
      setActiveView("home");
      return;
    }
    const closingIndex = terminalTabs.findIndex((terminal) => terminal.id === workspaceId);
    const remaining = terminalTabs.filter((terminal) => terminal.id !== workspaceId);
    setTerminalTabs(remaining);
    setTerminalLayout((current) => removeLayoutNode(current, workspaceId) ?? { kind: "pane", terminalId: remaining[0].id });
    if (activeTerminalId === workspaceId) {
      setActiveTerminalId(remaining[Math.min(closingIndex, remaining.length - 1)].id);
    }
  }, [activeTerminalId, terminalTabs]);

  const cycleTerminal = useCallback((direction: 1 | -1) => {
    if (terminalTabs.length < 2) return;
    const index = Math.max(0, terminalTabs.findIndex((terminal) => terminal.id === selectedTerminalId));
    const nextIndex = (index + direction + terminalTabs.length) % terminalTabs.length;
    setActiveTerminalId(terminalTabs[nextIndex].id);
    setTerminalLayout(current => selectTerminalLayout(current, rememberedTerminalLayouts.current, terminalTabs[nextIndex].id, new Set(terminalTabs.map(item => item.id))));
    setActiveView("terminal");
  }, [selectedTerminalId, terminalTabs]);

  useEffect(() => {
    const onMouseNavigation = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      // Reserve both side buttons for tabs, including over terminal panes.
      // Cancel every phase so WebView history and remote mouse input stay idle.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type !== "mousedown" || closing || isWorkspaceLocked() || editingRemoteFile
        || document.querySelector('[role="dialog"], dialog[open]')) return;
      cycleTerminal(event.button === 3 ? -1 : 1);
    };
    const events = ["mousedown", "mouseup", "auxclick"] as const;
    for (const type of events) window.addEventListener(type, onMouseNavigation, true);
    return () => {
      for (const type of events) window.removeEventListener(type, onMouseNavigation, true);
    };
  }, [closing, cycleTerminal, editingRemoteFile]);

  const handleWorkspaceTabKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const tabs = Array.from(event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    if (tabs.length < 2) return;
    const index = tabs.indexOf(event.currentTarget);
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (index + 1) % tabs.length;
        break;
      case "ArrowLeft":
        nextIndex = (index + tabs.length - 1) % tabs.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    tabs[nextIndex].focus();
    tabs[nextIndex].click();
  }, []);

  const focusPane = useCallback(() => {
    setActiveView("terminal");
    terminalInstancesRef.current.get(selectedTerminalIdRef.current)?.terminal.focus();
  }, []);

  const openSplit = useCallback((direction: Exclude<SplitDirection, "none">) => {
    const firstId = selectedTerminalId;
    if (!firstId) return;
    if (!firstId) return;
    const visibleIds = new Set(layoutTerminalIds(terminalLayout));
    let second = terminalTabs.find((terminal) => terminal.id !== firstId && !visibleIds.has(terminal.id));
    if (!second) {
      second = createWorkspaceTerminal();
      setTerminalTabs((current) => [...current, second!]);
    }
    const newSplit: TerminalLayoutNode = { kind: "split", direction, ratio: 50, first: { kind: "pane", terminalId: firstId }, second: { kind: "pane", terminalId: second.id } };
    setTerminalLayout((current) => {
      const path = findLayoutPath(current, firstId);
      return path ? replaceLayoutNode(current, path, newSplit) : newSplit;
    });
    setActiveView("terminal");
  }, [selectedTerminalId, terminalLayout, terminalTabs]);

  const beginSplitResize = useCallback((event: ReactMouseEvent<HTMLDivElement>, path: SplitPath, direction: Exclude<SplitDirection, "none">) => {
    const frame = event.currentTarget.parentElement;
    if (!frame) return;
    event.preventDefault();
    splitResizeRef.current = { direction, frame, path };
    document.body.style.cursor = direction === "right" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  }, []);

  const adjustSplitRatio = useCallback((event: ReactKeyboardEvent<HTMLDivElement>, path: SplitPath, direction: Exclude<SplitDirection, "none">) => {
    const increase = direction === "right"
      ? event.key === "ArrowRight"
      : event.key === "ArrowDown";
    const decrease = direction === "right"
      ? event.key === "ArrowLeft"
      : event.key === "ArrowUp";
    if (!increase && !decrease) return;
    event.preventDefault();
    setTerminalLayout((current) => {
      const currentNode = path.reduce<TerminalLayoutNode | null>((node, part) => node?.kind === "split" ? node[part] : null, current);
      const ratio = currentNode?.kind === "split" ? currentNode.ratio : 50;
      return updateLayoutRatio(current, path, Math.max(20, Math.min(80, ratio + (increase ? 5 : -5))));
    });
  }, []);

  const resetSplitRatio = useCallback((path: SplitPath) => {
    setTerminalLayout((current) => updateLayoutRatio(current, path, 50));
  }, []);

  const refreshSavedSessions = useCallback(() => {
    if (!IS_TAURI) return;
    void invoke<SavedSession[]>("session_list")
      .then((sessions) => {
        const available = IS_ANDROID ? sessions.filter(session => session.protocol !== "RDP" && session.protocol !== "VNC") : sessions;
        setSavedSessions(available);
        setSessionRows(available.map(toSessionListItem));
        setSessionListError(null);
      })
      .catch((error) => setSessionListError(`Saved sessions could not be loaded: ${String(error)}`));
  }, []);

  const refreshSettings = useCallback(() => {
    if (!IS_TAURI) return;
    void invoke<AppSettings>("settings_get")
      .then(setSettings)
      .catch((error) => setConnectionError(`Settings could not be loaded: ${String(error)}`));
  }, []);

  const refreshPortableVaultStatus = useCallback(() => {
    if (!IS_TAURI) return;
    void invoke<PortableVaultStatus>("portable_vault_status")
      .then(setPortableVaultStatus)
      .catch((error) => setConnectionError(`Portable vault status could not be loaded: ${String(error)}`));
  }, []);

  const refreshSnippets = useCallback(() => {
    if (!IS_TAURI) return;
    void invoke<SnippetRecord[]>("snippet_list")
      .then(setSnippets)
      .catch((error) => setConnectionError(`Snippets could not be loaded: ${String(error)}`));
  }, []);

  const refreshMacros = useCallback(() => {
    if (!IS_TAURI) return;
    void invoke<MacroRecord[]>("macro_list")
      .then((records) => setMacros(records.map(normalizeMacroRecord)))
      .catch((error) => setConnectionError(`Macros could not be loaded: ${String(error)}`));
  }, []);

  const refreshAudit = useCallback(() => {
    if (!IS_TAURI) return;
    void invoke<AuditEvent[]>("audit_list")
      .then(setAuditEvents)
      .catch((error) => setConnectionError(`Audit history could not be loaded: ${String(error)}`));
  }, []);

  const clearAudit = useCallback(async () => {
    if (!IS_TAURI || !await confirmAction("Clear the local audit history? Terminal commands and secrets are not stored there.")) return;
    try {
      await invoke("audit_clear");
      setAuditEvents([]);
      setSessionNotice("Local audit history cleared.");
      setConnectionError(null);
    } catch (error) {
      setConnectionError(`Audit history could not be cleared: ${String(error)}`);
    }
  }, []);

  const saveSnippet = useCallback(async (snippet: SnippetRecord) => {
    try {
      const saved = IS_TAURI ? await invoke<SnippetRecord>("snippet_save", { snippet }) : snippet;
      setSnippets((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
      setSessionNotice(`Saved snippet “${saved.title}”. It is never executed automatically.`);
      setConnectionError(null);
    } catch (error) {
      setConnectionError(`Snippet could not be saved: ${String(error)}`);
    }
  }, []);

  const deleteSnippet = useCallback(async (snippet: SnippetRecord) => {
    if (!await confirmAction(`Delete snippet “${snippet.title}”?`)) return;
    try {
      if (IS_TAURI) await invoke<boolean>("snippet_delete", { snippetId: snippet.id });
      setSnippets((current) => current.filter((item) => item.id !== snippet.id));
      setSessionNotice(`Deleted snippet “${snippet.title}”.`);
      setConnectionError(null);
    } catch (error) {
      setConnectionError(`Snippet could not be deleted: ${String(error)}`);
    }
  }, []);

  const copySnippet = useCallback(async (command: string) => {
    try {
      if (IS_TAURI || typeof navigator.clipboard?.writeText === "function") {
        await writeClipboardText(command);
        setSessionNotice("Rendered snippet copied. Review it, then paste manually; Conxol does not auto-send it.");
      } else {
        setSessionNotice(null);
        await promptText("Copy this rendered snippet and paste it manually", command, { multiline: true, readOnly: true });
      }
      setConnectionError(null);
    } catch (error) {
      setConnectionError(`Snippet could not be copied: ${String(error)}`);
    }
  }, []);

  const saveCommandShortcut = useCallback(async (record: ShortcutRecord) => {
    if (!isCommandShortcut(record) || shortcutText(record) === null || !record.title.trim()) throw Error("Enter a name and a single-line command.");
    const saved = IS_TAURI ? await invoke<SnippetRecord>("snippet_save", { snippet: record }) : record;
    setSnippets(current => current.some(item => item.id === saved.id) ? current.map(item => item.id === saved.id ? saved : item) : [...current, saved]);
  }, []);

  const deleteCommandShortcut = useCallback(async (record: ShortcutRecord) => {
    if (!await confirmAction(`Delete shortcut “${record.title}”?`)) return;
    if (IS_TAURI) await invoke("snippet_delete", { snippetId: record.id });
    setSnippets(current => current.filter(item => item.id !== record.id));
  }, []);

  const saveMacro = useCallback(async (record: MacroRecord) => {
    try {
      const saved = normalizeMacroRecord(IS_TAURI ? await invoke<MacroRecord>("macro_save", { record }) : record);
      setMacros((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
      setSessionNotice(`Saved macro “${saved.title}”. ${saved.approval === "eachAction" ? "Each action requires approval." : "It requires an explicit run confirmation."}`);
      setConnectionError(null);
    } catch (error) {
      setConnectionError(`Macro could not be saved: ${String(error)}`);
    }
  }, []);

  const deleteMacro = useCallback(async (record: MacroRecord) => {
    if (!await confirmAction(`Delete macro “${record.title}”?`)) return;
    try {
      if (IS_TAURI) await invoke<boolean>("macro_delete", { macroId: record.id });
      setMacros((current) => current.filter((item) => item.id !== record.id));
      setSessionNotice(`Deleted macro “${record.title}”.`);
      setConnectionError(null);
    } catch (error) {
      setConnectionError(`Macro could not be deleted: ${String(error)}`);
    }
  }, []);

  const saveSettings = useCallback(async (next: AppSettings) => {
    setSettingsError(null);
    try {
      const saved = IS_TAURI ? await invoke<AppSettings>("settings_save", { settings: next }) : next;
      setSettings(saved);
      setSettingsOpen(false);
      setSessionNotice("Settings saved. New terminal instances use the updated terminal profile.");
      setConnectionError(null);
    } catch (error) {
      setSettingsError(`Settings could not be saved: ${String(error)}`);
    }
  }, [setSettingsOpen]);

  const adjustTerminalFontSize = useCallback((action: "increase" | "decrease" | "reset") => {
    const current = settingsRef.current;
    const fontSize = terminalFontSizeAfterZoom(current.appearance.fontSize, action);
    if (fontSize === current.appearance.fontSize) return;
    const next = {
      ...current,
      appearance: { ...current.appearance, fontSize },
    };
    settingsRef.current = next;
    setSettings(next);
    if (zoomPersistTimerRef.current !== null) window.clearTimeout(zoomPersistTimerRef.current);
    zoomPersistTimerRef.current = window.setTimeout(() => {
      zoomPersistTimerRef.current = null;
      if (!IS_TAURI) return;
      void invoke<AppSettings>("settings_save", { settings: settingsRef.current })
        .then((saved) => {
          settingsRef.current = saved;
          setSettings(saved);
        })
        .catch((error) => setConnectionError(`Terminal zoom could not be saved: ${String(error)}`));
    }, 250);
    setSessionNotice(`Terminal font size: ${fontSize}px.`);
  }, []);

  useEffect(() => () => {
    if (zoomPersistTimerRef.current !== null) window.clearTimeout(zoomPersistTimerRef.current);
  }, []);

  const resetSettings = useCallback(async () => {
    if (!await confirmAction("Reset Conxol settings to their safe defaults?")) return;
    setSettingsError(null);
    try {
      const reset = IS_TAURI ? await invoke<AppSettings>("settings_reset") : defaultSettings;
      setSettings(reset);
      setSettingsOpen(false);
      setSessionNotice("Settings reset to defaults.");
      setConnectionError(null);
    } catch (error) {
      setSettingsError(`Settings could not be reset: ${String(error)}`);
    }
  }, [setSettingsOpen]);

  const exportSettings = useCallback(async () => {
    if (!IS_TAURI) return;
    setSettingsError(null);
    try {
      const json = await invoke<string>("settings_export");
      if (IS_TAURI || typeof navigator.clipboard?.writeText === "function") {
        await writeClipboardText(json);
        setSessionNotice("Secret-free settings copied. Credentials and session definitions are not included.");
      } else {
        setSessionNotice(null);
        await promptText("Copy this secret-free Conxol settings export", json, { multiline: true, readOnly: true });
      }
      setConnectionError(null);
    } catch (error) {
      setSettingsError(`Settings export failed: ${String(error)}`);
    }
  }, []);

  const exportDiagnostics = useCallback(async () => {
    if (!IS_TAURI) throw new Error("Diagnostic export requires the desktop app.");
    const saved = await invoke<boolean>("diagnostic_export_save");
    if (saved) setSessionNotice("Diagnostics saved with recent SSH failure details. Passwords, keys, host addresses, and terminal content were excluded.");
    return saved;
  }, []);

  const importSettings = useCallback(async () => {
    if (!IS_TAURI) return;
    const json = await promptText("Paste a secret-free Conxol settings export JSON", "", { multiline: true });
    if (!json?.trim()) return;
    setSettingsError(null);
    try {
      const imported = await invoke<AppSettings>("settings_import", { payload: { json } });
      setSettings(imported);
      setSettingsOpen(false);
      setSessionNotice("Settings imported after validation. Credentials and session definitions were untouched.");
      setConnectionError(null);
    } catch (error) {
      setSettingsError(`Settings import failed: ${String(error)}`);
    }
  }, [setSettingsOpen]);

  const createPortableVault = useCallback(async (passphrase: string) => {
    if (!IS_TAURI) return;
    setSettingsError(null);
    try {
      const status = await invoke<PortableVaultStatus>("portable_vault_create", { payload: { passphrase } });
      setPortableVaultStatus(status);
      setSessionNotice("Created and unlocked the encrypted portable vault. Lock it before leaving the computer unattended.");
      setConnectionError(null);
    } catch (error) {
      setSettingsError(`Portable vault could not be created: ${String(error)}`);
    }
  }, []);

  const unlockPortableVault = useCallback(async (passphrase: string) => {
    if (!IS_TAURI) return;
    setSettingsError(null);
    try {
      const status = await invoke<PortableVaultStatus>("portable_vault_unlock", { payload: { passphrase } });
      setPortableVaultStatus(status);
      setSessionNotice("Portable vault unlocked in native memory. The passphrase was not returned to the interface.");
      setConnectionError(null);
    } catch (error) {
      setSettingsError(`Portable vault could not be unlocked: ${String(error)}`);
    }
  }, []);

  const lockPortableVault = useCallback(async () => {
    if (!IS_TAURI) return;
    setSettingsError(null);
    try {
      const status = await invoke<PortableVaultStatus>("portable_vault_lock");
      setPortableVaultStatus(status);
      setSessionNotice("Portable vault locked and its native key material was released.");
      setConnectionError(null);
    } catch (error) {
      setSettingsError(`Portable vault could not be locked: ${String(error)}`);
    }
  }, []);

  const saveCredential = useCallback(async (credentialId: string, secret: string) => {
    if (!IS_TAURI) {
      setConnectionError("Credential vault operations require the desktop runtime.");
      return;
    }
    try {
      const savedId = await invoke<string>("vault_put", {
        payload: { credentialId: credentialId.trim(), secret },
      });
      setCredentialsOpen(false);
      setSessionNotice(`Saved credential reference “${savedId}”. The secret remains in the native vault.`);
      setConnectionError(null);
    } catch (error) {
      setConnectionError(`Credential could not be saved: ${String(error)}`);
    }
  }, [setCredentialsOpen]);

  const deleteCredential = useCallback(async (credentialId: string) => {
    if (!IS_TAURI) {
      setConnectionError("Credential vault operations require the desktop runtime.");
      return;
    }
    try {
      const deletedId = await invoke<string>("vault_delete", {
        payload: { credentialId: credentialId.trim() },
      });
      setCredentialsOpen(false);
      setSessionNotice(`Deleted credential reference “${deletedId}”.`);
      setConnectionError(null);
    } catch (error) {
      setConnectionError(`Credential could not be deleted: ${String(error)}`);
    }
  }, [setCredentialsOpen]);

  const connectSsh = useCallback(async (request: SshConnectRequest, offerSave = true, displayName?: string, folder?: string, shortcutDeviceId?: string, branchParentId?: string) => {
    await sshConnectionAttempt.current.run(async () => {
      setSshConnecting(true);
      try {
        setConnectionError(null);
        setSessionNotice(null);
        if (!IS_TAURI) {
          setConnectionError("SSH connections require the desktop runtime.");
          return;
        }
        let connectingTerminal: WorkspaceTerminal | null = null;
        try {
          request = structuredClone(request);
          const sshSettings = { ...settingsRef.current.ssh };
          const macroAtApproval = macroRunRef.current;
          const stillAllowed = () => !macroAtApproval || (!macroCancelRef.current && macroRunRef.current === macroAtApproval);
          if (!await confirmSessionStartup(request.startupCommand, `SSH ${request.username}@${request.host}:${request.port}`, sshSettings.reconnectEnabled && sshSettings.reconnectAttempts > 0, stillAllowed) || !stillAllowed()) return;
          const trustServices = {
            lookup: (target: { host: string; port: number }) => invoke<string | null>("ssh_trust_lookup", { host: target.host, port: target.port }),
            inspect: (target: { host: string; port: number; legacyRsa?: boolean }) => invoke<{ host: string; port: number; fingerprint: string }>("ssh_inspect_host_key", { request: { host: target.host, port: target.port, timeoutMs: sshSettings.connectTimeoutMs, pptpProfileId: request.pptpProfileId, legacyRsa: target.legacyRsa ?? false } }),
            confirm: (target: { host: string; port: number }, fingerprint: string) => confirmAction(`Unknown SSH host key\n\nHost: ${target.host}:${target.port}\nSHA-256 fingerprint:\n${fingerprint}\n\nVerify this fingerprint with the server administrator. Accept and save this key for future connections?` , { title: "Unknown SSH host key", acceptLabel: "Accept and save" }),
            save: (target: { host: string; port: number }, fingerprint: string) => invoke<void>("ssh_trust_accept", { host: target.host, port: target.port, fingerprint }),
          };
          // Only the first hop is directly reachable; never inspect a private jump target over a different route.
          for (const [index, jump] of (request.jumpHosts ?? []).entries()) {
            if (!await approveUnknownHost(jump, trustServices, stillAllowed, index === 0)) return;
          }
          if (!await approveUnknownHost(request, trustServices, stillAllowed, !request.jumpHosts?.length)) return;
          const authentication = new TerminalAuthentication();
          const pendingTerminal = createWorkspaceTerminal({
            label: `${displayName ?? request.username}@${request.host}`,
            customName: displayName,
            remoteProtocol: "ssh", remoteHost: request.host,
            authentication, connecting: true,
            shortcutDeviceId: shortcutDeviceId ?? `ssh:${JSON.stringify([request.host.toLowerCase(), request.port, request.username])}`,
          });
          connectingTerminal = pendingTerminal;
          setTerminalTabs(current => [...current, pendingTerminal]);
          setActiveTerminalId(pendingTerminal.id);
          setTerminalLayout(current => branchParentId ? branchTerminalLayout(current, branchParentId, pendingTerminal.id) : { kind: "pane", terminalId: pendingTerminal.id });
          setActiveView("terminal");
          setQuickConnectOpen(false);
          const authEvents = new Channel<SshAuthEvent>();
          // Installed before IPC; this channel also owns this session's reconnect
          // prompts. A closed request cannot deliver answers to another attempt.
          authEvents.onmessage = createSshAuthHandler(setConnectionError, (message, signal) => {
            if (authentication.closed) return Promise.resolve(null);
            setActiveTerminalId(pendingTerminal.id);
            setTerminalLayout(current => branchParentId ? branchTerminalLayout(current, branchParentId, pendingTerminal.id) : { kind: "pane", terminalId: pendingTerminal.id });
            setActiveView("terminal");
            return authentication.ask(message, signal);
          });
          const response = await invoke<SshConnectResponse>("ssh_connect", {
            authEvents,
            request: {
              ...request,
              reconnectAttempts: sshSettings.reconnectEnabled ? sshSettings.reconnectAttempts : 0,
              connectTimeoutMs: sshSettings.connectTimeoutMs,
            },
          });
          if (authentication.closed) {
            await invoke("ssh_close", { terminalId: response.terminalId }).catch(() => undefined);
            return;
          }
          recordAudit("sessionOpened", "SSH");
          const terminal: WorkspaceTerminal = {
            ...pendingTerminal,
            label: `${displayName ?? request.username}@${response.host}`,
            remoteSessionId: response.terminalId,
            remoteProtocol: "ssh",
            remoteHost: response.host,
            connecting: false,
          };
          setTerminalTabs((current) => current.map(item => item.id === terminal.id ? terminal : item));
          setActiveTerminalId(terminal.id);
          setTerminalLayout(current => branchParentId ? branchTerminalLayout(current, branchParentId, terminal.id) : { kind: "pane", terminalId: terminal.id });
          setActiveView("terminal");
          setQuickConnectOpen(false);
          if (offerSave) {
            const suggestedName = `${request.username}@${response.host}`;
            const name = displayName?.trim() || await promptText("Save this SSH session as", suggestedName);
            requestTerminalFocus(terminal.id);
            if (name?.trim()) {
              try {
                const saved = await invoke<SavedSession>("session_save_ssh", { payload: { name: name.trim(), folder: folder?.trim() || null, request } });
                setTerminalTabs(current => current.map(item => item.id === terminal.id ? { ...item, label: `${name.trim()}@${response.host}`, customName: name.trim(), shortcutDeviceId: saved.id } : item));
                refreshSavedSessions();
              } catch (error) {
                setConnectionError(`Connected, but the session could not be saved: ${String(error)}`);
              }
            }
          }
        } catch (error) {
          if (connectingTerminal) {
            connectingTerminal.authentication?.cancel();
            const failedId = connectingTerminal.id;
            setTerminalTabs(current => current.filter(terminal => terminal.id !== failedId));
            setTerminalLayout(current => removeLayoutNode(current, failedId) ?? { kind: "pane", terminalId: "" });
            setActiveTerminalId(current => current === failedId ? "" : current);
            if (!terminalTabsRef.current.some(terminal => terminal.id !== failedId)) setActiveView("home");
          }
          if (String(error).includes("SSH authentication was cancelled")) {
            setConnectionError(null);
            return;
          }
          recordAudit("connectionFailed", "SSH");
          setConnectionError(String(error));
        }
      } finally {
        setSshConnecting(false);
      }
    });
  }, [recordAudit, refreshSavedSessions, requestTerminalFocus, setQuickConnectOpen]);

  const connectTelnet = useCallback(async (request: TelnetConnectRequest, offerSave = true, displayName?: string, shortcutDeviceId?: string) => {
    setConnectionError(null);
    setSessionNotice(null);
    if (!IS_TAURI) {
      setConnectionError("Telnet connections require the desktop runtime.");
      return;
    }
    try {
      const response = await invoke<TelnetConnectResponse>("telnet_connect", { request });
      request.password = undefined;
      recordAudit("sessionOpened", "TELNET");
      const terminal = createWorkspaceTerminal({
        label: displayName ? `${displayName}@${response.host}` : `Telnet · ${response.host}`,
        customName: displayName,
        remoteSessionId: response.terminalId,
        remoteProtocol: "telnet",
        shortcutDeviceId: shortcutDeviceId ?? `telnet:${JSON.stringify([request.host.toLowerCase(), request.port])}`,
        remoteHost: response.host,
      });
      setTerminalTabs((current) => [...current, terminal]);
      setActiveTerminalId(terminal.id);
      setTerminalLayout({ kind: "pane", terminalId: terminal.id });
      setActiveView("terminal");
      setQuickConnectOpen(false);
      if (offerSave) {
        const suggestedName = `Telnet · ${response.host}`;
        const name = await promptText("Save this Telnet session as", suggestedName);
        if (name?.trim()) {
          try {
            const saved = await invoke<SavedSession>("session_save_telnet", { payload: { name: name.trim(), request: { ...request, password: undefined, credentialId: response.credentialId, savePassword: false } } });
            setTerminalTabs(current => current.map(item => item.id === terminal.id ? { ...item, shortcutDeviceId: saved.id } : item));
            refreshSavedSessions();
          } catch (error) {
            setConnectionError(`Connected, but the Telnet session could not be saved: ${String(error)}`);
          }
        }
      }
      requestTerminalFocus(terminal.id);
    } catch (error) {
      request.password = undefined;
      recordAudit("connectionFailed", "TELNET");
      setConnectionError(String(error));
    }
  }, [recordAudit, refreshSavedSessions, requestTerminalFocus, setQuickConnectOpen]);

  const connectSerial = useCallback(async (request: SerialConnectRequest, shortcutDeviceId?: string) => {
    setConnectionError(null);
    setSessionNotice(null);
    if (!IS_TAURI) {
      setConnectionError("Serial connections require the desktop runtime.");
      return;
    }
    try {
      const response = await invoke<SerialConnectResponse>("serial_connect", { request });
      recordAudit("sessionOpened", "SERIAL");
      const terminal = createWorkspaceTerminal({
        label: `Serial · ${response.device}`,
        remoteSessionId: response.terminalId,
        remoteProtocol: "serial",
        shortcutDeviceId: shortcutDeviceId ?? `serial:${request.device}`,
        remoteHost: response.device,
      });
      setTerminalTabs((current) => [...current, terminal]);
      setActiveTerminalId(terminal.id);
      setTerminalLayout({ kind: "pane", terminalId: terminal.id });
      setActiveView("terminal");
      setQuickConnectOpen(false);
      requestTerminalFocus(terminal.id);
    } catch (error) {
      recordAudit("connectionFailed", "SERIAL");
      setConnectionError(String(error));
    }
  }, [recordAudit, requestTerminalFocus, setQuickConnectOpen]);

  const connectRemoteDesktop = useCallback(async (request: RemoteDesktopConnectRequest, offerSave = true, displayName?: string) => {
    if (IS_ANDROID) {
      setConnectionError("Remote desktop connections are not supported on Android.");
      return;
    }
    if (request.protocol === "vnc" && request.allowInsecureVnc && !await confirmAction("VNC over TCP is unencrypted. Continue only if this target is trusted or protected by an external tunnel?")) {
      return;
    }
    setConnectionError(null);
    setSessionNotice(null);
    recordAudit("sessionOpened", request.protocol.toUpperCase());
    const terminal = createWorkspaceTerminal({
      label: displayName ? `${displayName}@${request.host}` : `${request.protocol.toUpperCase()} · ${request.host}`,
      customName: displayName,
      remoteProtocol: request.protocol,
      remoteHost: request.host,
      remoteDesktopRequest: request,
    });
    setTerminalTabs((current) => [...current, terminal]);
    setActiveTerminalId(terminal.id);
    setTerminalLayout({ kind: "pane", terminalId: terminal.id });
    setActiveView("terminal");
    setQuickConnectOpen(false);
    if (offerSave && IS_TAURI) {
      const suggestedName = `${request.username ? `${request.username}@` : ""}${request.host}`;
      const name = await promptText(`Save this ${request.protocol.toUpperCase()} session as`, suggestedName);
      if (name?.trim()) {
        void invoke("session_save_remote_desktop", { payload: { name: name.trim(), request } })
          .then(() => {
            refreshSavedSessions();
            setSessionNotice(`Queued ${request.protocol.toUpperCase()} session and saved ${name.trim()}.`);
          })
          .catch((error) => setConnectionError(`Queued, but the session could not be saved: ${String(error)}`));
      }
    }
  }, [recordAudit, refreshSavedSessions, setQuickConnectOpen]);

  const importOpenSshConfig = useCallback(async () => {
    if (!IS_TAURI) return;
    const requestedPath = await promptText("OpenSSH config path (explicit path only; never read automatically)", "");
    if (requestedPath === null || !requestedPath.trim()) return;
    try {
      const report = await invoke<OpenSshImportReport>("session_import_openssh", {
        payload: { path: requestedPath },
      });
      refreshSavedSessions();
      const warnings = [
        report.skippedHosts.length > 0 ? `${report.skippedHosts.length} skipped` : "",
        report.unsupportedDirectives.length > 0 ? `${report.unsupportedDirectives.length} unsupported directive${report.unsupportedDirectives.length === 1 ? "" : "s"}` : "",
      ].filter(Boolean);
      const message = `Imported ${report.imported.length} OpenSSH profile${report.imported.length === 1 ? "" : "s"}${warnings.length > 0 ? ` · ${warnings.join(" · ")}` : ""}.`;
      const total = report.skippedHosts.length + report.unsupportedDirectives.length;
      const details = [
        ...report.skippedHosts.slice(0, 20).map((host) => `Skipped: ${host}`),
        ...report.unsupportedDirectives.slice(0, Math.max(0, 20 - report.skippedHosts.length)).map((directive) => `Unsupported directive: ${directive}`),
      ];
      setSessionNotice(total > 0 ? { message, details, total } : message);
      setConnectionError(null);
    } catch (error) {
      setSessionNotice(null);
      setConnectionError(String(error));
    }
  }, [refreshSavedSessions]);

  const exportSessions = useCallback(async () => {
    if (!IS_TAURI) return;
    if (!await confirmAction("Export session metadata? The file contains no passwords or private keys, but may include credential references, key paths, and known_hosts paths. Continue only if this destination is trusted.")) return;
    try {
      const json = await invoke<string>("session_export");
      if (IS_TAURI || typeof navigator.clipboard?.writeText === "function") {
        await writeClipboardText(json);
        setSessionNotice("Secret-free session definitions copied to the clipboard; credential material is not included.");
      } else {
        await promptText("Copy this secret-free Conxol session export", json, { multiline: true, readOnly: true });
      }
    } catch (error) {
      setConnectionError(`Session export failed: ${String(error)}`);
    }
  }, []);

  const importSessions = useCallback(async () => {
    if (!IS_TAURI) return;
    const json = await promptText("Paste a secret-free Conxol session export JSON. Existing session IDs stay unchanged.", "", { multiline: true });
    if (!json?.trim()) return;
    try {
      const report = await invoke<SessionImportReport>("session_import", { payload: { json } });
      refreshSavedSessions();
      const message = `Imported ${report.importedCount} session${report.importedCount === 1 ? "" : "s"}${report.skipped.length > 0 ? ` · ${report.skipped.length} skipped` : ""}.`;
      setSessionNotice(report.skipped.length > 0 ? { message, details: report.skipped.slice(0, 20), total: report.skipped.length } : message);
      setConnectionError(null);
    } catch (error) {
      setConnectionError(`Session import failed: ${String(error)}`);
    }
  }, [refreshSavedSessions]);

  const toggleFavorite = useCallback(async (session: SessionListItem) => {
    if (!IS_TAURI || !session.id) return;
    try {
      await invoke("session_set_favorite", { sessionId: session.id, favorite: !session.favorite });
      refreshSavedSessions();
    } catch (error) {
      setConnectionError(`Favorite update failed: ${String(error)}`);
    }
  }, [refreshSavedSessions]);

  const touchSavedSession = useCallback((sessionId: string) => {
    if (!IS_TAURI) return;
    void invoke<boolean>("session_touch", { sessionId })
      .then((touched) => {
        if (touched) refreshSavedSessions();
      })
      .catch(() => undefined);
  }, [refreshSavedSessions]);

  const openSavedLocalSession = useCallback(async (session: SavedSession) => {
    const startupCommand = session.startup_command?.trim();
    const macroAtApproval = macroRunRef.current;
    const stillAllowed = () => !macroAtApproval || (!macroCancelRef.current && macroRunRef.current === macroAtApproval);
    if (!await confirmSessionStartup(startupCommand, "the new local shell", false, stillAllowed) || !stillAllowed()) return;
    recordAudit("sessionOpened", "LOCAL", session.id);
    touchSavedSession(session.id);
    startNewTerminal({
      type: "default",
      cwd: session.startup_directory?.trim() ? session.startup_directory : undefined,
      environment: session.environment?.length ? session.environment : undefined,
      startupCommand: startupCommand || undefined,
    }, session.name, session.id);
  }, [recordAudit, startNewTerminal, touchSavedSession]);

  const saveEditedSession = useCallback(async (session: SavedSession) => {
    if (!IS_TAURI) return;
    try {
      await invoke<SavedSession>("session_save", { session });
      setSessionFolderState(current => ({ ...current, ...(session.folder?.trim() ? sessionFolderOpenState(session.folder.trim()) : {}) }));
      setEditingSession(null);
      refreshSavedSessions();
      setSessionNotice(`Saved ${session.name}. Secret references were left unchanged.`);
    } catch (error) {
      setConnectionError(`Session update failed: ${String(error)}`);
    }
  }, [refreshSavedSessions]);

  const dropSessionInFolder = async (folder: string) => {
    const session = savedSessions.find(item => item.id === draggedSessionId.current);
    draggedSessionId.current = null;
    setSessionDropTarget(null);
    if (!session || (session.folder ?? "") === folder) return;
    try {
      await invoke<SavedSession>("session_save", { session: { ...session, folder: folder || null } });
      setSessionFolderState(current => ({ ...current, ...sessionFolderOpenState(folder) }));
      refreshSavedSessions();
    } catch (error) { setConnectionError(`Could not move session: ${String(error)}`); }
  };

  const deleteSessionFolder = async (folder: string) => {
    if (createdSessionFolders.some(path => path !== folder && sessionFolderWithin(path, folder)) || folderDeletionInProgress.current || sessionRows.some(session => sessionFolderWithin(session.folder.trim(), folder)) || savedSessions.some(session => sessionFolderWithin(session.folder?.trim() ?? "", folder))) return;
    folderDeletionInProgress.current = true;
    setDeletingFolder(folder);
    setFolderContextMenu(null);
    try {
      const members = savedSessions.filter(session => sessionFolderWithin(session.folder?.trim() ?? "", folder));
      if (members.length && !IS_TAURI) throw new Error("Moving saved sessions requires the desktop runtime.");
      await unfileSessionFolder(folder, savedSessions, session => invoke("session_save", { session }));
      setCreatedSessionFolders(current => current.filter(name => name !== folder));
      setFolderStyles(current => { const next = { ...current }; delete next[folder]; return next; });
      setSessionFolderState(current => {
        const next = { ...current };
        delete next[`folder:${folder}`];
        return next;
      });
      setEditingSession(current => current?.folder?.trim() === folder ? { ...current, folder: null } : current);
      setSessionNotice(`Deleted folder “${folder}”. Its ${members.length} saved sessions are in the main list.`);
    } catch (error) {
      // Keep the folder if any move failed; refresh successful moves before retry.
      setConnectionError(`Could not delete folder “${folder}”: ${String(error)}. Saved sessions were kept; any completed moves are in the main list.`);
    } finally {
      refreshSavedSessions();
      setDeletingFolder(null);
      folderDeletionInProgress.current = false;
    }
  };

  const relocateSessionFolder = async (original: string, name: string, style?: FolderStyle) => {
    if (folderMoveInProgress.current) throw new Error("A folder move is already in progress.");
    const allFolders = [...new Set([...createdSessionFolders.flatMap(sessionFolderAncestors), ...savedSessions.flatMap(item => sessionFolderAncestors(item.folder?.trim() ?? ""))])];
    const renamed = planSessionFolderMove(original, name, allFolders);
    folderMoveInProgress.current = true;
    try {
    const moved: SavedSession[] = [];
    try {
      if (name !== original) {
        for (const session of savedSessions.filter(item => sessionFolderWithin(item.folder?.trim() ?? "", original))) {
          await invoke("session_save", { session: { ...session, folder: renamed(session.folder!.trim()) } });
          moved.push(session);
        }
      }
    } catch (error) {
      const rollback = await Promise.allSettled(moved.map(session => invoke("session_save", { session })));
      refreshSavedSessions();
      throw new Error(`Could not rename folder: ${String(error)}${rollback.some(result => result.status === "rejected") ? ". Some sessions could not be restored; review both folders." : ""}`);
    }
    setCreatedSessionFolders(current => [...new Set([...allFolders.map(renamed), ...current.map(renamed), name])]);
    setFolderStyles(current => ({ ...Object.fromEntries(Object.entries(current).map(([path, value]) => [renamed(path), value])), ...(style ? { [name]: style } : {}) }));
    setSessionFolderState(current => ({ ...Object.fromEntries(Object.entries(current).map(([key, value]) => [key.startsWith("folder:") ? `folder:${renamed(key.slice(7))}` : key, value])), ...sessionFolderOpenState(name) }));
    setEditingSession(current => current?.folder && sessionFolderWithin(current.folder.trim(), original) ? { ...current, folder: renamed(current.folder.trim()) } : current);
    refreshSavedSessions();
    } finally { folderMoveInProgress.current = false; }
  };

  const saveFolderCustomization = async (name: string, style: FolderStyle) => {
    if (!customizingFolder) return;
    await relocateSessionFolder(customizingFolder, name, style);
    setCustomizingFolder(null);
  };

  const folderDropAt = (x: number, y: number) => {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-session-folder]")?.dataset.sessionFolder ?? null;
    const source = folderDrag.current?.folder;
    return target !== null && source && !sessionFolderWithin(target, source) ? target : null;
  };
  const dropFolder = async (original: string, parent: string) => {
    const leaf = original.slice(original.lastIndexOf("/") + 1);
    const destination = parent ? `${parent}/${leaf}` : leaf;
    if (original === destination || isWorkspaceLocked()) return;
    try {
      await relocateSessionFolder(original, destination);
      setSessionNotice(`Moved folder “${original}” to “${destination}”.`);
    } catch (error) { setConnectionError(`Could not move folder: ${String(error)}`); }
  };

  const deleteSavedSession = useCallback(async (session: SavedSession) => {
    if (!IS_TAURI || !await confirmAction(`Delete saved session “${session.name}”?`)) return;
    try {
      await invoke<boolean>("session_delete", { sessionId: session.id });
      if (editingSession?.id === session.id) setEditingSession(null);
      refreshSavedSessions();
      setSessionNotice(`Deleted ${session.name}.`);
    } catch (error) {
      setConnectionError(`Session deletion failed: ${String(error)}`);
    }
  }, [editingSession?.id, refreshSavedSessions]);

  const connectSavedSessionRequest = useCallback(async (session: SavedSession) => {
    if (session.protocol === "LOCAL") {
      return openSavedLocalSession(session);
    }
    recordAudit("sessionOpened", session.protocol, session.id);
    touchSavedSession(session.id);
    if (session.protocol === "TELNET") {
      const profile = session.telnet_profile;
      if (!profile || session.port === 0) {
        setConnectionError("This Telnet profile has no saved terminal parameters.");
        return;
      }
      return connectTelnet({
        pptpProfileId: session.pptp_profile_id ?? undefined,
        host: session.hostname,
        port: session.port,
        username: session.username ?? undefined,
        credentialId: "credentialRef" in session.auth ? session.auth.credentialRef ?? undefined : undefined,
        terminal: profile.terminal,
        encoding: profile.encoding,
        columns: profile.columns,
        rows: profile.rows,
      }, false, session.name, session.id);
    }
    if (session.protocol === "SERIAL") {
      const profile = session.serial_profile;
      if (!profile) {
        setConnectionError("This serial profile has no saved device parameters.");
        return;
      }
      return connectSerial({
        device: profile.device,
        baudRate: profile.baud_rate,
        dataBits: profile.data_bits,
        stopBits: profile.stop_bits,
        parity: profile.parity,
        flowControl: profile.flow_control,
        lineEnding: profile.line_ending,
      }, session.id);
    }
    if (session.protocol === "RDP" || session.protocol === "VNC") {
      const profile = session.remote_desktop_profile;
      if (!profile || session.port === 0) {
        setConnectionError("This remote desktop profile has no saved display parameters.");
        return;
      }
      const protocol = session.protocol.toLowerCase() as DesktopProtocol;
      const credentialId = session.auth.kind === "password" ? session.auth.credentialRef : undefined;
      if (protocol === "rdp" && (!session.username?.trim() || !credentialId?.trim())) {
        setConnectionError("This RDP profile has no complete username or credential reference.");
        return;
      }
      return connectRemoteDesktop({
        protocol,
        host: session.hostname,
        port: session.port,
        username: session.username ?? "",
        domain: profile.domain ?? undefined,
        gatewayEndpoint: profile.gateway?.endpoint ?? undefined,
        gatewayUsername: profile.gateway?.username ?? undefined,
        gatewayCredentialId: profile.gateway?.credential_ref ?? undefined,
        credentialId,
        width: profile.width,
        height: profile.height,
        colorDepth: profile.color_depth,
        audioEnabled: profile.audio_enabled,
        clipboardEnabled: profile.clipboard_enabled ?? false,
        vncQuality: profile.vnc_quality ?? "balanced",
        allowInsecureVnc: profile.allow_insecure_vnc ?? false,
        reconnectEnabled: profile.reconnect_enabled ?? true,
        reconnectAttempts: profile.reconnect_attempts ?? 3,
      }, false, session.name);
    }
    const request = requestFromSavedSession(session, savedSessions);
    if (!request) {
      setConnectionError("This SSH profile has incomplete authentication or an unresolved, cyclic, or oversized jump chain (maximum 8 hosts).");
      return;
    }
    return connectSsh(request, false, session.name, undefined, session.id);
  }, [connectRemoteDesktop, connectSerial, connectSsh, connectTelnet, openSavedLocalSession, recordAudit, savedSessions, touchSavedSession]);

  const branchingSessions = useRef(new Set<string>());
  const branchSession = useCallback(async (workspaceId: string) => {
    const source = terminalTabsRef.current.find(item => item.id === workspaceId);
    if (isWorkspaceLocked() || !source || source.remoteProtocol !== "ssh" || !source.remoteSessionId || source.status !== "connected" || branchingSessions.current.has(workspaceId)) return;
    branchingSessions.current.add(workspaceId);
    const authentication = new TerminalAuthentication();
    const pending = createWorkspaceTerminal({ label: `${source.customName ?? source.label} · branch`, customName: `${source.customName ?? source.label} · branch`, remoteProtocol: "ssh", remoteHost: source.remoteHost, shortcutDeviceId: source.shortcutDeviceId, authentication, connecting: true });
    const removePending = () => {
      authentication.cancel();
      setTerminalTabs(current => current.filter(item => item.id !== pending.id));
      setTerminalLayout(current => removeLayoutNode(current, pending.id) ?? { kind: "pane", terminalId: workspaceId });
      setActiveTerminalId(current => current === pending.id ? workspaceId : current);
    };
    try {
      setTerminalTabs(current => [...current, pending]);
      setTerminalLayout(current => branchTerminalLayout(current, workspaceId, pending.id));
      setActiveTerminalId(pending.id);
      setActiveView("terminal");
      const grid = terminalInstancesRef.current.get(workspaceId)?.terminal;
      const response = await invoke<{ terminalId: string }>("ssh_branch", { terminalId: source.remoteSessionId, cols: grid?.cols ?? 80, rows: grid?.rows ?? 24 });
      if (authentication.closed || isWorkspaceLocked() || !terminalTabsRef.current.some(item => item.id === workspaceId && item.remoteSessionId === source.remoteSessionId)) {
        await invoke("ssh_close", { terminalId: response.terminalId }).catch(() => undefined);
        removePending();
        return;
      }
      setTerminalTabs(current => current.map(item => item.id === pending.id ? { ...item, remoteSessionId: response.terminalId, connecting: false } : item));
      recordAudit("sessionOpened", "SSH");
    } catch {
      const cancelled = authentication.closed || isWorkspaceLocked();
      removePending();
      if (cancelled || !terminalTabsRef.current.some(item => item.id === workspaceId && item.remoteSessionId === source.remoteSessionId && item.status === "connected")) return;
      const saved = savedSessions.find(item => item.id === source.shortcutDeviceId && item.protocol === "SSH");
      const request = saved ? requestFromSavedSession(saved, savedSessions) : null;
      if (!request) {
        setConnectionError("An additional SSH shell could not be opened. Save this connection as a session to use a separate-login branch.");
        return;
      }
      if (!await confirmAction("An additional shell could not be opened on this SSH connection. Open a separate SSH login beside the original? Authentication may be required.", { title: "Branch session", acceptLabel: "Open separate login" }) || isWorkspaceLocked()) return;
      if (!terminalTabsRef.current.some(item => item.id === workspaceId && item.remoteSessionId === source.remoteSessionId)) return;
      await connectSsh({ ...request, startupCommand: undefined, startupDirectory: undefined }, false, `${source.customName ?? saved!.name} · branch`, undefined, saved!.id, workspaceId);
    } finally {
      branchingSessions.current.delete(workspaceId);
    }
  }, [connectSsh, recordAudit, savedSessions]);

  const connectSavedSession = useCallback(async (session: SavedSession) => {
    if (session.protocol === "LOCAL") return openSavedLocalSession(session);
    await savedSessionAttempt.current.run(async () => {
      setPendingSavedSession({ id: session.id, name: session.name });
      try {
        await connectSavedSessionRequest(session);
      } finally {
        setPendingSavedSession(null);
      }
    });
  }, [connectSavedSessionRequest, openSavedLocalSession]);

  const reconnectBusyRef = useRef(false);
  const [reconnectBusy, setReconnectBusy] = useState(false);
  const reconnectSelectedTerminal = useCallback(async () => {
    const terminal = terminalTabsRef.current.find(item => item.id === selectedTerminalIdRef.current);
    if (reconnectBusyRef.current || isWorkspaceLocked() || !terminal || !canReconnectTerminal(terminal.remoteProtocol, terminal.status, terminal.connecting)) return;
    reconnectBusyRef.current = true;
    setReconnectBusy(true);
    setConnectionError(null);
    try {
      if ((terminal.remoteProtocol === "telnet" || terminal.remoteProtocol === "serial") && terminal.remoteSessionId) {
        await invoke(`${terminal.remoteProtocol}_reconnect`, { terminalId: terminal.remoteSessionId });
      } else {
        const saved = savedSessions.find(item => item.id === terminal.shortcutDeviceId);
        if (saved) await connectSavedSession(saved);
        else {
          setSessionNotice("This connection has no saved profile. Enter its connection details to reconnect.");
          setQuickConnectOpen(true);
        }
      }
    } catch (error) {
      setConnectionError(String(error));
    } finally {
      reconnectBusyRef.current = false;
      setReconnectBusy(false);
    }
  }, [connectSavedSession, savedSessions, setQuickConnectOpen]);

  useEffect(() => {
    const reconnect = (event: KeyboardEvent) => {
      const terminal = terminalTabsRef.current.find(item => item.id === selectedTerminalIdRef.current);
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!isReconnectKey(event) || activeView !== "terminal" || closing || isWorkspaceLocked() || editingRemoteFile
        || !terminal || !canReconnectTerminal(terminal.remoteProtocol, terminal.status, terminal.connecting)
        || document.querySelector('dialog[open], [aria-modal="true"]')
        || (isEditableKeyboardTarget(event.target) && !target?.closest(".xterm"))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void reconnectSelectedTerminal();
    };
    window.addEventListener("keydown", reconnect, true);
    return () => window.removeEventListener("keydown", reconnect, true);
  }, [activeView, closing, editingRemoteFile, reconnectSelectedTerminal]);

  const writeToExplicitTargets = useCallback(async (targets: MacroTargetBinding[], data: string) => {
    const beforeSend = () => {
      if (macroCancelRef.current) throw new Error("cancelled");
      if (!macroTargetsStillBound(targets, nativeTerminalIdsRef.current, terminalGenerationsRef.current)) {
        throw new Error("a selected terminal changed or closed during the macro; this action was not sent");
      }
    };
    beforeSend();
    await settleTerminalWrites(targets.map((target) => writeTerminalInput(target.workspaceId, target.nativeId, data, beforeSend)));
  }, [writeTerminalInput]);

  const runMacro = useCallback(async (record: MacroRecord, targetIds: string[]) => {
    if (macroRunRef.current) {
      setConnectionError("A macro is already running. Cancel it before starting another one.");
      return;
    }
    const targets = [...new Set(targetIds)];
    if (targets.length === 0) {
      setConnectionError("Select at least one ready terminal before running a macro.");
      return;
    }
    const targetBindings = pinMacroTargets(targets, nativeTerminalIdsRef.current, terminalGenerationsRef.current);
    if (!targetBindings || targetBindings.some(({ workspaceId }) => terminalAuditStateRef.current.get(workspaceId) !== "connected")) {
      setConnectionError("The macro was not started because every selected terminal must be ready.");
      return;
    }
    const targetLabels = targets.map((id) => terminalTabsRef.current.find((terminal) => terminal.id === id)?.label ?? id);
    const warning = record.actions.some((action) => action.kind === "executeCommand" || action.kind === "openSession" || action.kind === "switchWorkspace")
      ? `Macro “${record.title}” includes command or session-control actions. Run it on ${targetLabels.join(", ")}?`
      : `Run macro “${record.title}” on ${targetLabels.join(", ")}?`;
    const approvalNote = record.approval === "eachAction" ? "Every action will ask for approval before it runs." : "Execution is visible and can be cancelled.";
    if (!await confirmAction(`${warning}\n\n${approvalNote} Do not include passwords or tokens in macro text.`)) return;
    if (macroRunRef.current || !macroTargetsStillBound(targetBindings, nativeTerminalIdsRef.current, terminalGenerationsRef.current)) {
      setConnectionError("The macro was not started because a selected terminal changed or another macro started during approval.");
      return;
    }

    const keyData: Record<MacroKey, string> = {
      enter: "\r",
      escape: "\x1b",
      tab: "\t",
      backspace: "\x7f",
      ctrlC: "\x03",
      ctrlD: "\x04",
      arrowUp: "\x1b[A",
      arrowDown: "\x1b[B",
      arrowLeft: "\x1b[D",
      arrowRight: "\x1b[C",
    };
    const wait = async (milliseconds: number) => {
      let remaining = milliseconds;
      while (remaining > 0) {
        if (macroCancelRef.current) throw new Error("cancelled");
        const slice = Math.min(remaining, 50);
        await new Promise<void>((resolve) => window.setTimeout(resolve, slice));
        remaining -= slice;
      }
    };

    macroCancelRef.current = false;
    setMacrosOpen(false);
    setRecordedMacroDraft(null);
    setActiveView("terminal");
    const runState = { title: record.title, step: 0, total: record.actions.length, targets: targetLabels };
    macroRunRef.current = runState;
    setMacroRun(runState);
    try {
      for (const [index, action] of record.actions.entries()) {
        if (macroCancelRef.current) throw new Error("cancelled");
        if (record.approval === "eachAction") {
          const actionDescription = action.kind === "executeCommand"
            ? "execute a saved command (review its text in the editor)"
            : action.kind === "sendText"
              ? "send a saved text payload"
              : action.kind === "sendKey"
                ? `send the ${action.key} key`
                : action.kind === "wait"
                  ? `wait ${action.milliseconds} ms`
                  : action.kind === "openSession"
                    ? "open a saved session"
                    : "switch workspace";
          if (!await confirmAction(`Approve macro action ${index + 1}/${record.actions.length}: ${actionDescription}?\n\nNo action will run if you cancel.`)) {
            throw new Error("approval declined");
          }
        }
        if (macroCancelRef.current) throw new Error("cancelled");
        const nextRunState = { title: record.title, step: index + 1, total: record.actions.length, targets: targetLabels };
        macroRunRef.current = nextRunState;
        setMacroRun(nextRunState);
        if (action.kind === "sendText") await writeToExplicitTargets(targetBindings, action.text);
        if (action.kind === "executeCommand") await writeToExplicitTargets(targetBindings, `${action.command}\r`);
        if (action.kind === "sendKey") await writeToExplicitTargets(targetBindings, keyData[action.key]);
        if (action.kind === "wait") await wait(action.milliseconds);
        if (action.kind === "switchWorkspace") {
          if (!terminalTabsRef.current.some((terminal) => terminal.id === action.workspaceId)) throw new Error("workspace target no longer exists");
          setActiveTerminalId(action.workspaceId);
          setActiveView("terminal");
        }
        if (action.kind === "openSession") {
          const session = savedSessions.find((item) => item.id === action.sessionId);
          if (!session) throw new Error("saved session target no longer exists");
          await connectSavedSession(session);
          await wait(100);
        }
      }
      macroRunRef.current = null;
      setMacroRun(null);
      setSessionNotice(`Macro “${record.title}” completed on ${targetLabels.length} terminal${targetLabels.length === 1 ? "" : "s"}.`);
      setConnectionError(null);
    } catch (error) {
      macroRunRef.current = null;
      setMacroRun(null);
      if (macroCancelRef.current || String(error).includes("cancelled")) {
        setSessionNotice(`Macro “${record.title}” cancelled before completion. Earlier actions may have run; check the targets before retrying.`);
        setConnectionError(null);
      } else if (String(error).includes("approval declined")) {
        setSessionNotice(`Macro “${record.title}” stopped before the next unapproved action.`);
        setConnectionError(null);
      } else {
        setConnectionError(`Macro “${record.title}” stopped: ${String(error)}. Earlier actions or other targets may have received input; check before retrying.`);
      }
    }
  }, [connectSavedSession, savedSessions, setMacrosOpen, writeToExplicitTargets]);

  const cancelMacro = useCallback(() => {
    if (!macroRun) return;
    macroCancelRef.current = true;
    setSessionNotice(`Cancellation requested for macro “${macroRun.title}”.`);
  }, [macroRun]);

  const loadRemoteDirectory = useCallback(async (path: string) => {
    if (!remoteSessionId || remoteSessionIdRef.current !== remoteSessionId) return;
    const requestId = ++remoteDirectoryRequestRef.current;
    const sessionId = remoteSessionId;
    const isCurrentRequest = () => isCurrentSessionRequest(
      requestId,
      remoteDirectoryRequestRef.current,
      sessionId,
      remoteSessionIdRef.current,
    );
    setRemoteListingSessionId(sessionId);
    setRemoteEntries([]);
    setRemotePath(path);
    setSftpStatus("loading");
    setRemoteDirectoryError(null);
    try {
      const entries = await invoke<RemoteEntry[]>("ssh_list_directory", {
        terminalId: sessionId,
        path,
      });
      if (!isCurrentRequest()) return;
      sftpAvailabilityRef.current.set(sessionId, true);
      setRemoteEntries(entries);
      setRemotePath(path);
      setSftpStatus("ready");
    } catch (error) {
      if (!isCurrentRequest()) return;
      setSftpStatus("error");
      setRemoteDirectoryError(String(error));
      // A terminal can work even when its server has no SFTP subsystem.
      // Keep ordinary directory errors visible after SFTP has worked, but
      // restore sessions when the initial file-browser setup is unavailable.
      if (sftpAvailabilityRef.current.get(sessionId) !== true) {
        sftpAvailabilityRef.current.set(sessionId, false);
        setSidebarMode("sessions");
      }
    }
  }, [remoteSessionId]);

  const navigateRemote = useCallback((path: string) => {
    void loadRemoteDirectory(path);
  }, [loadRemoteDirectory]);

  const collectRemoteMonitor = useCallback(async () => {
    if (!remoteSessionId || remoteProtocol !== "ssh") return;
    if (!IS_TAURI) {
      setRemoteMonitorStatus("error");
      setRemoteMonitorError("Remote monitoring requires the desktop runtime.");
      return;
    }
    const sessionId = remoteSessionId;
    if (remoteMonitorRequestRef.current?.sessionId === sessionId) return;
    const requestId = ++remoteMonitorRequestSequenceRef.current;
    remoteMonitorRequestRef.current = { requestId, sessionId };
    const isCurrentRequest = () => {
      const current = remoteMonitorRequestRef.current;
      return current !== null && isCurrentSessionRequest(
        requestId,
        current.requestId,
        sessionId,
        remoteSessionIdRef.current,
      );
    };
    setRemoteMonitorStatus("loading");
    setRemoteMonitorError(null);
    try {
      const snapshot = await invoke<RemoteMonitorSnapshot>("ssh_collect_remote_monitor", { terminalId: sessionId });
      if (!isCurrentRequest()) return;
      setRemoteMonitor(snapshot);
      setRemoteMonitorStatus("ready");
    } catch (error) {
      if (!isCurrentRequest()) return;
      setRemoteMonitorStatus("error");
      setRemoteMonitorError(String(error));
    } finally {
      if (remoteMonitorRequestRef.current?.requestId === requestId) {
        remoteMonitorRequestRef.current = null;
      }
    }
  }, [remoteProtocol, remoteSessionId]);

  const pinRemoteFileConnection = useCallback((sessionId: string) => {
    // Native SSH IDs survive reconnect; pin the generation before any file approval.
    const workspace = terminalTabsRef.current.find((terminal) => terminal.remoteProtocol === "ssh" && terminal.remoteSessionId === sessionId);
    const binding = workspace ? pinMacroTargets([workspace.id], nativeTerminalIdsRef.current, terminalGenerationsRef.current) : null;
    return () => {
      if (binding && macroTargetsStillBound(binding, nativeTerminalIdsRef.current, terminalGenerationsRef.current) && binding.every(({ workspaceId, nativeId }) => nativeId === sessionId && terminalAuditStateRef.current.get(workspaceId) === "connected")) return true;
      setSessionNotice("File action stopped because its SSH connection changed or closed. Reopen the file or action after reconnecting.");
      return false;
    };
  }, []);

  const openRemoteTextFile = useCallback(async (entry: RemoteEntry, encoding: RemoteTextDocument["encoding"]) => {
    if (!remoteSessionId || !entry.isRegular) return;
    const sessionId = remoteSessionId;
    const stillConnected = pinRemoteFileConnection(sessionId);
    if (!stillConnected()) return;
    const requestId = ++remoteFileOpenRequestRef.current;
    try {
      const document = await invoke<RemoteTextDocument>("ssh_open_remote_text_file", {
        terminalId: sessionId,
        path: entry.path,
        encoding,
      });
      if (!isCurrentSessionRequest(
        requestId,
        remoteFileOpenRequestRef.current,
        sessionId,
        remoteSessionIdRef.current,
      ) || !stillConnected()) return;
      setEditingRemoteFile({ sessionId, document, stillConnected });
      setConnectionError(null);
    } catch (error) {
      if (!isCurrentSessionRequest(
        requestId,
        remoteFileOpenRequestRef.current,
        sessionId,
        remoteSessionIdRef.current,
      )) return;
      setConnectionError(`Remote file could not be opened: ${String(error)}`);
    }
  }, [pinRemoteFileConnection, remoteSessionId]);

  const reloadRemoteTextFile = useCallback(async (dirty: boolean) => {
    if (!editingRemoteFile) throw new Error("Reopen the file before reloading.");
    const reloaded = await reloadRemoteEditorDocument({
      dirty,
      confirmDiscard: () => confirmAction("Reload this file from the server? Unsaved local changes will be discarded only if the read succeeds."),
      stillConnected: editingRemoteFile.stillConnected,
      read: () => invoke<RemoteTextDocument>("ssh_open_remote_text_file", {
        terminalId: editingRemoteFile.sessionId,
        path: editingRemoteFile.document.path,
        encoding: editingRemoteFile.document.encoding,
      }),
    });
    if (!reloaded) return null;
    setEditingRemoteFile((current) => current === editingRemoteFile ? { ...current, document: reloaded } : current);
    setSessionNotice(`Reloaded ${reloaded.path}.`);
    return reloaded;
  }, [editingRemoteFile]);

  const saveRemoteTextFile = useCallback(async (content: string, encoding: RemoteTextDocument["encoding"]) => {
    if (!editingRemoteFile) return;
    if (!editingRemoteFile.stillConnected()) throw new Error("The SSH connection changed or closed. Reopen the file before saving.");
    const sessionId = editingRemoteFile.sessionId;
    const saved = await invoke<RemoteTextDocument>("ssh_save_remote_text_file", {
      terminalId: sessionId,
      path: editingRemoteFile.document.path,
      expectedRevision: editingRemoteFile.document.revision,
      content,
      encoding,
    });
    setEditingRemoteFile((current) => current === editingRemoteFile ? { ...current, document: saved } : current);
    setSessionNotice(remoteEditorSaveNotice(saved.path, saved.backupCleanupFailed));
    if (remoteSessionIdRef.current === sessionId) {
      setConnectionError(null);
      void loadRemoteDirectory(remotePath);
    }
  }, [editingRemoteFile, loadRemoteDirectory, remotePath]);

  const saveRemoteTextFileAs = useCallback(async (path: string, content: string, encoding: RemoteTextDocument["encoding"], overwrite: boolean) => {
    if (!editingRemoteFile) return;
    if (!editingRemoteFile.stillConnected()) throw new Error("The SSH connection changed or closed. Reopen the file before saving.");
    const sessionId = editingRemoteFile.sessionId;
    const saved = await invoke<RemoteTextDocument>("ssh_save_remote_text_file_as", {
      terminalId: sessionId,
      path,
      content,
      encoding,
      overwrite,
    });
    setEditingRemoteFile((current) => current === editingRemoteFile ? { ...current, document: saved } : current);
    setSessionNotice(remoteEditorSaveNotice(saved.path, saved.backupCleanupFailed));
    if (remoteSessionIdRef.current === sessionId) {
      setConnectionError(null);
      void loadRemoteDirectory(remotePath);
    }
  }, [editingRemoteFile, loadRemoteDirectory, remotePath]);

  const startDownload = useCallback(async (entry: RemoteEntry, protocol: TransferProtocol) => {
    if (!remoteSessionId) return;
    const stillConnected = pinRemoteFileConnection(remoteSessionId);
    if (!stillConnected()) return;
    let localPath: string | null = null;
    if (IS_TAURI) {
      try {
        localPath = await invoke<string | null>("local_pick_download_path", {
          kind: entry.isDirectory ? "directory" : "file",
          suggestedName: entry.name,
        });
      } catch (error) {
        setConnectionError(`Local destination picker failed: ${String(error)}`);
        return;
      }
    } else {
      localPath = await promptText(entry.isDirectory ? "Local destination directory" : "Local destination path", entry.name);
    }
    if (!localPath?.trim() || !stillConnected()) return;
    if (remoteSessionIdRef.current !== remoteSessionId) {
      setSessionNotice("Download setup stopped because the active SSH session changed.");
      return;
    }
    const overwrite = await chooseOverwrite(entry.isDirectory ? "Choose how existing files inside this directory should be handled." : "Choose how an existing local destination should be handled.");
    if (overwrite === null || !stillConnected() || remoteSessionIdRef.current !== remoteSessionId) return;
    try {
      await invoke("ssh_download", {
        terminalId: remoteSessionId,
        request: { remotePath: entry.path, localPath, protocol, overwrite, recursive: entry.isDirectory },
      });
      setConnectionError(null);
    } catch (error) {
      setConnectionError(String(error));
    }
  }, [pinRemoteFileConnection, remoteSessionId]);

  const startUpload = useCallback(async (protocol: TransferProtocol, pickerKind: LocalUploadPickerKind = "files", droppedPaths: string[] = []) => {
    if (!remoteSessionId) return;
    const stillConnected = pinRemoteFileConnection(remoteSessionId);
    if (!stillConnected()) return;
    if (remoteListingSessionId !== remoteSessionId || sftpStatus !== "ready") {
      setConnectionError("Wait for remote files to load before uploading.");
      return;
    }
    let paths = normalizeDroppedUploadPaths(droppedPaths);
    if (paths.length === 0 && IS_TAURI) {
      try {
        paths = await invoke<string[]>("local_pick_upload_paths", { kind: pickerKind });
      } catch (error) {
        setConnectionError(`Local file picker failed: ${String(error)}`);
        return;
      }
    }
    if (paths.length === 0 && !IS_TAURI) {
      const localPath = await promptText("Local file or directory to upload", "");
      paths = localPath?.trim() ? [localPath] : [];
    }
    for (const localPath of paths) {
      if (!stillConnected()) return;
      if (remoteSessionIdRef.current !== remoteSessionId) {
        setSessionNotice("Upload setup stopped because the active SSH session changed.");
        return;
      }
      const fallbackName = localPath.split(/[\\/]/).pop() || "upload.bin";
      const defaultRemotePath = remoteChildPath(remotePath, fallbackName);
      const destination = await promptText("Remote destination path", defaultRemotePath);
      if (!destination?.trim()) break;
      if (!stillConnected() || remoteSessionIdRef.current !== remoteSessionId) return;
      const overwrite = await chooseOverwrite("Choose how existing remote files should be handled. Create only refuses replacement.");
      if (overwrite === null || !stillConnected() || remoteSessionIdRef.current !== remoteSessionId) return;
      try {
        await invoke("ssh_upload", {
          terminalId: remoteSessionId,
          request: { remotePath: destination, localPath, protocol, overwrite, recursive: protocol === "sftp" },
        });
        setConnectionError(null);
      } catch (error) {
        setConnectionError(String(error));
      }
    }
  }, [pinRemoteFileConnection, remoteListingSessionId, remotePath, remoteSessionId, sftpStatus]);

  useEffect(() => {
    if (!IS_TAURI || activeView !== "files" || !remoteSessionId || remoteProtocol !== "ssh") {
      setLocalDropActive(false);
      return;
    }

    let disposed = false;
    let unlistenDragDrop: (() => void) | undefined;
    void getCurrentWebview().onDragDropEvent((event: TauriEvent<DragDropEvent>) => {
      if (disposed) return;
      if (event.payload.type === "enter") {
        setLocalDropActive(true);
      } else if (event.payload.type === "leave") {
        setLocalDropActive(false);
      } else if (event.payload.type === "drop") {
        setLocalDropActive(false);
        const paths = normalizeDroppedUploadPaths(event.payload.paths);
        if (paths.length === 0) return;
        void startUpload("sftp", "files", paths);
      }
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlistenDragDrop = unlisten;
    }).catch((error) => {
      if (!disposed) setConnectionError(`Native file drop is unavailable: ${String(error)}`);
    });

    return () => {
      disposed = true;
      setLocalDropActive(false);
      unlistenDragDrop?.();
    };
  }, [activeView, remoteProtocol, remoteSessionId, startUpload]);

  const retryTransfer = useCallback(async (transfer: SshTransferEvent) => {
    if (!IS_TAURI) {
      setConnectionError("Transfer retry requires the desktop runtime.");
      return;
    }
    const stillConnected = pinRemoteFileConnection(transfer.terminalId);
    if (!stillConnected()) return;
    const remotePath = transfer.direction === "download" ? transfer.source : transfer.destination;
    const localPath = transfer.direction === "download" ? transfer.destination : transfer.source;
    const overwrite = await confirmAction(`Retry this transfer and allow replacing the destination?\n\n${quoteRemotePromptPath(remotePath)}`);
    if (!overwrite || !stillConnected()) return;
    const command = transfer.direction === "download" ? "ssh_download" : "ssh_upload";
    try {
      await invoke(command, {
        terminalId: transfer.terminalId,
        request: {
          remotePath,
          localPath,
          protocol: transfer.protocol,
          overwrite: true,
          recursive: transfer.recursive,
        },
      });
      setConnectionError(null);
      setSessionNotice(`Retry queued for ${remotePath}.`);
    } catch (error) {
      setConnectionError(`Transfer retry failed: ${String(error)}`);
    }
  }, [pinRemoteFileConnection]);

  const createRemoteDirectory = useCallback(async () => {
    if (!remoteSessionId) return;
    const stillConnected = pinRemoteFileConnection(remoteSessionId);
    if (!stillConnected()) return;
    const defaultPath = remoteChildPath(remotePath, "new-folder");
    const path = await promptText("Remote folder path", defaultPath);
    if (!path?.trim() || !stillConnected() || remoteSessionIdRef.current !== remoteSessionId) return;
    try {
      await invoke("ssh_create_remote_directory", { terminalId: remoteSessionId, path });
      setConnectionError(null);
      await loadRemoteDirectory(remotePath);
    } catch (error) {
      setConnectionError(String(error));
    }
  }, [loadRemoteDirectory, pinRemoteFileConnection, remotePath, remoteSessionId]);

  const renameRemote = useCallback(async (entry: RemoteEntry) => {
    if (!remoteSessionId) return;
    const stillConnected = pinRemoteFileConnection(remoteSessionId);
    if (!stillConnected()) return;
    const nextName = await promptText(`New remote name or path for ${quoteRemotePromptPath(entry.path)}`, entry.name);
    if (!nextName?.trim() || !stillConnected() || remoteSessionIdRef.current !== remoteSessionId) return;
    const target = nextName.includes("/") ? nextName : remoteChildPath(remoteParentPath(entry.path), nextName);
    try {
      await invoke("ssh_rename_remote", { terminalId: remoteSessionId, from: entry.path, to: target });
      setConnectionError(null);
      await loadRemoteDirectory(remotePath);
    } catch (error) {
      setConnectionError(String(error));
    }
  }, [loadRemoteDirectory, pinRemoteFileConnection, remotePath, remoteSessionId]);

  const deleteRemote = useCallback(async (entry: RemoteEntry) => {
    if (!remoteSessionId) return;
    const stillConnected = pinRemoteFileConnection(remoteSessionId);
    const kind = entry.isSymlink ? "symbolic link" : entry.isDirectory ? "directory" : "file";
    const details = entry.isSymlink ? "\n\nThe link itself will be removed; its target will be kept." : entry.isDirectory ? "\n\nOnly empty directories can be deleted." : "";
    if (!stillConnected() || !await confirmAction(`Delete remote ${kind} ${quoteRemotePromptPath(entry.path)}?${details}`) || !stillConnected() || remoteSessionIdRef.current !== remoteSessionId) return;
    try {
      await invoke("ssh_delete_remote", { terminalId: remoteSessionId, path: entry.path });
      setConnectionError(null);
      await loadRemoteDirectory(remotePath);
    } catch (error) {
      setConnectionError(String(error));
    }
  }, [loadRemoteDirectory, pinRemoteFileConnection, remotePath, remoteSessionId]);

  const setRemotePermissions = useCallback(async (entry: RemoteEntry) => {
    if (!remoteSessionId) return;
    const stillConnected = pinRemoteFileConnection(remoteSessionId);
    if (!stillConnected()) return;
    if (entry.isSymlink) {
      setConnectionError("Select the link target explicitly to change its permissions.");
      return;
    }
    const current = entry.permissions == null ? "644" : (entry.permissions & 0o7777).toString(8).padStart(3, "0");
    const value = await promptText(`Set POSIX mode for ${quoteRemotePromptPath(entry.path)} (octal 0000–7777)`, current);
    if (value === null || !stillConnected() || remoteSessionIdRef.current !== remoteSessionId) return;
    const normalized = value.trim();
    if (!/^[0-7]{3,4}$/.test(normalized)) {
      setConnectionError("Permissions must be an octal mode with 3 or 4 digits, for example 640.");
      return;
    }
    if (!await confirmAction(`Apply mode ${normalized} to ${quoteRemotePromptPath(entry.path)}?`) || !stillConnected() || remoteSessionIdRef.current !== remoteSessionId) return;
    try {
      await invoke("ssh_set_remote_permissions", {
        terminalId: remoteSessionId,
        path: entry.path,
        permissions: Number.parseInt(normalized, 8),
      });
      setConnectionError(null);
      setSessionNotice(`Updated permissions for ${entry.name} to ${normalized}.`);
      await loadRemoteDirectory(remotePath);
    } catch (error) {
      setConnectionError(String(error));
    }
  }, [loadRemoteDirectory, pinRemoteFileConnection, remotePath, remoteSessionId]);

  const copyRemotePath = useCallback(async (entry: RemoteEntry) => {
    try {
      if (IS_TAURI || typeof navigator.clipboard?.writeText === "function") {
        await writeClipboardText(entry.path);
        setSessionNotice(`Copied remote path ${entry.path}.`);
      } else {
        setSessionNotice(null);
        await promptText("Copy remote path", entry.path, { multiline: true, readOnly: true });
      }
    } catch (error) {
      setConnectionError(`Remote path could not be copied: ${String(error)}`);
    }
  }, []);

  const cancelTransfer = useCallback(async (transferId: string) => {
    try {
      await invoke("ssh_cancel_transfer", { transferId });
    } catch (error) {
      setConnectionError(String(error));
    }
  }, []);

  const startTunnel = async (request: { bindHost: string; bindPort: number; targetHost?: string; targetPort?: number }) => {
    if (!tunnelDraft) return;
    // Keep the dialog attached to the connection chosen when it opened.
    if (remoteSessionIdRef.current !== tunnelDraft.terminalId) throw new Error("The SSH session changed. Close this dialog and select the intended session.");
    await invoke(`ssh_start_${tunnelDraft.kind}_forward`, { terminalId: tunnelDraft.terminalId, request });
    setTunnelDraft(null);
    setConnectionError(null);
    setActiveView("tunnels");
  };

  const cancelTunnel = useCallback(async (tunnelId: string) => {
    try {
      await invoke("ssh_cancel_tunnel", { tunnelId });
    } catch (error) {
      setConnectionError(String(error));
    }
  }, []);

  const resolveNetworkHost = useCallback(async () => {
    const host = networkHost.trim();
    const timeoutMs = Number(networkTimeout);
    if (!host) {
      setNetworkError("Enter an explicit hostname or IP address.");
      setNetworkStatus("error");
      return;
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 60_000) {
      setNetworkError("Timeout must be an integer between 50 and 60000 milliseconds.");
      setNetworkStatus("error");
      return;
    }
    if (!IS_TAURI) {
      setNetworkError("Network diagnostics require the desktop runtime.");
      setNetworkStatus("error");
      return;
    }
    setDnsReport(null);
    setNetworkStatus("running");
    setNetworkError(null);
    try {
      const report = await invoke<{ tool: string; output: string; elapsedMs: number }>("network_dns_lookup", { request: { host, timeoutMs, recordType: dnsRecordType, server: dnsServer.trim() || null } });
      setDnsReport(report);
      setNetworkStatus("ready");
    } catch (error) {
      setDnsReport(null);
      setNetworkError(String(error));
      setNetworkStatus("error");
    }
  }, [networkHost, networkTimeout, dnsRecordType, dnsServer]);

  const checkNetworkTcp = useCallback(async () => {
    setNetworkResult(null);
    const host = networkHost.trim();
    const port = Number(networkTcpPort);
    const timeoutMs = Number(networkTimeout);
    if (!host) {
      setNetworkError("Enter an explicit hostname or IP address.");
      setNetworkStatus("error");
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      setNetworkError("Port must be an integer between 1 and 65535.");
      setNetworkStatus("error");
      return;
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 60_000) {
      setNetworkError("Timeout must be an integer between 50 and 60000 milliseconds.");
      setNetworkStatus("error");
      return;
    }
    if (!IS_TAURI) {
      setNetworkError("Network diagnostics require the desktop runtime.");
      setNetworkStatus("error");
      return;
    }
    setNetworkStatus("running");
    setNetworkError(null);
    try {
      const result = await invoke<TcpConnectReport>("network_check_tcp", { request: { host, port, timeoutMs } });
      setNetworkResult(result);
      setNetworkStatus("ready");
    } catch (error) {
      setNetworkResult(null);
      setNetworkError(String(error));
      setNetworkStatus("error");
    }
  }, [networkHost, networkTcpPort, networkTimeout]);

  const inspectNetworkHostKey = useCallback(async () => {
    const host = networkHost.trim();
    const port = Number(networkPort);
    const timeoutMs = Number(networkTimeout);
    if (!host) {
      setNetworkError("Enter an explicit hostname or IP address.");
      setNetworkStatus("error");
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      setNetworkError("Port must be an integer between 1 and 65535.");
      setNetworkStatus("error");
      return;
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 60_000) {
      setNetworkError("Timeout must be an integer between 50 and 60000 milliseconds.");
      setNetworkStatus("error");
      return;
    }
    if (!IS_TAURI) {
      setNetworkError("SSH fingerprint inspection requires the desktop runtime.");
      setNetworkStatus("error");
      return;
    }
    setNetworkStatus("running");
    setNetworkFingerprint(null);
    setNetworkError(null);
    try {
      const result = await invoke<SshHostKeyInspection>("ssh_inspect_host_key", { request: { host, port, timeoutMs } });
      setNetworkFingerprint(result);
      setNetworkStatus("ready");
    } catch (error) {
      setNetworkFingerprint(null);
      setNetworkStatus("error");
      setNetworkError(String(error));
    }
  }, [networkHost, networkPort, networkTimeout]);

  const cancelNetworkDiagnosticId = useCallback(async (operationId: string) => {
    try {
      await invoke("network_diagnostic_cancel", { operationId });
    } catch (error) {
      setNetworkError(`Diagnostic cancellation failed: ${String(error)}`);
    }
  }, []);

  const startNetworkPing = useCallback(async () => {
    const host = networkHost.trim();
    const timeoutMs = Number(networkTimeout);
    if (!host) {
      setNetworkError("Enter an explicit hostname or IP address.");
      setNetworkDiagnosticStatus("failed");
      return;
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 60_000) {
      setNetworkError("Timeout must be an integer between 50 and 60000 milliseconds.");
      setNetworkDiagnosticStatus("failed");
      return;
    }
    const intervalMs = Number(pingInterval), packetSize = Number(pingPacketSize);
    if (!Number.isInteger(intervalMs) || intervalMs < 200 || intervalMs > 60000 || !Number.isInteger(packetSize) || packetSize < 0 || packetSize > 65500 || !pingInterval.trim() || !pingPacketSize.trim()) {
      setNetworkError("Ping interval must be 200–60000 ms and packet size must be 0–65500 payload bytes.");
      setNetworkDiagnosticStatus("failed");
      return;
    }
    if (!IS_TAURI) {
      setNetworkError("Network diagnostics require the desktop runtime.");
      setNetworkDiagnosticStatus("failed");
      return;
    }
    const run = networkDiagnosticRunRef.current;
    const pending = beginNetworkDiagnostic(run);
    if (!pending) return;
    if (pending.cancelId) await invoke("network_diagnostic_cancel", { operationId: pending.cancelId }).catch(() => undefined);
    if (run.generation !== pending.generation) return;
    setNetworkDiagnosticKind("ping");
    setNetworkDiagnosticStatus("running");
    setNetworkPingResult(null);
    setNetworkError(null);
    try {
      const response = await invoke<{ operationId: string }>("network_ping_start", { request: { host, timeoutMs, intervalMs, packetSize } });
      if (acceptNetworkDiagnosticResponse(run, pending.generation, response.operationId)) {
        const cancelId = takePendingNetworkDiagnosticCancel(run);
        if (cancelId) void cancelNetworkDiagnosticId(cancelId);
      }
    } catch (error) {
      if (failNetworkDiagnosticStart(run, pending.generation)) {
        setNetworkDiagnosticStatus("failed");
        setNetworkError(String(error));
      }
    }
  }, [cancelNetworkDiagnosticId, networkHost, networkTimeout, pingInterval, pingPacketSize]);

  const startNetworkMtr = useCallback(async () => {
    const host = networkHost.trim();
    const timeoutMs = Number(networkTimeout);
    const maxHops = Number(networkTraceMaxHops);
    if (!host) {
      setNetworkError("Enter an explicit hostname or IP address.");
      setNetworkDiagnosticStatus("failed");
      return;
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 60_000 || !Number.isInteger(maxHops) || maxHops < 1 || maxHops > 32) {
      setNetworkError("Timeout must be 50–60000 ms and max hops must be between 1 and 32.");
      setNetworkDiagnosticStatus("failed");
      return;
    }
    if (!IS_TAURI) {
      setNetworkError("Network diagnostics require the desktop runtime.");
      setNetworkDiagnosticStatus("failed");
      return;
    }
    const run = networkDiagnosticRunRef.current;
    const pending = beginNetworkDiagnostic(run);
    if (!pending) return;
    if (pending.cancelId) await invoke("network_diagnostic_cancel", { operationId: pending.cancelId }).catch(() => undefined);
    if (run.generation !== pending.generation) return;
    setNetworkDiagnosticKind("mtr");
    setNetworkDiagnosticStatus("running");
    setNetworkMtrResult(null);
    setNetworkError(null);
    try {
      const response = await invoke<{ operationId: string }>("network_mtr_start", { request: { host, timeoutMs: 60000, maxHops } });
      if (acceptNetworkDiagnosticResponse(run, pending.generation, response.operationId)) {
        const cancelId = takePendingNetworkDiagnosticCancel(run);
        if (cancelId) void cancelNetworkDiagnosticId(cancelId);
      }
    } catch (error) {
      if (failNetworkDiagnosticStart(run, pending.generation)) {
        setNetworkDiagnosticStatus("failed");
        setNetworkError(String(error));
      }
    }
  }, [cancelNetworkDiagnosticId, networkHost, networkTimeout, networkTraceMaxHops]);

  const cancelNetworkDiagnostic = useCallback(async () => {
    if (!IS_TAURI) return;
    const operationId = requestNetworkDiagnosticCancel(networkDiagnosticRunRef.current);
    if (operationId) await cancelNetworkDiagnosticId(operationId);
  }, [cancelNetworkDiagnosticId]);

  const startNetworkScan = useCallback(async () => {
    const host = networkHost.trim();
    const startPort = Number(networkScanStart);
    const endPort = Number(networkScanEnd);
    const concurrency = Number(networkScanConcurrency);
    const timeoutMs = Number(networkTimeout);
    if (!host) {
      setNetworkError("Enter an explicit hostname or IP address.");
      setNetworkStatus("error");
      return;
    }
    if (!Number.isInteger(startPort) || !Number.isInteger(endPort) || startPort < 1 || endPort < startPort || endPort > 65_535 || endPort - startPort + 1 > 4_096) {
      setNetworkError("Port range must be explicit, valid, and no larger than 4096 ports.");
      setNetworkStatus("error");
      return;
    }
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 128) {
      setNetworkError("Concurrency must be an integer between 1 and 128.");
      setNetworkStatus("error");
      return;
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 60_000) {
      setNetworkError("Timeout must be an integer between 50 and 60000 milliseconds.");
      setNetworkStatus("error");
      return;
    }
    if (!IS_TAURI) {
      setNetworkError("Network diagnostics require the desktop runtime.");
      setNetworkStatus("error");
      return;
    }
    networkScanIdRef.current = null;
    setNetworkScanId(null);
    setNetworkScanResults([]);
    setNetworkScanScanned(0);
    setNetworkScanTotal(0);
    setNetworkScanStatus("running");
    setNetworkError(null);
    try {
      const response = await invoke<{ scanId: string }>("network_scan_start", {
        request: { host, startPort, endPort, concurrency, timeoutMs, protocol: networkScanProtocol },
      });
      if (!networkScanIdRef.current) {
        networkScanIdRef.current = response.scanId;
        setNetworkScanId(response.scanId);
      }
    } catch (error) {
      networkScanIdRef.current = null;
      setNetworkScanId(null);
      setNetworkScanStatus("failed");
      setNetworkError(String(error));
    }
  }, [networkHost, networkScanConcurrency, networkScanEnd, networkScanStart, networkTimeout, networkScanProtocol]);

  const cancelNetworkScan = useCallback(async () => {
    const scanId = networkScanIdRef.current ?? networkScanId;
    if (!scanId || !IS_TAURI) return;
    try {
      await invoke("network_scan_cancel", { scanId });
    } catch (error) {
      setNetworkError(`Scan cancellation failed: ${String(error)}`);
    }
  }, [networkScanId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!IS_TAURI) return;
    let disposed = false;
    void invoke<{ version: string }>("app_snapshot").then(({ version }) => {
      if (!disposed) setAppVersion(version);
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!IS_TAURI) return;
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    void listen<SshTunnelEvent>("ssh://tunnel", (event) => {
      setTunnels((current) => {
        const next = current.filter((tunnel) => tunnel.tunnelId !== event.payload.tunnelId);
        return retainOperationHistory([...next, event.payload], (tunnel) => ["stopped", "failed"].includes(tunnel.state), 20);
      });
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch((error) => {
      if (!disposed) setConnectionError(`SSH tunnel updates are unavailable: ${String(error)}`);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!IS_TAURI) return;
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    void listen<NetworkScanEvent>("network://scan", (event) => {
      const payload = event.payload;
      if (networkScanIdRef.current && payload.scanId !== networkScanIdRef.current) return;
      if (!networkScanIdRef.current) {
        networkScanIdRef.current = payload.scanId;
        setNetworkScanId(payload.scanId);
      }
      setNetworkScanScanned(payload.scanned);
      setNetworkScanTotal(payload.total);
      if (payload.results.length > 0) {
        setNetworkScanResults(current => mergeScanResults(current, payload.results));
      }
      if (payload.state === "running") setNetworkScanStatus("running");
      if (payload.state === "completed") setNetworkScanStatus("completed");
      if (payload.state === "cancelled") setNetworkScanStatus("cancelled");
      if (payload.state === "failed") {
        setNetworkScanStatus("failed");
        setNetworkError(payload.error ?? "Network scan failed.");
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch((error) => {
      if (!disposed) {
        setNetworkScanStatus("failed");
        setNetworkError(`Network scan updates are unavailable: ${String(error)}`);
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!IS_TAURI) return;
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    void listen<NetworkDiagnosticEvent>("network://diagnostic", (event) => {
      const payload = event.payload;
      if (!acceptNetworkDiagnosticEvent(networkDiagnosticRunRef.current, payload.operationId, payload.state !== "running")) return;
      if (payload.state === "running") {
        const cancelId = takePendingNetworkDiagnosticCancel(networkDiagnosticRunRef.current);
        if (cancelId) void cancelNetworkDiagnosticId(cancelId);
      }
      setNetworkDiagnosticKind(payload.kind);
      setNetworkDiagnosticStatus(payload.state);
      if (payload.ping) setNetworkPingResult(payload.ping);
      if (payload.traceroute) setNetworkMtrResult(payload.traceroute);
      if (payload.state === "failed") setNetworkError(payload.error ?? "Network diagnostic failed.");
      if (payload.state === "cancelled") setNetworkError(null);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch((error) => {
      if (!disposed) {
        setNetworkDiagnosticStatus("failed");
        setNetworkError(`Network diagnostic updates are unavailable: ${String(error)}`);
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [cancelNetworkDiagnosticId]);

  useEffect(() => {
    refreshSavedSessions();
  }, [refreshSavedSessions]);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  useEffect(() => {
    refreshPortableVaultStatus();
  }, [refreshPortableVaultStatus]);

  useEffect(() => {
    refreshSnippets();
  }, [refreshSnippets]);

  useEffect(() => {
    refreshMacros();
  }, [refreshMacros]);

  useEffect(() => {
    refreshAudit();
  }, [refreshAudit]);

  const remoteBrowserVisible = activeView === "files" || (sidebarOpen && sidebarMode === "files");
  useEffect(() => {
    if (remoteBrowserVisible && remoteSessionId && remoteProtocol === "ssh") void loadRemoteDirectory(".");
  }, [remoteBrowserVisible, loadRemoteDirectory, remoteProtocol, remoteSessionId]);

  useEffect(() => {
    setRemoteMonitor(null);
    setRemoteMonitorStatus("idle");
    setRemoteMonitorError(null);
    setRemoteMonitorLive(false);
  }, [remoteSessionId]);

  useEffect(() => {
    if (activeView === "monitor" && remoteSessionId && remoteProtocol === "ssh" && remoteMonitorStatus === "idle") {
      void collectRemoteMonitor();
    }
  }, [activeView, collectRemoteMonitor, remoteMonitorStatus, remoteProtocol, remoteSessionId]);

  useEffect(() => {
    if (!remoteMonitorLive || activeView !== "monitor" || !remoteSessionId || remoteProtocol !== "ssh") return;
    let disposed = false;
    let timer: number | undefined;
    const generation = ++remoteMonitorGenerationRef.current;

    const refresh = async () => {
      if (disposed) return;
      await collectRemoteMonitor();
      if (!disposed && generation === remoteMonitorGenerationRef.current) {
        timer = window.setTimeout(refresh, remoteMonitorIntervalSeconds * 1000);
      }
    };

    void refresh();
    return () => {
      disposed = true;
      remoteMonitorGenerationRef.current += 1;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeView, collectRemoteMonitor, remoteMonitorIntervalSeconds, remoteMonitorLive, remoteProtocol, remoteSessionId]);

  useEffect(() => {
    if (!IS_TAURI) return;
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    void listen("app://closing", () => {
      macroCancelRef.current = true;
      broadcastEnabledRef.current = false;
      macroRecordingRef.current = null;
      setBroadcastEnabled(false);
      setMacroRecording(null);
      setRemoteMonitorLive(false);
      setClosing(true);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch((error) => {
      if (!disposed) setConnectionError(`Shutdown status updates are unavailable: ${String(error)}`);
    });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    if (!IS_TAURI) return;
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    void listen<SshTransferEvent>("sftp://transfer", (event) => {
      const payload = event.payload;
      const previousState = transferAuditStateRef.current.get(payload.transferId);
      transferAuditStateRef.current.set(payload.transferId, payload.state);
      if (transferAuditStateRef.current.size > 256) {
        const oldest = transferAuditStateRef.current.keys().next().value;
        if (oldest) transferAuditStateRef.current.delete(oldest);
      }
      if (previousState !== payload.state && payload.state === "completed") recordAudit("transferCompleted", payload.protocol.toUpperCase());
      if (previousState !== payload.state && payload.state === "failed") recordAudit("transferFailed", payload.protocol.toUpperCase());
      setTransfers((current) => {
        const next = current.filter((transfer) => transfer.transferId !== payload.transferId);
        return retainOperationHistory([...next, payload], (transfer) => ["completed", "cancelled", "failed"].includes(transfer.state), 40);
      });
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch((error) => {
      if (!disposed) setConnectionError(`Transfer updates are unavailable: ${String(error)}`);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [recordAudit]);

  useEffect(() => {
    if (closing) return;
    // Capture emergency keys before xterm and modal inputs stop propagation.
    const isEmergency = (event: KeyboardEvent) => event.key === "Escape" || matchesShortcut(event, settings.keyboard.emergencyBroadcastDisable);
    const onEmergencyKeyDown = (event: KeyboardEvent) => {
      if (isWorkspaceLocked()) return;
      if (!isEmergency(event)) return;
      const activeExecution = broadcastEnabledRef.current || macroRunRef.current || macroRecordingRef.current;
      if (terminalSearchOpen) closeTerminalSearch();
      setPaletteOpen(false);
      if (macroRunRef.current) {
        macroCancelRef.current = true;
        cancelMacro();
      }
      if (macroRecordingRef.current) stopMacroRecording();
      if (broadcastEnabledRef.current) {
        broadcastEnabledRef.current = false;
        setBroadcastEnabled(false);
        setBroadcastOpen(false);
        setSessionNotice("Broadcast mode disabled. No further input will fan out.");
      }
      if (activeExecution) {
        // Escape must retain the browser's default modal cancellation. With no
        // active execution, let it reach the local shell/editor normally.
        if (event.key !== "Escape") event.preventDefault();
        event.stopPropagation();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isWorkspaceLocked()) return;
      if (isEmergency(event)) return;
      if (editingRemoteFile) {
        if (matchesShortcut(event, settings.keyboard.closeTab)) event.preventDefault();
        return;
      }
      const terminalTarget = event.target instanceof HTMLElement && Boolean(event.target.closest(".xterm"));
      if (isEditableKeyboardTarget(event.target) && !terminalTarget) return;
      if (terminalTarget && (event.metaKey || event.ctrlKey) && !event.altKey) {
        if (event.key === "=" || event.key === "+") {
          event.preventDefault();
          adjustTerminalFontSize("increase");
          return;
        }
        if (event.key === "-") {
          event.preventDefault();
          adjustTerminalFontSize("decrease");
          return;
        }
        if (event.key === "0") {
          event.preventDefault();
          adjustTerminalFontSize("reset");
          return;
        }
      }
      if (matchesShortcut(event, settings.keyboard.newTerminal)) {
        event.preventDefault();
        startNewTerminal();
      }
      if (matchesShortcut(event, settings.keyboard.closeTab)) {
        event.preventDefault();
        closeTerminal(selectedTerminalId);
      }
      if (matchesShortcut(event, settings.keyboard.nextTab)) {
        event.preventDefault();
        cycleTerminal(1);
      }
      if (matchesShortcut(event, settings.keyboard.previousTab)) {
        event.preventDefault();
        cycleTerminal(-1);
      }
      if (matchesShortcut(event, settings.keyboard.quickConnect)) {
        event.preventDefault();
        setQuickConnectOpen(true);
      }
      if (matchesShortcut(event, settings.keyboard.commandPalette)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (matchesShortcut(event, settings.keyboard.openMacros)) {
        event.preventDefault();
        setMacrosOpen(true);
      }
      if (matchesShortcut(event, settings.keyboard.toggleSidebar)) {
        event.preventDefault();
        setSidebarOpen((open) => !open);
      }
      if (matchesShortcut(event, settings.keyboard.splitRight)) {
        event.preventDefault();
        openSplit("right");
      }
      if (matchesShortcut(event, settings.keyboard.splitDown)) {
        event.preventDefault();
        openSplit("down");
      }
      if (matchesShortcut(event, settings.keyboard.focusPane)) {
        event.preventDefault();
        focusPane();
      }
    };
    window.addEventListener("keydown", onEmergencyKeyDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onEmergencyKeyDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [adjustTerminalFontSize, broadcastEnabled, cancelMacro, closing, closeTerminal, closeTerminalSearch, cycleTerminal, editingRemoteFile, focusPane, macroRecording, macroRun, openSplit, selectedTerminalId, settings.keyboard, startNewTerminal, stopMacroRecording, terminalSearchOpen, setPaletteOpen, setBroadcastOpen, setQuickConnectOpen, setMacrosOpen]);

  const filteredSessions = sessionRows.filter((session) => {
    const matchesSearch = `${session.name} ${session.folder} ${session.detail} ${session.type} ${session.tags.join(" ")}`.toLowerCase().includes(search.trim().toLowerCase());
    return matchesSearch && (!favoritesOnly || session.favorite) && (!recentOnly || (session.type !== "LOCAL" && Number.isFinite(session.lastUsedAt) && (session.lastUsedAt ?? 0) > 0));
  }).sort((first, second) => (recentOnly ? (second.lastUsedAt ?? 0) - (first.lastUsedAt ?? 0) : 0) || first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: "base" }));
  function selectSessionSidebar(section: "all" | "favorites" | "recent") {
    const sameSection = sidebarMode === "sessions" && favoritesOnly === (section === "favorites") && recentOnly === (section === "recent");
    setSidebarOpen(open => document.documentElement.classList.contains("android") && sameSection ? !open : true);
    setSidebarMode("sessions");
    setFavoritesOnly(section === "favorites");
    setRecentOnly(section === "recent");
  }
  function selectSidebarPanel(mode: "notes" | "shortcuts" | "files") {
    setSidebarOpen(open => IS_ANDROID && sidebarMode === mode ? !open : true);
    setSidebarMode(mode);
  }
  function renderSidebarSession(session: SessionListItem) {
    return (<SessionRow key={session.id ?? session.name} {...session} appearance={session.id ? hostStyles[session.id] : undefined} onCustomize={session.id ? () => { const saved = savedSessions.find(item => item.id === session.id); if (saved) setCustomizingHost(saved); } : undefined} onDragStart={session.id ? () => draggedSessionId.current = session.id! : undefined} onDragEnd={() => { draggedSessionId.current = null; setSessionDropTarget(null); }} onDragMove={setSessionDropTarget} onDrop={folder => void dropSessionInFolder(folder)} connecting={pendingSavedSession?.id === session.id} disabled={session.type !== "LOCAL" && pendingSavedSession !== null} onSelect={() => {
                    const saved = savedSessions.find((item) => item.id === session.id);
                    if (saved) { if (saved.protocol === "LOCAL") openSavedLocalSession(saved); else void connectSavedSession(saved); }
                  }} onEdit={session.id ? () => {
                    const saved = savedSessions.find((item) => item.id === session.id);
                    if (saved) setEditingSession(saved);
                  } : undefined} onDelete={session.id ? () => {
                    const saved = savedSessions.find((item) => item.id === session.id);
                    if (saved) void deleteSavedSession(saved);
                  } : undefined} onToggleFavorite={() => void toggleFavorite(session)} />);
  }
  const sessionGroups: Array<[string, SessionListItem[]]> = favoritesOnly || recentOnly
    ? [["", filteredSessions]]
    : groupSessionsByFolder(filteredSessions, createdSessionFolders);
  const firstMatchingSession = sessionGroups.find(([, sessions]) => sessions.length > 0)?.[1][0];
  const activeTransferCount = transfers.filter((transfer) => !["completed", "cancelled", "failed"].includes(transfer.state)).length;
  const activeTunnelCount = tunnels.filter((tunnel) => !["stopped", "failed"].includes(tunnel.state)).length;

  const renderTerminalPane = useCallback((terminal: WorkspaceTerminal) => {
    const isDesktop = (terminal.remoteProtocol === "rdp" || terminal.remoteProtocol === "vnc") && terminal.remoteDesktopRequest;
    const viewport = terminal.connecting ? null : isDesktop ? <RemoteDesktopViewport workspaceId={terminal.id} instanceKey={terminal.instanceKey} request={terminal.remoteDesktopRequest!} onStatusChange={handleTerminalStatus} onNativeTerminalId={handleNativeTerminalId} /> : <TerminalViewport label={terminal.label} colorTheme={colorTheme} workspaceId={terminal.id} instanceKey={terminal.instanceKey} remoteSessionId={terminal.remoteSessionId} remoteProtocol={terminal.remoteProtocol} localTarget={terminal.localTarget} terminalAppearance={settings.terminal} fontSize={settings.appearance.fontSize} scrollbackLines={settings.terminal.scrollbackLines} cursorBlink={settings.terminal.cursorBlink} copyOnSelect={settings.terminal.copyOnSelect} confirmMultilinePaste={settings.general.confirmMultilinePaste} rightClickToPaste={settings.general.rightClickToPaste} onStatusChange={handleTerminalStatus} onNativeTerminalId={handleNativeTerminalId} onInput={handleTerminalInput} onTerminalPaste={handleTerminalPaste} onSaveSelectionShortcut={saveSelectionShortcut} onBranchSession={branchSession} onTerminalReady={handleTerminalReady} onTerminalDisposed={handleTerminalDisposed} onSearchResults={handleSearchResults} onTitleChange={handleTerminalTitle} />;
    return <div className="terminal-login-container">{viewport}{terminal.authentication && <TerminalSshLogin authentication={terminal.authentication} connecting={terminal.connecting ?? false} label={terminal.label} colorTheme={colorTheme} terminalAppearance={settings.terminal} fontSize={settings.appearance.fontSize} />}</div>;
  }, [colorTheme, saveSelectionShortcut, branchSession, handleTerminalPaste, handleNativeTerminalId, handleSearchResults, handleTerminalDisposed, handleTerminalInput, handleTerminalReady, handleTerminalStatus, handleTerminalTitle, settings.appearance.fontSize, settings.general.confirmMultilinePaste, settings.general.rightClickToPaste, settings.terminal]);

  if (closing) return <main className={`app-shell shutdown-state theme-${colorTheme}`}><section role="status" aria-live="polite"><LoaderCircle className="spin" size={24} aria-hidden="true" /><h1>Closing Conxol</h1><p>Closing local terminals and finishing SSH file cleanup before exiting.</p></section></main>;

  return (
    <main style={{ "--terminal-surface": terminalSurface(colorTheme, settings.terminal) } as React.CSSProperties} className={`app-shell ${sidebarOpen ? "" : "sidebar-collapsed"} theme-${colorTheme}`}>
      {fileTransferOpen && <FileTransferClient onClose={() => setFileTransferOpen(false)} onServerRunning={setTftpServerRunning} initialServer={tftpServerRunning} />}
      {syntaxSettingsOpen && <SyntaxHighlightSettings onClose={() => setSyntaxSettingsOpen(false)} />}
      {pptpManagerOpen && <PptpManager onClose={() => setPptpManagerOpen(false)} />}
      <ApplicationMenuBar>
        <details name="desktop-menu"><summary>Sessions</summary><div className="desktop-menu">
          <button onClick={() => setQuickConnectOpen(true)}>New session…</button>
          <hr />
          <button onClick={() => { setSidebarOpen(true); setSidebarMode("sessions"); setFavoritesOnly(false); setRecentOnly(false); }}>All sessions</button>
          <button onClick={() => { setSidebarOpen(true); setSidebarMode("sessions"); setFavoritesOnly(true); setRecentOnly(false); }}>Favorites</button>
          <button onClick={() => { setSidebarOpen(true); setSidebarMode("sessions"); setFavoritesOnly(false); setRecentOnly(true); }}>Recent sessions</button>
          <hr />
          <button onClick={importOpenSshConfig}>Import OpenSSH config…</button>
        </div></details>
        <button onClick={() => setActiveView("generator")}>Generator</button>
        <button onClick={() => setMacrosOpen(true)}>Macros</button>
        <button title="Double Shift" onClick={() => { setShortcutSelectionDraft(null); setShortcutsOpen(true); }}>Shortcuts</button>
        <button onClick={() => setNotesOpen(true)}>Notes</button>
        <button onClick={openSettings}>Settings</button>
        <details name="desktop-menu"><summary>Tools</summary><div className="desktop-menu">
          <button onClick={() => setActiveView("files")}>Remote files</button>
          <button onClick={() => setFileTransferOpen(true)}>FTP / TFTP…</button>
          <button onClick={() => setPptpManagerOpen(true)}>PPTP manager…</button>
          <button onClick={() => setDiagnosticsOpen(true)}>Network diagnostics</button>
          <button onClick={() => setActiveView("tunnels")}>SSH tunnels</button>
          <button onClick={() => setActiveView("transfers")}>Transfers</button>
          <button onClick={() => setActiveView("audit")}>Audit history</button>
          <hr />
          <button onClick={() => setSyntaxSettingsOpen(true)}>Syntax highlighting…</button>
          <button onClick={() => setSnippetsOpen(true)}>Snippets…</button>
          <hr />
          <button onClick={() => setCredentialsOpen(true)}>Credential vault…</button>
          <button onClick={() => setPaletteOpen(true)}>Command palette…</button>
        </div></details>
        <details name="desktop-menu"><summary>Help</summary><div className="desktop-menu">
          <button onClick={() => setHelpOpen(true)}>Help topics…</button>
          <button onClick={() => setAboutOpen(true)}>About</button>
          {storeUpdates.menuItem}
        </div></details>
        {activeView === "terminal" && !!selectedTerminalId && remoteProtocol !== "rdp" && remoteProtocol !== "vnc" && (terminalSearchOpen || settings.general.alwaysShowTerminalSearch) && <div className="terminal-search-bar" role="search"><Search size={14} /><input ref={terminalSearchInputRef} value={terminalSearchQuery} onChange={(event) => updateTerminalSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeTerminalSearch(); } if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "Enter" || (!event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")))) { event.preventDefault(); event.stopPropagation(); findTerminalMatch(event.key === "ArrowUp" || (event.key === "Enter" && event.shiftKey) ? "previous" : "next"); } }} title="Up: previous match · Down: next match · Enter: next · Shift+Enter: previous" placeholder="Find in terminal" aria-label="Find in terminal" /><span>{terminalSearchResult.resultCount > 0 ? `${terminalSearchResult.resultIndex + 1}/${terminalSearchResult.resultCount}` : terminalSearchQuery ? "No match" : "Search"}</span><label><input type="checkbox" checked={terminalSearchCaseSensitive} onChange={(event) => setTerminalSearchCaseSensitive(event.target.checked)} /> Aa</label><button type="button" aria-label="Previous terminal match" title="Previous match (↑)" onClick={() => findTerminalMatch("previous")} disabled={!terminalSearchQuery}><ArrowUpFromLine size={13} /></button><button type="button" aria-label="Next terminal match" title="Next match (↓)" onClick={() => findTerminalMatch("next")} disabled={!terminalSearchQuery}><ArrowDownToLine size={13} /></button><button type="button" aria-label="Close terminal search" title="Close search" onClick={closeTerminalSearch}><X size={14} /></button></div>}
        <div className="desktop-menu-end">{tftpServerRunning && <button className="tftp-server-indicator" onClick={() => setFileTransferOpen(true)} title="TFTP server is running. Open to stop sharing.">TFTP serving</button>}{workspaceSecurity.status?.enabled && <button aria-label="Lock workspace" title="Lock workspace" onClick={() => void workspaceSecurity.lock()}><LockKeyhole size={14} strokeWidth={1.5} /></button>}<span className="desktop-menu-status" title={IS_TAURI ? "Desktop runtime" : "Browser preview"}><span className="live-dot" /> Conxol</span></div>
      </ApplicationMenuBar>

      <div className="app-body">
        <nav className="session-activity-strip" aria-label="Sidebar tools">
          <button className="activity-sessions" title="User sessions" aria-label="User sessions" aria-pressed={sidebarOpen && sidebarMode === "sessions" && !favoritesOnly && !recentOnly} aria-controls="session-sidebar" aria-expanded={sidebarOpen && sidebarMode === "sessions" && !favoritesOnly && !recentOnly} onClick={() => selectSessionSidebar("all")}><List size={16} strokeWidth={1.5} /></button>
          <button className="activity-favorites" title="Favorite sessions" aria-label="Favorite sessions" aria-pressed={sidebarOpen && sidebarMode === "sessions" && favoritesOnly && !recentOnly} aria-controls="session-sidebar" aria-expanded={sidebarOpen && sidebarMode === "sessions" && favoritesOnly && !recentOnly} onClick={() => selectSessionSidebar("favorites")}><Star size={16} strokeWidth={1.5} /></button>
          <button className="activity-recent" title="Recent devices" aria-label="Recent devices" aria-pressed={sidebarOpen && sidebarMode === "sessions" && recentOnly} aria-controls="session-sidebar" aria-expanded={sidebarOpen && sidebarMode === "sessions" && recentOnly} onClick={() => selectSessionSidebar("recent")}><History size={16} strokeWidth={1.5} /></button>
          <button className="activity-shortcuts" title="Device shortcuts" aria-label="Device shortcuts" aria-pressed={sidebarOpen && sidebarMode === "shortcuts"} aria-expanded={sidebarOpen && sidebarMode === "shortcuts"} aria-controls="session-sidebar" onClick={() => { setShortcutSelectionDraft(null); selectSidebarPanel("shortcuts"); }}><Command size={16} strokeWidth={1.5} /></button>
          <button className="activity-network" title="Network diagnostics" aria-label="Network diagnostics" aria-pressed={diagnosticsOpen} onClick={() => setDiagnosticsOpen(true)}><Activity size={16} strokeWidth={1.5} /></button>
          <button className="activity-notes" title="Notes" aria-label="Notes" aria-pressed={notesOpen} aria-expanded={notesOpen} aria-controls="session-sidebar" onClick={() => selectSidebarPanel("notes")}><FileText size={16} strokeWidth={1.5} /></button>
          {remoteSessionId && remoteProtocol === "ssh" && terminalStatus === "connected" && sftpAvailabilityRef.current.get(remoteSessionId) === true && <button className="activity-files" title="Remote files" aria-label="Remote files" aria-pressed={sidebarOpen && sidebarMode === "files"} aria-expanded={sidebarOpen && sidebarMode === "files"} aria-controls="session-sidebar" onClick={() => selectSidebarPanel("files")}><FolderInput size={16} strokeWidth={1.5} /></button>}
          <button className="activity-collapse" title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"} aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"} aria-expanded={sidebarOpen} aria-controls="session-sidebar" onClick={() => setSidebarOpen((open) => !open)}>{sidebarOpen ? <ChevronLeft size={16} strokeWidth={1.5} /> : <ChevronRight size={16} strokeWidth={1.5} />}</button>
          <button className="activity-settings" title="Settings" aria-label="Settings" aria-pressed={settingsOpen} onClick={openSettings}><Settings2 size={16} strokeWidth={1.5} /></button>
        </nav>
        {IS_ANDROID && sidebarOpen && <button type="button" className="android-sidebar-backdrop" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}
        <aside className="sidebar" id="session-sidebar" style={{ flexBasis: sidebarOpen ? sidebarSize : 0 }}>
          <div className="sidebar-toolbar">
            <button className="sidebar-toggle" onClick={() => setSidebarOpen(false)} aria-label="Collapse sidebar">
              <PanelLeftClose size={16} />
            </button>
            <button className="new-button" onClick={() => startNewTerminal()}>
              <Plus size={15} strokeWidth={2.4} />
              <span>New terminal</span>
              <span className="shortcut">{formatShortcut(settings.keyboard.newTerminal)}</span>
            </button>
            <button className="icon-button new-terminal-menu-button" onClick={openWslTerminalPicker} aria-label="New WSL terminal" title="New WSL terminal">
              <MoreHorizontal size={15} />
            </button>
          </div>

          {sidebarMode !== "shortcuts" && sidebarMode !== "notes" && <label className="search-box">
            <Search size={15} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Quick connect / find session…" aria-label="Find session" onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); if (event.repeat) return; const saved = savedSessions.find((item) => item.id === firstMatchingSession?.id); if (saved) { if (saved.protocol === "LOCAL") openSavedLocalSession(saved); else void connectSavedSession(saved); } else if (!search.trim()) setQuickConnectOpen(true); } }} />
            <span className="search-key">{formatShortcut(settings.keyboard.quickConnect)}</span>
          </label>}

          <nav className="sidebar-nav" aria-label="Workspace navigation">
            <div className="nav-section-label">Workspace</div>
            <button className={`nav-item ${!favoritesOnly && !recentOnly ? "active" : ""}`} onClick={() => { setFavoritesOnly(false); setRecentOnly(false); }}><LayoutDashboard size={15} /> Overview <span className="nav-count">{sessionRows.length}</span></button>
            <button className={`nav-item ${favoritesOnly && !recentOnly ? "active" : ""}`} onClick={() => { setFavoritesOnly(true); setRecentOnly(false); }}><Star size={15} /> Favorites <span className="nav-count">{sessionRows.filter((session) => session.favorite).length}</span></button>
            <button className={`nav-item ${recentOnly ? "active" : ""}`} onClick={() => { setFavoritesOnly(false); setRecentOnly(true); }}><Activity size={15} /> Recent <span className="nav-count">{sessionRows.filter((session) => session.lastUsedAt != null).length}</span></button>
          </nav>

          <div className="sidebar-notes-panel" hidden={sidebarMode !== "notes"}>
            <NotesModal onClose={() => { setNotesOpen(false); requestTerminalFocus(selectedTerminalId); }} />
          </div>
      {sidebarMode === "notes" ? null : sidebarMode === "shortcuts" ? <ShortcutCenter key={`${activeTerminal?.shortcutDeviceId ?? "shared"}:${shortcutSelectionDraft?.id ?? "search"}`} initialDraft={shortcutSelectionDraft ?? undefined} shortcuts={snippets.filter(isCommandShortcut)}
        device={activeTerminal?.shortcutDeviceId ? { id: activeTerminal.shortcutDeviceId, name: activeTerminal.customName ?? activeTerminal.label } : null}
        devices={savedSessions.filter(session => !["RDP", "VNC"].includes(session.protocol)).map(session => ({ id: session.id, name: session.name }))}
        target={activeTerminal?.status === "connected" ? activeTerminal.label : null}
        disabledReason={!activeTerminal || activeTerminal.status !== "connected" || activeTerminal.remoteProtocol === "rdp" || activeTerminal.remoteProtocol === "vnc" ? "Select a connected text terminal to paste a shortcut." : broadcastEnabled || macroRun || macroRecording ? "Stop broadcast, recording, or the running macro to paste." : ""}
        onSave={saveCommandShortcut} onDelete={deleteCommandShortcut} onPaste={pasteShortcut} /> : sidebarMode === "files" ? <div className="sidebar-file-browser">
            {remoteSessionId && remoteProtocol === "ssh" ? <>
              <div className="sidebar-path"><Folder size={12} /><span title={remotePath}>{remotePath}</span><button aria-label="Refresh remote files" title="Refresh" disabled={sftpStatus === "loading"} onClick={() => navigateRemote(remotePath)}><RefreshCw size={12} /></button></div>
<RemoteFilesView entries={remoteListingSessionId === remoteSessionId && sftpStatus === "ready" ? remoteEntries : []} path={remoteListingSessionId === remoteSessionId ? remotePath : "."} status={remoteListingSessionId === remoteSessionId ? sftpStatus : "loading"} error={connectionError ?? (remoteListingSessionId === remoteSessionId ? remoteDirectoryError : null)} localDropActive={localDropActive} transfers={transfers.filter((transfer) => transfer.terminalId === remoteSessionId)} onOpenTerminal={() => setActiveView("terminal")} onNavigate={navigateRemote} onDownload={startDownload} onUpload={startUpload} onCreateDirectory={createRemoteDirectory} onRename={renameRemote} onDelete={deleteRemote} onSetPermissions={setRemotePermissions} onCopyPath={copyRemotePath} onEdit={openRemoteTextFile} onCancelTransfer={cancelTransfer} onRetryTransfer={retryTransfer} />
              <button className="sidebar-monitor" disabled={terminalStatus !== "connected"} onClick={() => setActiveView("monitor")}><Gauge size={13} /> Remote monitoring</button>
            </> : <div className="sidebar-file-empty"><Folder size={22} /><p>Open an SSH session to browse remote files.</p><button className="outline-button" onClick={() => setQuickConnectOpen(true)}>New session</button></div>}
          </div> : <>
          <div className={`session-list ${sessionDropTarget === "" ? "session-drop-target" : ""}`} data-session-folder="">
            <div className="list-heading"><span>{recentOnly ? "Recent devices" : favoritesOnly ? "Favorite sessions" : "User sessions"}</span><span className="list-actions"><button aria-label="Import OpenSSH config" title="Import OpenSSH config" onClick={importOpenSshConfig}><Upload size={14} /></button><button aria-label="Import Conxol session export" title="Import Conxol session export" onClick={importSessions}><ArrowDownToLine size={14} /></button><button aria-label="Export Conxol sessions" title="Export secret-free session definitions" onClick={exportSessions}><ArrowUpFromLine size={14} /></button></span></div>
            {sessionListError && <div className="connect-error" role="alert"><span>{sessionListError}</span><button type="button" className="outline-button" onClick={refreshSavedSessions}>Retry</button></div>}
            {!favoritesOnly && !recentOnly && <div className="session-folder-controls"><button type="button" title="Expand all folders" aria-label="Expand all folders" onClick={() => expandSessionFolders(true)}><ChevronsUpDown size={14} /></button><button type="button" title="Collapse all folders" aria-label="Collapse all folders" onClick={() => expandSessionFolders(false)}><ChevronsDownUp size={14} /></button><button type="button" title="Create folder" aria-label="Create folder" onClick={() => void createSessionFolder()}><FolderPlus size={14} /></button></div>}
            {(() => {
              const renderGroup = ([folder, sessions]: [string, SessionListItem[]]): ReactNode => {
              const children = folder ? sessionGroups.filter(([path]) => path && sessionFolderParent(path) === folder) : [];
              const folderHasHosts = sessionRows.some(session => sessionFolderWithin(session.folder.trim(), folder)) || createdSessionFolders.some(path => path !== folder && sessionFolderWithin(path, folder));
              const rows = sessions.map(renderSidebarSession);
              return folder ? (
                <details key={folder} className={`session-folder-group ${sessionDropTarget === folder ? "session-drop-target" : ""}`} data-session-folder={folder} open={search.trim() ? true : (sessionFolderState[`folder:${folder}`] ?? true)} onToggle={event => { if (event.target === event.currentTarget && !search.trim()) changeSessionFolder(`folder:${folder}`, event.currentTarget.open); }}>
                  <summary className="folder-heading session-folder-heading" title={`${folder} · Drag onto a folder to nest, or onto User sessions to move to the root`}
                    onPointerDown={event => {
                      if (event.button !== 0 || (event.target as HTMLElement).closest("button") || folderMoveInProgress.current || isWorkspaceLocked()) return;
                      suppressFolderClick.current = false;
                      folderDrag.current = { folder, x: event.clientX, y: event.clientY, active: false };
                    }}
                    onPointerMove={event => {
                      const drag = folderDrag.current;
                      if (!drag || drag.folder !== folder || !(event.buttons & 1)) return;
                      if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 6) {
                        drag.active = true;
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }
                      if (drag.active) { event.preventDefault(); setSessionDropTarget(folderDropAt(event.clientX, event.clientY)); }
                    }}
                    onPointerUp={event => {
                      const drag = folderDrag.current;
                      if (drag?.active && drag.folder === folder) {
                        suppressFolderClick.current = true;
                        const parent = folderDropAt(event.clientX, event.clientY);
                        if (parent !== null) void dropFolder(folder, parent);
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                      }
                      folderDrag.current = null;
                      setSessionDropTarget(null);
                    }}
                    onPointerCancel={() => { folderDrag.current = null; setSessionDropTarget(null); }}
                    onLostPointerCapture={() => { folderDrag.current = null; setSessionDropTarget(null); }}
                    onClickCapture={event => { if (suppressFolderClick.current) { event.preventDefault(); event.stopPropagation(); suppressFolderClick.current = false; } }}
                    onContextMenu={event => {
                    event.preventDefault(); event.stopPropagation();
                    setFolderContextMenu({ folder, x: event.clientX, y: event.clientY });
                  }} onKeyDown={event => {
                    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setFolderContextMenu({ folder, x: rect.left, y: rect.bottom });
                    }
                  }}><ChevronDown size={11} /><SessionFolderIcon appearance={folderStyles[folder]} /> {folder.slice(folder.lastIndexOf("/") + 1)} <span>{filteredSessions.filter(session => sessionFolderWithin(session.folder.trim(), folder)).length}</span><button type="button" className="session-folder-edit" aria-label={`Customize folder ${folder}`} title="Customize folder" onClick={event => { event.preventDefault(); event.stopPropagation(); setCustomizingFolder(folder); }}><Pencil size={12} /></button>{!folderHasHosts && <button type="button" className="session-folder-delete" aria-label={`Delete folder ${folder}`} title="Delete folder (keep sessions)" disabled={deletingFolder !== null} onClick={event => { event.preventDefault(); event.stopPropagation(); void deleteSessionFolder(folder); }}><Trash2 size={12} /></button>}</summary>
                  {children.map(renderGroup)}
                  {rows}
                </details>
              ) : <div key="unfiled">{rows}</div>;
              };
              return sessionGroups.filter(([path]) => !sessionFolderParent(path)).map(renderGroup);
            })()}
            {filteredSessions.length === 0 && <div className="empty-search">No matching sessions</div>}
          </div>
          </>}

          <div className="sidebar-footer">
            <div className="security-note"><ShieldCheck size={15} /><span><strong>Saved secrets stay native</strong><small>Vault boundary is Rust-owned</small></span></div>
            <button className={`nav-item ${diagnosticsOpen ? "active" : ""}`} onClick={() => setDiagnosticsOpen(true)}><Activity size={15} /> Network diagnostics</button>
            <button className="nav-item" onClick={() => setActiveView("tunnels")}><Network size={15} /> Tunnel manager <span className="nav-count">{activeTunnelCount}</span></button>
            <button className={`nav-item ${activeView === "monitor" ? "active" : ""}`} onClick={() => setActiveView("monitor")} disabled={!remoteSessionId || remoteProtocol !== "ssh"} title={remoteSessionId && remoteProtocol === "ssh" ? "Collect a one-shot SSH system snapshot" : "Open an SSH session first"}><Gauge size={15} /> Remote monitor</button>
            <button className={`nav-item ${activeView === "transfers" ? "active" : ""}`} onClick={() => setActiveView("transfers")}><ArrowDownToLine size={15} /> Transfers <span className="nav-count">{activeTransferCount}</span></button>
            <button className={`nav-item ${activeView === "audit" ? "active" : ""}`} onClick={() => setActiveView("audit")}><History size={15} /> Audit history <span className="nav-count">{auditEvents.length}</span></button>
          </div>
        </aside>

        {sidebarOpen && <div className="sidebar-divider" role="separator" aria-label="Resize session sidebar" aria-controls="session-sidebar" aria-orientation="vertical" aria-valuemin={140} aria-valuemax={Math.max(140, window.innerWidth - 390)} aria-valuenow={sidebarSize} tabIndex={0}
          onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); sidebarDrag.current = { x: event.clientX, width: sidebarSize }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={(event) => { const drag = sidebarDrag.current; if (drag && event.currentTarget.hasPointerCapture(event.pointerId)) setSidebarSize(sidebarWidth(drag.width + event.clientX - drag.x, window.innerWidth)); }}
          onPointerUp={(event) => { sidebarDrag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onLostPointerCapture={() => { sidebarDrag.current = null; }} onPointerCancel={() => { sidebarDrag.current = null; }}
          onDoubleClick={() => setSidebarSize(DEFAULT_SIDEBAR_WIDTH)}
          onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setSidebarSize((width) => sidebarWidth(width + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 50 : 10), window.innerWidth)); } else if (event.key === "Home") { event.preventDefault(); setSidebarSize(DEFAULT_SIDEBAR_WIDTH); } }} />}
        <section className="workspace">
          {!sidebarOpen && <button className="floating-sidebar-button" onClick={() => setSidebarOpen(true)} aria-label="Expand sidebar"><PanelLeftClose size={16} /></button>}
          <div className="workspace-heading">
            <div>
              <div className="eyebrow"><span>WORKSPACE / 01</span><span className="eyebrow-slash">/</span><span className="muted">{remoteProtocol ? remoteProtocol.toUpperCase() : "LOCAL"}</span></div>
              <h1>{remoteHost ?? "Local workstation"}</h1>
              <p className="workspace-subtitle">{remoteProtocol === "ssh" ? "Interactive SSH shell with native host-key verification." : remoteProtocol === "telnet" ? "Legacy Telnet terminal. Traffic is unencrypted." : remoteProtocol === "serial" ? "Serial terminal with explicit device parameters." : remoteProtocol === "rdp" ? "Remote desktop through a controlled native helper." : remoteProtocol === "vnc" ? "VNC desktop through a controlled native helper." : "A quiet command surface for the machine in front of you."}</p>
            </div>
            <div className="heading-actions">
              <button className="outline-button" onClick={() => setPaletteOpen(true)}><Command size={15} /> Command palette <span>{formatShortcut(settings.keyboard.commandPalette)}</span></button>
              <button className="outline-button" onClick={() => setMacrosOpen(true)}><Play size={15} /> Macros <span>{formatShortcut(settings.keyboard.openMacros)}</span></button>
              <button className="outline-button" onClick={() => setNotesOpen(true)}><FileText size={15} /> Notes</button>
              <button className="outline-button" onClick={() => setQuickConnectOpen(true)}><Network size={15} /> Quick connect <span>{formatShortcut(settings.keyboard.quickConnect)}</span></button>
              <button className="primary-button" onClick={() => startNewTerminal()}><Plus size={15} /> New terminal</button>
            </div>
          </div>
          <div className="desktop-session-tabs" aria-label="Open workspace tabs">
            <button className={`desktop-home-tab ${activeView === "home" ? "selected" : ""}`} aria-label="Home" aria-pressed={activeView === "home"} title="Home" onClick={() => setActiveView("home")}><Home size={15} /></button>
                    <div className="terminal-tab-strip" role="group" aria-label="Terminal sessions">{terminalTabs.map((terminal) => {
                      const selected = terminal.id === selectedTerminalId;
                      const bookmark = savedSessions.find(session => session.id === terminal.shortcutDeviceId);
                      const host = terminal.remoteHost;
                      const bookmarkName = (bookmark?.name ?? terminal.customName)?.trim();
                      const defaultNames = new Set(host ? [host, `Telnet · ${host}`, `SSH · ${host}`, `RDP · ${host}`, `VNC · ${host}`, ...(bookmark?.username ? [`${bookmark.username}@${host}`] : [])] : []);
                      const mobileTitle = host ? (bookmarkName && !defaultNames.has(bookmarkName) ? bookmarkName : host) : terminal.label;

                      return (
                        <div key={terminal.id} className={`terminal-tab ${selected && activeView === "terminal" ? "selected" : ""}`}>
                          <button type="button" className="terminal-tab-select" aria-pressed={selected && activeView === "terminal"} onClick={() => { setActiveTerminalId(terminal.id); setTerminalLayout(current => selectTerminalLayout(current, rememberedTerminalLayouts.current, terminal.id, new Set(terminalTabs.map(item => item.id)))); setActiveView("terminal"); }}>
                            <span className={`terminal-tab-dot terminal-tab-dot-${terminal.status}`} />
                            <span>{IS_ANDROID ? mobileTitle : terminal.label}</span>
                            <span className="terminal-tab-meta">{terminal.status === "connected" ? (terminal.remoteHost ? terminal.remoteProtocol : "local") : terminal.status}</span>
                          </button>
                          <button type="button" className="terminal-tab-close" aria-label={`Close ${terminal.label}`} title={`Close ${terminal.label}`} onClick={() => { closeTerminal(terminal.id); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".terminal-tab.selected .terminal-tab-select")?.focus()); }}><X size={13} /></button>
                        </div>
                      );
                    })}</div>
            {activeView !== "home" && activeView !== "terminal" && <div className="desktop-tool-tab"><span>{activeView === "files" ? "Remote files" : activeView === "monitor" ? "Remote monitoring" : activeView[0].toUpperCase() + activeView.slice(1)}</span><button aria-label="Close tool" onClick={() => setActiveView(selectedTerminalId ? "terminal" : "home")}><X size={12} /></button></div>}
            <button className="desktop-add-tab" aria-label={settings.general.tabPlusSavedSessions ? "Open saved session" : "New session"} title={settings.general.tabPlusSavedSessions ? "Open saved session" : "New session"} onClick={() => settings.general.tabPlusSavedSessions ? setSavedSessionPickerOpen(true) : setQuickConnectOpen(true)}><Plus size={14} /></button>
            {activeView === "terminal" && (<div className="terminal-toolbar">
                  <div className="terminal-toolbar-actions"><button type="button" className={`terminal-broadcast-button ${broadcastEnabled ? "active" : ""}`} aria-label="Configure broadcast input" title="Configure broadcast input" onClick={() => setBroadcastOpen(true)}><Radio size={14} /> {broadcastEnabled ? `${broadcastTargetIds.length} targets` : "Broadcast"}</button><button type="button" className="terminal-new-tab" aria-label="New terminal tab" title="New terminal tab" onClick={() => startNewTerminal()}><Plus size={14} /></button><button type="button" aria-label="Split terminal right" title="Split right" onClick={() => openSplit("right")}><PanelRight size={14} /></button><button type="button" aria-label="Split terminal down" title="Split down" onClick={() => openSplit("down")}><PanelBottom size={14} /></button><span className="terminal-chip">{remoteProtocol === "rdp" || remoteProtocol === "vnc" ? "RGBA" : "UTF-8"}</span><span className="terminal-chip">{remoteProtocol === "rdp" || remoteProtocol === "vnc" ? "native" : "256 colors"}</span><button type="button" className={macroRecording ? "terminal-record-button active" : ""} aria-label={macroRecording ? "Stop macro recording" : "Record macro from terminal input"} title={macroRecording ? "Stop macro recording" : "Record macro from terminal input"} onClick={macroRecording ? stopMacroRecording : startMacroRecording} disabled={remoteProtocol === "rdp" || remoteProtocol === "vnc"}><Radio size={14} /></button><button type="button" aria-label="Search terminal" title="Search terminal" onClick={openTerminalSearch} disabled={remoteProtocol === "rdp" || remoteProtocol === "vnc"}><Search size={14} /></button><button type="button" aria-label="Copy terminal selection" title="Copy selected terminal text" onClick={() => void copyTerminalSelection()} disabled={remoteProtocol === "rdp" || remoteProtocol === "vnc"}><Copy size={14} /></button><button type="button" aria-label="Clear terminal scrollback" title="Clear terminal scrollback" onClick={clearTerminalScrollback} disabled={remoteProtocol === "rdp" || remoteProtocol === "vnc"}><Trash2 size={14} /></button><button type="button" aria-label="Terminal options" title="Open terminal settings" onClick={openSettings}><MoreHorizontal size={16} /></button></div>
                  </div>)}
            <button className="desktop-session-options" aria-label="Terminal tools" title="Terminal tools" onClick={() => setPaletteOpen(true)}><MoreHorizontal size={16} /></button>
          </div>
          <div className="workspace-grid" id="workspace-view-panel" role="region" aria-label={`${activeView} workspace`} tabIndex={0}>
            <div className="main-column">
              <div className="context-strip">
                <div className="context-title"><span className={`terminal-tab-dot terminal-tab-dot-${terminalStatus}`} /> {remoteHost ?? "localhost"} <span className="context-separator">/</span> <span className="muted">{terminalStatus === "connected" ? "shell ready" : terminalStatus}</span></div>
                <div className="context-metrics">{remoteProtocol === "rdp" || remoteProtocol === "vnc" ? <><span><LayoutDashboard size={13} /> framebuffer</span><span><ArrowUpFromLine size={13} /> native input</span><span><ShieldCheck size={13} /> helper isolated</span></> : <><span><TerminalIcon size={13} /> PTY</span><span><ArrowUpFromLine size={13} /> bidirectional</span><span><Radio size={13} /> 32 KB batches</span></>}</div>
              </div>

              <div className="view-tabs" role="tablist" aria-label="Workspace views">
                <button type="button" id="workspace-tab-terminal" aria-controls="workspace-view-panel" tabIndex={activeView === "terminal" ? 0 : -1} className={activeView === "terminal" ? "selected" : ""} onClick={() => setActiveView("terminal")} onKeyDown={handleWorkspaceTabKeyDown} role="tab" aria-selected={activeView === "terminal"}><TerminalIcon size={15} /> Terminal</button>
                <button type="button" id="workspace-tab-files" aria-controls="workspace-view-panel" tabIndex={activeView === "files" ? 0 : -1} className={activeView === "files" ? "selected" : ""} onClick={() => setActiveView("files")} onKeyDown={handleWorkspaceTabKeyDown} role="tab" aria-selected={activeView === "files"}><Folder size={15} /> Files <span className="tab-badge">SSH</span></button>
                <button type="button" id="workspace-tab-tunnels" aria-controls="workspace-view-panel" tabIndex={activeView === "tunnels" ? 0 : -1} className={activeView === "tunnels" ? "selected" : ""} onClick={() => setActiveView("tunnels")} onKeyDown={handleWorkspaceTabKeyDown} role="tab" aria-selected={activeView === "tunnels"}><Network size={15} /> Tunnels <span className="tab-badge">{activeTunnelCount}</span></button>
                {remoteSessionId && remoteProtocol === "ssh" && <button type="button" id="workspace-tab-monitor" aria-controls="workspace-view-panel" tabIndex={activeView === "monitor" ? 0 : -1} className={activeView === "monitor" ? "selected" : ""} onClick={() => setActiveView("monitor")} onKeyDown={handleWorkspaceTabKeyDown} role="tab" aria-selected={activeView === "monitor"}><Gauge size={15} /> Monitor</button>}
                <button type="button" id="workspace-tab-transfers" aria-controls="workspace-view-panel" tabIndex={activeView === "transfers" ? 0 : -1} className={activeView === "transfers" ? "selected" : ""} onClick={() => setActiveView("transfers")} onKeyDown={handleWorkspaceTabKeyDown} role="tab" aria-selected={activeView === "transfers"}><ArrowDownToLine size={15} /> Transfers <span className="tab-badge">{activeTransferCount}</span></button>
                <button type="button" id="workspace-tab-audit" aria-controls="workspace-view-panel" tabIndex={activeView === "audit" ? 0 : -1} className={activeView === "audit" ? "selected" : ""} onClick={() => setActiveView("audit")} onKeyDown={handleWorkspaceTabKeyDown} role="tab" aria-selected={activeView === "audit"}><History size={15} /> Audit</button>
              </div>

              <section hidden={activeView !== "terminal"} className="terminal-card" aria-label="Terminal workspace">

                  {macroRecording && <div className="macro-recording-banner" role="alert"><Radio size={15} /><div><strong>RECORDING INPUT · {macroRecording.terminalLabel}</strong><span>Only terminal input is captured locally. Do not type passwords, tokens, or private keys.</span></div><button type="button" className="danger-button" onClick={stopMacroRecording}><Square size={13} /> Stop recording</button></div>}
                  {broadcastEnabled && <div className="broadcast-banner" role="alert"><ShieldAlert size={15} /><div><strong>BROADCAST INPUT ACTIVE</strong><span>{broadcastTargetIds.length} explicitly selected terminal{broadcastTargetIds.length === 1 ? "" : "s"} · every keystroke is fanned out</span></div><button type="button" className="danger-button" onClick={() => { setBroadcastEnabled(false); setBroadcastOpen(false); setSessionNotice("Broadcast mode disabled. No further input will fan out."); }}><Square size={13} /> Emergency disable <kbd>Esc</kbd></button></div>}
                  {macroRun && <div className="macro-run-banner" role="status"><LoaderCircle className="spin" size={15} /><div><strong>MACRO RUNNING · {macroRun.title}</strong><span>Step {macroRun.step}/{macroRun.total} · {macroRun.targets.join(", ")}</span></div><button type="button" className="danger-button" onClick={cancelMacro}><Square size={13} /> Cancel macro <kbd>Esc</kbd></button></div>}
                  <div className={`terminal-frame terminal-tabs-frame ${terminalLayout.kind === "split" ? "terminal-frame-has-layout" : "terminal-frame-single"}`}><TerminalLayoutView node={terminalLayout} terminals={terminalTabs} renderPane={renderTerminalPane} onFocus={setActiveTerminalId} onStartResize={beginSplitResize} onAdjustResize={adjustSplitRatio} onResetResize={resetSplitRatio} /></div>
                  {IS_ANDROID && <div className="android-terminal-keys" role="group" aria-label="Terminal keys">
                    {[["←", "D"], ["↓", "B"], ["↑", "A"], ["→", "C"], ["Tab", "\t"]].map(([label, key]) => <button
                      key={label} type="button" aria-label={label === "Tab" ? "Tab" : `Arrow ${key === "D" ? "left" : key === "B" ? "down" : key === "A" ? "up" : "right"}`}
                      disabled={terminalStatus !== "connected"}
                      onPointerDown={event => event.preventDefault()}
                      onClick={() => {
                        if (isWorkspaceLocked() || document.querySelector('[role="dialog"], dialog[open]')) return;
                        const terminal = terminalInstancesRef.current.get(selectedTerminalIdRef.current)?.terminal;
                        if (!terminal || !terminal.element?.getClientRects().length) return;
                        terminal.focus();
                        terminal.input(key === "\t" ? key : `\x1b${terminal.modes.applicationCursorKeysMode ? "O" : "["}${key}`, true);
                      }}
                    >{label}</button>)}
                  </div>}
                  <div className="terminal-statusbar"><span><span className="status-square" /> {terminalStatus === "connected" ? "connected" : terminalStatus}</span><span>{remoteProtocol ? `${remoteProtocol} transport` : "local process"}</span><span>scrollback {settings.terminal.scrollbackLines.toLocaleString()}</span><span>{settings.appearance.fontSize}px · Mod +/- zoom</span><span className="terminal-status-spacer" />{canReconnectTerminal(remoteProtocol, terminalStatus, activeTerminal?.connecting) && <button type="button" className="terminal-status-action" disabled={reconnectBusy} onClick={() => void reconnectSelectedTerminal()}><RefreshCw size={12} /> {reconnectBusy ? "Reconnecting…" : "Disconnected · Reconnect (R)"}</button>}<span>{formatShortcut(settings.keyboard.quickConnect)} for quick connect</span></div>
              </section>
              <div hidden={activeView !== "generator"}><ConfigGenerator /></div>
              {activeView === "generator" ? null : activeView === "home" ? (
                <section className="desktop-home" aria-label="Home">
                  <div className="desktop-home-content">
                    <div className="desktop-home-brand"><div className="desktop-home-logo" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path className="conxol-mark-frame" pathLength="1" d="M36 10H22a14 14 0 0 0 0 28h14" /><path className="conxol-mark-prompt" d="m21 19 6 5-6 5" /><path className="conxol-mark-prompt conxol-mark-cursor" d="M31 30h7" /></svg></div><h1>Conxol</h1></div>
                    <div className="desktop-home-actions"><button className="outline-button" onClick={() => startNewTerminal()}><Plus size={14} /> Start local terminal</button><button className="outline-button" onClick={() => setRecoveryOpen(true)}><History size={14} /> Recover previous sessions</button><button className="outline-button desktop-home-new-session" onClick={() => setQuickConnectOpen(true)}><Plus size={14} /> New session</button></div>
                  </div>
                </section>
              ) : activeView === "files" && remoteSessionId && remoteProtocol === "ssh" ? (
                <RemoteFilesView entries={remoteListingSessionId === remoteSessionId && sftpStatus === "ready" ? remoteEntries : []} path={remoteListingSessionId === remoteSessionId ? remotePath : "."} status={remoteListingSessionId === remoteSessionId ? sftpStatus : "loading"} error={connectionError ?? (remoteListingSessionId === remoteSessionId ? remoteDirectoryError : null)} localDropActive={localDropActive} transfers={transfers.filter((transfer) => transfer.terminalId === remoteSessionId)} onOpenTerminal={() => setActiveView("terminal")} onNavigate={navigateRemote} onDownload={startDownload} onUpload={startUpload} onCreateDirectory={createRemoteDirectory} onRename={renameRemote} onDelete={deleteRemote} onSetPermissions={setRemotePermissions} onCopyPath={copyRemotePath} onEdit={openRemoteTextFile} onCancelTransfer={cancelTransfer} onRetryTransfer={retryTransfer} />
              ) : activeView === "tunnels" && remoteSessionId && remoteProtocol === "ssh" ? (
                <TunnelView tunnels={tunnels} onNewTunnel={() => setTunnelDraft({ kind: "local", terminalId: remoteSessionId })} onNewDynamicForward={() => setTunnelDraft({ kind: "dynamic", terminalId: remoteSessionId })} onNewRemoteForward={() => setTunnelDraft({ kind: "remote", terminalId: remoteSessionId })} onCancelTunnel={cancelTunnel} />
              ) : activeView === "monitor" && remoteSessionId && remoteProtocol === "ssh" ? (
                <RemoteMonitorView snapshot={remoteMonitor} status={remoteMonitorStatus} error={remoteMonitorError} live={remoteMonitorLive} intervalSeconds={remoteMonitorIntervalSeconds} onLiveChange={setRemoteMonitorLive} onIntervalChange={setRemoteMonitorIntervalSeconds} onRefresh={() => void collectRemoteMonitor()} />
              ) : activeView === "transfers" ? (
                <TransferManagerView transfers={transfers} onCancelTransfer={cancelTransfer} onRetryTransfer={retryTransfer} />
              ) : activeView === "audit" ? (
                <AuditHistoryView events={auditEvents} onClear={() => void clearAudit()} />
              ) : activeView === "terminal" ? null : (
                <EmptyProtocolView view={activeView} onAction={activeView === "tunnels" || activeView === "monitor" ? () => setQuickConnectOpen(true) : undefined} />
              )}

              <div className="lower-grid">
                <InfoCard icon={ShieldCheck} label="Security boundary" title="Saved secrets stay native" detail="Saved sessions use credential references. The native vault stores saved passwords and passphrases." action="Read threat model" onAction={() => setHelpOpen(true)} />
                <InfoCard icon={ArrowUpFromLine} label="Transport" title="Backpressure is explicit" detail="PTY output is bounded before it reaches the renderer, keeping noisy jobs responsive." action="View architecture" onAction={() => setHelpOpen(true)} />
              </div>
            </div>

            <aside className="right-rail">
              <div className="rail-heading"><span>Session brief</span><button aria-label="Session options" title="Open connection options" onClick={() => setQuickConnectOpen(true)}><MoreHorizontal size={15} /></button></div>
                <div className="machine-card">
                <div className="machine-icon"><Server size={18} /></div>
                <div><div className="machine-name">{remoteHost ?? "This Mac"}</div><div className="machine-detail">{remoteHost ? (remoteProtocol === "telnet" ? "Telnet · unencrypted" : remoteProtocol === "serial" ? "Serial · device" : remoteProtocol === "rdp" ? "RDP · isolated helper" : remoteProtocol === "vnc" ? "VNC · isolated helper" : "SSH · verified transport") : "Apple Silicon · local"}</div></div>
                <span className={`machine-live machine-state-${terminalStatus}`}>{terminalStatus === "connected" ? "LIVE" : terminalStatus.toUpperCase()}</span>
              </div>
              <div className="rail-group"><div className="rail-label">Runtime</div><Metric label="Surface" value={remoteProtocol === "rdp" || remoteProtocol === "vnc" ? "remote desktop" : remoteHost ? "remote shell" : "zsh"} /><Metric label="Renderer" value={remoteProtocol === "rdp" || remoteProtocol === "vnc" ? "RGBA framebuffer" : "xterm-256color"} /><Metric label="Process" value={terminalStatus === "connected" ? "running" : "idle"} /></div>
              <div className="rail-group"><div className="rail-label">Workspace notes</div><p className="rail-copy">Use tabs and split panes to keep work in view. Files and SSH tunnels follow the active SSH session.</p></div>
              <div className="rail-callout"><div className="callout-icon"><Network size={15} /></div><div><strong>{remoteHost && terminalStatus !== "connected" ? `${remoteProtocol?.toUpperCase()} ${terminalStatus}` : remoteProtocol === "telnet" ? "Telnet transport active" : remoteProtocol === "serial" ? "Serial transport active" : remoteProtocol === "rdp" ? "RDP helper active" : remoteProtocol === "vnc" ? "VNC helper active" : remoteHost ? "SSH transport active" : "Connect securely"}</strong><p>{remoteHost && terminalStatus !== "connected" ? "Transport is not connected. Reopen the saved session or use Quick connect to try again." : remoteProtocol === "telnet" ? "This legacy terminal is unencrypted; use SSH for protected administration." : remoteProtocol === "serial" ? "Serial traffic depends on the connected hardware; Conxol does not add encryption." : remoteProtocol === "rdp" ? "The remote desktop is isolated behind the native helper boundary; certificate and gateway options remain explicit." : remoteProtocol === "vnc" ? "The VNC framebuffer and input stay in the native helper boundary; legacy VNC transport is not SSH-level encryption." : remoteHost ? "Host-key verification and native PTY negotiation are active for this shell." : "Known-host verification and PTY negotiation are ready for a real SSH connection."}</p><button onClick={() => setQuickConnectOpen(true)}>{remoteHost ? "Open another session" : "Quick connect"} <ExternalLink size={12} /></button></div></div>
            </aside>
          </div>

          <footer className="workspace-footer"><span><span className="footer-led" /> Conxol core · v{appVersion}</span><span>Rust PTY bridge</span><span>{navigator.platform.includes("Mac") ? "macOS" : navigator.platform.includes("Win") ? "Windows" : "Linux"} · local mode</span><span className="footer-spacer" /><span>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}</span></footer>
        </section>
      </div>

      <div className="app-notifications">
          {storeUpdates.notice}
          {pendingSavedSession && !terminalTabs.some(terminal => terminal.connecting) && <div className="workspace-notice connection-pending" role="status" aria-live="polite"><LoaderCircle className="spin" size={15} aria-hidden="true" /><span>Connecting to {pendingSavedSession.name}…</span></div>}
          {connectionError && !quickConnectOpen && activeView !== "files" && <div className="connect-error workspace-error" role="alert"><span>{connectionError}</span><button type="button" className="outline-button" aria-label="Dismiss error" onClick={() => setConnectionError(null)}>Dismiss</button></div>}
          {sessionNotice && <div className={`workspace-notice${typeof sessionNotice === "string" ? "" : " workspace-notice-review"}`} role="status">
            {typeof sessionNotice === "string" ? <CheckCircle2 size={14} /> : <CircleHelp size={14} />}
            <div><span>{typeof sessionNotice === "string" ? sessionNotice : sessionNotice.message}</span>
              {typeof sessionNotice !== "string" && <details><summary>Review import details ({sessionNotice.total})</summary><ul>{sessionNotice.details.map((detail, index) => <li key={`${index}:${detail}`}>{detail}</li>)}</ul>{sessionNotice.total > sessionNotice.details.length && <span>Showing first {sessionNotice.details.length} of {sessionNotice.total} details.</span>}</details>}
            </div>
          </div>}
      </div>

      <FloatingDiagnostics open={diagnosticsOpen} onMinimize={() => { setDiagnosticsOpen(false); requestTerminalFocus(selectedTerminalId); }} onClose={() => {
        void Promise.allSettled([cancelNetworkDiagnostic(), cancelNetworkScan()]);
        setDiagnosticsOpen(false);
        requestTerminalFocus(selectedTerminalId);
      }}>
        <NetworkDiagnosticsView pingInterval={pingInterval} pingPacketSize={pingPacketSize} onPingIntervalChange={setPingInterval} onPingPacketSizeChange={setPingPacketSize} scanProtocol={networkScanProtocol} onScanProtocolChange={value => { setNetworkScanProtocol(value); setNetworkScanResults([]); setNetworkScanStatus("idle"); setNetworkScanScanned(0); setNetworkScanTotal(0); }} host={networkHost} tcpPort={networkTcpPort} onTcpPortChange={setNetworkTcpPort} port={networkPort} timeout={networkTimeout} status={networkStatus} dnsReport={dnsReport} dnsRecordType={dnsRecordType} onDnsRecordTypeChange={setDnsRecordType} dnsServer={dnsServer} onDnsServerChange={setDnsServer} result={networkResult} fingerprint={networkFingerprint} error={networkError} scanId={networkScanId} scanStatus={networkScanStatus} scanStart={networkScanStart} scanEnd={networkScanEnd} scanConcurrency={networkScanConcurrency} scanScanned={networkScanScanned} scanTotal={networkScanTotal} scanResults={networkScanResults} diagnosticKind={networkDiagnosticKind} diagnosticStatus={networkDiagnosticStatus} pingResult={networkPingResult} traceMaxHops={networkTraceMaxHops} onHostChange={setNetworkHost} onPortChange={setNetworkPort} onTimeoutChange={setNetworkTimeout} onTraceMaxHopsChange={setNetworkTraceMaxHops} onResolve={resolveNetworkHost} onCheckTcp={checkNetworkTcp} onInspectFingerprint={inspectNetworkHostKey} onPing={startNetworkPing} mtrResult={networkMtrResult} onMtr={startNetworkMtr} onCancelDiagnostic={cancelNetworkDiagnostic} onScanStartChange={setNetworkScanStart} onScanEndChange={setNetworkScanEnd} onScanConcurrencyChange={setNetworkScanConcurrency} onStartScan={startNetworkScan} onCancelScan={cancelNetworkScan} />
      </FloatingDiagnostics>
      {paletteOpen && <CommandPalette keyboard={settings.keyboard} onClose={() => setPaletteOpen(false)} onNewTerminal={() => startNewTerminal()} onNewShell={startExplicitShell} onNewWslTerminal={openWslTerminalPicker} onQuickConnect={() => { setQuickConnectOpen(true); setPaletteOpen(false); }} onOpenFiles={openSftpView} onOpenSettings={() => { openSettings(); setPaletteOpen(false); }} onOpenCredentials={() => { setCredentialsOpen(true); setPaletteOpen(false); }} onOpenSnippets={() => { setSnippetsOpen(true); setPaletteOpen(false); }} onOpenMacros={() => { setMacrosOpen(true); setPaletteOpen(false); }} onOpenNotes={() => { setNotesOpen(true); setPaletteOpen(false); }} onOpenAudit={() => { setActiveView("audit"); setPaletteOpen(false); }} onToggleSidebar={() => { setSidebarOpen((open) => !open); setPaletteOpen(false); }} onFocusPane={focusPane} />}
      {helpOpen && <HelpModal mode="help" onExportDiagnostics={exportDiagnostics} keyboard={settings.keyboard} onClose={() => setHelpOpen(false)} />}
      {aboutOpen && <HelpModal mode="about" onExportDiagnostics={exportDiagnostics} keyboard={settings.keyboard} onClose={() => setAboutOpen(false)} />}
      {recoveryOpen && <div className="palette-backdrop" role="presentation" onMouseDown={() => setRecoveryOpen(false)}><section className="session-recovery-dialog" role="dialog" aria-modal="true" aria-label="Recover previous sessions" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") setRecoveryOpen(false); }}><header><h2>Recover previous sessions</h2><button autoFocus aria-label="Close recovery" onClick={() => setRecoveryOpen(false)}><X size={16} /></button></header><p>Select a recently used session to reconnect.</p>{sessionRows.filter((session) => session.lastUsedAt != null).sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)).map((session) => <button className="recovery-session" disabled={pendingSavedSession !== null && session.type !== "LOCAL"} key={session.id ?? session.name} onClick={() => { setRecoveryOpen(false); const saved = savedSessions.find((item) => item.id === session.id); if (saved) { if (saved.protocol === "LOCAL") openSavedLocalSession(saved); else void connectSavedSession(saved); } else if (session.type === "LOCAL") startNewTerminal(); else setQuickConnectOpen(true); }}><TerminalIcon size={15} /><span>{session.name}<small>{session.detail}</small></span></button>)}{!sessionRows.some((session) => session.lastUsedAt != null) && <p>No previous sessions yet. Start a local terminal or create a session with the + tab.</p>}</section></div>}
      {folderContextMenu && <SessionFolderMenu folder={folderContextMenu.folder} x={folderContextMenu.x} y={folderContextMenu.y} onCreate={() => { const parent = folderContextMenu.folder; setFolderContextMenu(null); void createSessionFolder(parent); }} disabled={deletingFolder !== null || createdSessionFolders.some(path => path !== folderContextMenu.folder && sessionFolderWithin(path, folderContextMenu.folder)) || sessionRows.some(session => sessionFolderWithin(session.folder.trim(), folderContextMenu.folder))} onCustomize={() => { setCustomizingFolder(folderContextMenu.folder); setFolderContextMenu(null); }} onClose={() => setFolderContextMenu(null)} onDelete={() => void deleteSessionFolder(folderContextMenu.folder)} />}
      {customizingHost && <FolderCustomization key={customizingHost.id} host folder={customizingHost.name} bookmark={{ folder: customizingHost.folder ?? "", tags: customizingHost.tags, notes: customizingHost.notes ?? "", favorite: customizingHost.favorite }} folders={[...new Set([...createdSessionFolders.flatMap(sessionFolderAncestors), ...savedSessions.flatMap(session => sessionFolderAncestors(session.folder?.trim() ?? ""))])].sort()} appearance={hostStyles[customizingHost.id] ?? { icon: customizingHost.protocol === "LOCAL" ? "terminal" : "server", color: "" }} onClose={() => setCustomizingHost(null)} onSave={async (name, style, bookmark) => {
        if (!bookmark) return;
        const session = { ...customizingHost, name, folder: bookmark.folder || null, tags: bookmark.tags, notes: bookmark.notes, favorite: bookmark.favorite };
        if (IS_TAURI) await invoke<SavedSession>("session_save", { session });
        setSessionFolderState(current => ({ ...current, ...(bookmark.folder ? sessionFolderOpenState(bookmark.folder) : {}) }));
        refreshSavedSessions();
        setSessionNotice(`Saved ${name}.`);
        setHostStyles(current => ({ ...current, [customizingHost.id]: style }));
        setCustomizingHost(null);
      }} />}
      {customizingFolder && <FolderCustomization key={customizingFolder} folder={customizingFolder} appearance={folderStyles[customizingFolder] ?? defaultFolderStyle} onClose={() => setCustomizingFolder(null)} onSave={saveFolderCustomization} />}
      {savedSessionPickerOpen && <SavedSessionPicker sessions={savedSessions} onClose={() => setSavedSessionPickerOpen(false)} onNew={() => setQuickConnectOpen(true)} onSelect={session => {
        setSavedSessionPickerOpen(false);
        if (!isWorkspaceLocked()) void connectSavedSession(session);
      }} />}
      {quickConnectOpen && <QuickConnectDialog connecting={sshConnecting} error={connectionError} folders={[...new Set([...createdSessionFolders.flatMap(sessionFolderAncestors), ...savedSessions.flatMap(session => sessionFolderAncestors(session.folder?.trim() ?? ""))])]} onClose={() => { setQuickConnectOpen(false); setConnectionError(null); }} onConnectSsh={(request, bookmark) => connectSsh(request, true, bookmark?.name || undefined, bookmark?.folder)} onConnectTelnet={connectTelnet} onConnectSerial={connectSerial} onConnectRemoteDesktop={connectRemoteDesktop} onShell={() => startNewTerminal()} onWsl={openWslTerminalPicker} />}
      {tunnelDraft && <TunnelDialog kind={tunnelDraft.kind} onClose={() => setTunnelDraft(null)} onStart={startTunnel} />}
      {wslTerminalOpen && <WslTerminalDialog onClose={() => setWslTerminalOpen(false)} onSelect={startWslTerminal} />}
      {editingSession && <QuickConnectDialog key={editingSession.id} initialSession={editingSession} error={connectionError} onConnectSsh={() => {}} onConnectTelnet={() => {}} onConnectSerial={() => {}} onConnectRemoteDesktop={() => {}} onShell={() => {}} onWsl={() => {}} folders={[...new Set([...createdSessionFolders.flatMap(sessionFolderAncestors), ...savedSessions.flatMap(session => sessionFolderAncestors(session.folder?.trim() ?? ""))])].sort()} onClose={() => setEditingSession(null)} onSave={saveEditedSession} />}
      {settingsOpen && <SettingsModal systemDark={systemDark} canRestore={terminalTabs.length === 0 && pendingSavedSession === null} settings={settings} error={settingsError} portableVaultStatus={portableVaultStatus} onClose={() => setSettingsOpen(false)} onSave={saveSettings} onReset={resetSettings} onExport={exportSettings} onImport={importSettings} onPortableCreate={createPortableVault} onPortableUnlock={unlockPortableVault} onPortableLock={lockPortableVault} />}
      {credentialsOpen && <CredentialVaultModal onClose={() => setCredentialsOpen(false)} onSave={saveCredential} onDelete={deleteCredential} />}
      {editingRemoteFile && <RemoteEditorModal key={`${editingRemoteFile.sessionId}:${editingRemoteFile.document.path}:${editingRemoteFile.document.revision}`} document={editingRemoteFile.document} onClose={() => setEditingRemoteFile(null)} onReload={reloadRemoteTextFile} onSave={saveRemoteTextFile} onSaveAs={saveRemoteTextFileAs} />}
      {snippetsOpen && <SnippetsModal snippets={snippets.filter(record => !isCommandShortcut(record))} onClose={() => setSnippetsOpen(false)} onSave={saveSnippet} onDelete={deleteSnippet} onCopy={copySnippet} />}

      {macrosOpen && <MacrosModal key={recordedMacroDraft?.id ?? "macros"} initialDraft={recordedMacroDraft ?? undefined} macros={macros} terminals={terminalTabs} savedSessions={savedSessions} onClose={() => { setMacrosOpen(false); setRecordedMacroDraft(null); }} onSave={saveMacro} onDelete={deleteMacro} onRun={runMacro} />}
      {broadcastOpen && <BroadcastModal terminals={terminalTabs} selectedIds={broadcastTargetIds} enabled={broadcastEnabled} onClose={() => setBroadcastOpen(false)} onToggle={(id) => setBroadcastTargetIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} onEnable={() => { if (broadcastTargetIds.length === 0) { setConnectionError("Select at least one ready terminal before enabling broadcast."); return; } setBroadcastEnabled(true); setBroadcastOpen(false); setConnectionError(null); setSessionNotice("Broadcast mode enabled. Review the red banner before typing."); }} onDisable={() => { setBroadcastEnabled(false); setBroadcastOpen(false); setSessionNotice("Broadcast mode disabled. No further input will fan out."); }} />}
    </main>
  );
}

function requestFromSavedAuth(auth: SavedAuth): SshConnectRequest["auth"] | null {
  if (auth.kind === "agent") return { method: "agent" };
  if (auth.kind === "keyboardInteractivePrompt") return { method: "keyboardInteractivePrompt" };
  if (auth.kind === "password" && auth.credentialRef.trim()) {
    return { method: "password", credentialId: auth.credentialRef };
  }
  if (auth.kind === "keyboardInteractive" && auth.credentialRef.trim()) {
    return { method: "keyboardInteractive", credentialId: auth.credentialRef };
  }
  if (auth.kind === "privateKey" && auth.keyRef.trim()) {
    return { method: "privateKey", path: auth.keyRef, passphraseCredentialId: auth.credentialRef ?? undefined };
  }
  return null;
}

const MAX_SSH_JUMP_HOSTS = 8;

function requestFromSavedSession(session: SavedSession, catalog: SavedSession[], visited = new Set<string>(), remainingHops = MAX_SSH_JUMP_HOSTS): SshConnectRequest | null {
  if (session.protocol !== "SSH" || visited.has(session.id)) return null;
  if ((session.jump_host_profiles?.length ?? 0) > remainingHops || (!session.jump_host_profiles?.length && session.jump_hosts.length > remainingHops)) return null;
  const username = session.username?.trim();
  if (!username || session.port === 0) return null;
  const auth = requestFromSavedAuth(session.auth);
  if (!auth) return null;
  const nextVisited = new Set(visited);
  nextVisited.add(session.id);
  const directJumpHosts = session.jump_host_profiles && session.jump_host_profiles.length > 0
    ? session.jump_host_profiles.map((jump) => {
      const jumpAuth = requestFromSavedAuth(jump.auth);
      if (!jumpAuth || jump.port === 0 || !jump.username.trim() || !jump.host.trim()) return null;
      return {
        host: jump.host,
        port: jump.port,
        username: jump.username,
        auth: jumpAuth,
        legacyRsa: jump.legacy_rsa ?? false,
        knownHostsPath: jump.known_hosts_path ?? undefined,
        pinnedFingerprint: jump.pinned_fingerprint ?? undefined,
        serverAliveInterval: jump.server_alive_interval ?? undefined,
      };
    })
    : undefined;
  let jumpHosts: SshJumpHostRequest[] = [];
  if (directJumpHosts) {
    if (directJumpHosts.some((jump) => jump === null)) return null;
    jumpHosts = directJumpHosts as SshJumpHostRequest[];
  } else {
    for (const alias of session.jump_hosts) {
      if (jumpHosts.length >= remainingHops) return null;
      const resolved = resolveSavedJumpAlias(catalog, alias);
      if (!resolved) return null;
      const jumpRequest = requestFromSavedSession(resolved.session, catalog, nextVisited, remainingHops - jumpHosts.length - 1);
      if (!jumpRequest) return null;
      if (jumpHosts.length + (jumpRequest.jumpHosts?.length ?? 0) >= remainingHops) return null;
      jumpHosts.push(...(jumpRequest.jumpHosts ?? []));
      jumpHosts.push({
        host: jumpRequest.host,
        port: resolved.port ?? jumpRequest.port,
        username: resolved.username ?? jumpRequest.username,
        auth: jumpRequest.auth,
        legacyRsa: jumpRequest.legacyRsa,
        knownHostsPath: jumpRequest.knownHostsPath,
        pinnedFingerprint: jumpRequest.pinnedFingerprint,
        serverAliveInterval: jumpRequest.serverAliveInterval,
      });
    }
  }
  return {
    host: session.hostname,
    port: session.port,
    username,
    auth,
    legacyRsa: session.legacy_rsa ?? false,
    knownHostsPath: session.known_hosts_path ?? undefined,
    pinnedFingerprint: session.pinned_fingerprint ?? undefined,
    x11: session.x11_display?.trim() ? { display: session.x11_display, singleConnection: session.x11_single_connection ?? false } : undefined,
    serverAliveInterval: session.server_alive_interval ?? undefined,
    environment: session.environment ?? [],
    startupDirectory: session.startup_directory ?? undefined,
    startupCommand: session.startup_command ?? undefined,
    pptpProfileId: session.pptp_profile_id ?? undefined,
    jumpHosts: jumpHosts.length > 0 ? jumpHosts : undefined,
    cols: 120,
    rows: 32,
  };
}

function toSessionListItem(session: SavedSession): SessionListItem {
  if (session.protocol === "LOCAL") {
    return { id: session.id, name: session.name, detail: "zsh · localhost", type: "LOCAL", folder: session.folder ?? "", active: true, favorite: session.favorite, tags: session.tags, lastUsedAt: session.last_used_at };
  }
  if (session.protocol === "SERIAL" && session.serial_profile) {
    return { id: session.id, name: session.name, detail: `${session.serial_profile.device} · ${session.serial_profile.baud_rate}`, type: session.protocol, folder: session.folder ?? "", active: false, favorite: session.favorite, tags: session.tags, lastUsedAt: session.last_used_at };
  }
  if (session.protocol === "TELNET") {
    const port = session.port && session.port !== 23 ? `:${session.port}` : "";
    return { id: session.id, name: session.name, detail: `${session.hostname}${port} · unencrypted`, type: session.protocol, folder: session.folder ?? "", active: false, favorite: session.favorite, tags: session.tags, lastUsedAt: session.last_used_at };
  }
  const user = session.username ? `${session.username}@` : "";
  const port = session.port && session.port !== 22 ? `:${session.port}` : "";
  return { id: session.id, name: session.name, detail: `${user}${session.hostname}${port}`, type: session.protocol, folder: session.folder ?? "", active: false, favorite: session.favorite, tags: session.tags, lastUsedAt: session.last_used_at };
}

function groupSessionsByFolder(sessions: SessionListItem[], folders: string[] = []): Array<[string, SessionListItem[]]> {
  return groupSessionFolders(sessions, folders);
}

function SessionFolderMenu({ folder, x, y, disabled, onClose, onDelete, onCustomize, onCreate }: { folder: string; x: number; y: number; disabled: boolean; onClose: () => void; onDelete: () => void; onCustomize: () => void; onCreate: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const menu = menuRef.current;
    menu?.querySelector("button")?.focus();
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" || event.key === "Tab") { if (event.key === "Escape") event.preventDefault(); onClose(); } };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      if (menu?.contains(document.activeElement) && previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [onClose]);
  return <div ref={menuRef} className="session-folder-menu" role="menu" aria-label={`Folder ${folder}`} style={{ left: Math.max(4, Math.min(x, window.innerWidth - 228)), top: Math.max(4, Math.min(y, window.innerHeight - 120)) }}>
    <button type="button" role="menuitem" onClick={onCreate}><FolderPlus size={14} />New subfolder</button>
    <button type="button" role="menuitem" onClick={onCustomize}><Pencil size={14} /><span>Customize folder<small>Name, icon and color</small></span></button>
    <button type="button" role="menuitem" disabled={disabled} onClick={onDelete}><Trash2 size={14} /><span>Delete folder<small>Keep sessions in the main list</small></span></button>
  </div>;
}

function SessionRow({ appearance, onCustomize, name, detail, type, active, favorite, connecting = false, disabled = false, onSelect, onEdit, onDelete, onToggleFavorite, onDragStart, onDragEnd, onDragMove, onDrop }: SessionListItem & { appearance?: FolderStyle; onCustomize?: () => void; connecting?: boolean; disabled?: boolean; onDragStart?: () => void; onDragEnd?: () => void; onDragMove?: (folder: string | null) => void; onDrop?: (folder: string) => void; onSelect: () => void; onEdit?: () => void; onDelete?: () => void; onToggleFavorite: () => void }) {
  const drag = useRef<{ x: number; y: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);
  const folderAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-session-folder]")?.dataset.sessionFolder ?? null;
  return <div className={`session-row ${active ? "active" : ""}`} data-draggable={!!onDragStart}
    onPointerDown={event => {
      if (!onDragStart || event.button !== 0 || (event.target as HTMLElement).closest(".session-row-actions")) return;
      suppressClick.current = false;
      drag.current = { x: event.clientX, y: event.clientY, active: false };
    }}
    onPointerMove={event => {
      const current = drag.current;
      if (!current || !(event.buttons & 1)) return;
      if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) >= 6) {
        current.active = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        onDragStart?.();
      }
      if (current.active) { event.preventDefault(); onDragMove?.(folderAt(event.clientX, event.clientY)); }
    }}
    onPointerUp={event => {
      if (drag.current?.active) {
        suppressClick.current = true;
        const folder = folderAt(event.clientX, event.clientY);
        if (folder !== null) onDrop?.(folder);
        onDragEnd?.();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }
      drag.current = null;
    }}
    onPointerCancel={() => { drag.current = null; onDragEnd?.(); }}
    onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}><button className="session-row-main" title={`${name} · ${detail}${onEdit ? " · Right-click or F2 to rename and organize" : ""}`} onContextMenu={onEdit ? event => { event.preventDefault(); onEdit(); } : undefined} onKeyDown={event => { if (event.key === "F2" && onEdit) { event.preventDefault(); onEdit(); } }} disabled={disabled} aria-busy={connecting} onClick={onSelect}><span className={`session-icon ${type === "LOCAL" ? "local" : "remote"}`}>{appearance ? <SessionFolderIcon appearance={appearance} /> : type === "LOCAL" ? <TerminalIcon size={14} /> : <Server size={14} />}</span><span className="session-copy"><strong>{name}</strong><small>{detail}</small></span><span className={`session-type ${type === "LOCAL" ? "local-type" : ""}`}>{type}</span></button><SessionRowActions name={name} favorite={favorite} onCustomize={onCustomize} onEdit={onEdit} onDelete={onDelete} onToggleFavorite={onToggleFavorite} /></div>;
}

function RemoteFilesView({ entries, path, status, error, localDropActive, transfers, onOpenTerminal, onNavigate, onDownload, onUpload, onCreateDirectory, onRename, onDelete, onSetPermissions, onCopyPath, onEdit, onCancelTransfer, onRetryTransfer }: {
  entries: RemoteEntry[];
  path: string;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  localDropActive: boolean;
  transfers: SshTransferEvent[];
  onOpenTerminal: () => void;
  onNavigate: (path: string) => void;
  onDownload: (entry: RemoteEntry, protocol: TransferProtocol) => void;
  onUpload: (protocol: TransferProtocol, pickerKind?: LocalUploadPickerKind) => void;
  onCreateDirectory: () => void;
  onRename: (entry: RemoteEntry) => void;
  onDelete: (entry: RemoteEntry) => void;
  onSetPermissions: (entry: RemoteEntry) => void;
  onCopyPath: (entry: RemoteEntry) => void;
  onEdit: (entry: RemoteEntry, encoding: RemoteTextDocument["encoding"]) => void;
  onCancelTransfer: (transferId: string) => void;
  onRetryTransfer: (transfer: SshTransferEvent) => void;
}) {
  const [transferProtocol, setTransferProtocol] = useState<TransferProtocol>("sftp");
  const [openEncoding, setOpenEncoding] = useState<RemoteTextDocument["encoding"]>("utf-8");
  const [sort, setSort] = useState<RemoteFileSort>("name");
  const [showHidden, setShowHidden] = useState(true);
  const parentPath = remoteParentPath(path);
  const visibleEntries = entries
    .filter((entry) => showHidden || !entry.name.startsWith("."))
    .slice()
    .sort((first, second) => {
      if (sort === "type" && first.isDirectory !== second.isDirectory) return first.isDirectory ? -1 : 1;
      if (sort === "size" && first.size !== second.size) {
        if (first.size == null) return 1;
        if (second.size == null) return -1;
        return second.size > first.size ? 1 : -1;
      }
      if (sort === "modified" && first.modifiedUnixSeconds !== second.modifiedUnixSeconds) return (second.modifiedUnixSeconds ?? 0) > (first.modifiedUnixSeconds ?? 0) ? 1 : -1;
      return first.name.localeCompare(second.name, undefined, { sensitivity: "base", numeric: true });
    });
  return <section className="remote-files" aria-label="Remote files">
      <div className="remote-files-toolbar">
      <div><span className="eyebrow">SFTP / BROWSER</span><strong>{path}</strong></div>
      <div className="remote-files-toolbar-actions">
        <button className="outline-button" onClick={onOpenTerminal}><TerminalIcon size={14} /> Open terminal</button>
        <label className="transfer-protocol-select">Transport<select aria-label="Transfer transport" value={transferProtocol} onChange={(event) => setTransferProtocol(event.target.value as TransferProtocol)}><option value="sftp">SFTP · recommended</option><option value="scp">SCP · legacy files</option></select></label>
        <label className="transfer-protocol-select">Sort<select aria-label="Sort remote files" value={sort} onChange={(event) => setSort(event.target.value as RemoteFileSort)}><option value="name">Name</option><option value="type">Type</option><option value="size">Size</option><option value="modified">Modified</option></select></label>
        <label className="transfer-protocol-select">Open text as<select aria-label="Encoding for opening remote text files" value={openEncoding} onChange={(event) => setOpenEncoding(event.target.value as RemoteTextDocument["encoding"])}><option value="utf-8">UTF-8</option><option value="windows-1252">Windows-1252</option></select></label>
        <label className="remote-files-hidden"><input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} /> Hidden</label>
        <button className="outline-button" onClick={onCreateDirectory} disabled={status !== "ready"}><FolderPlus size={14} /> New folder</button>
        <button className="outline-button" onClick={() => onUpload(transferProtocol, "files")} disabled={status !== "ready"}><Upload size={14} /> Upload files</button>
        <button className="outline-button" onClick={() => onUpload("sftp", "directory")} disabled={status !== "ready"}><FolderPlus size={14} /> Upload folder</button>
        <button className="outline-button" onClick={() => onNavigate(path)} disabled={status === "loading"}><RefreshCw size={14} /> {status === "loading" ? "Refreshing" : "Refresh"}</button>
      </div>
    </div>
    <div className="remote-files-meta"><span>{status === "ready" ? `${visibleEntries.length}${visibleEntries.length === entries.length ? "" : ` of ${entries.length}`} entries` : status === "error" ? "Unable to list directory" : "Streaming directory listing"}</span><span className="remote-files-safe"><ShieldCheck size={13} /> Native transport · bounded transfers</span></div>
    {localDropActive && <div className="remote-files-drop-zone" role="status"><Upload size={16} /><strong>Drop files or folders to upload with SFTP</strong><span>The destination and overwrite decision will still be confirmed.</span></div>}
    {error && <div className="remote-files-error" role="alert"><CircleX size={14} /><span>{error}</span></div>}
    <div className="remote-files-list">
      <div className="remote-file-row parent"><button className="remote-file-main" onClick={() => onNavigate(parentPath)} disabled={status !== "ready"}><span className="remote-file-icon"><Folder size={15} /></span><span>..</span><small>parent directory</small></button></div>
      {visibleEntries.map((entry) => <div className={`remote-file-row ${entry.isDirectory ? "directory" : ""}`} key={entry.path}>
        <button className="remote-file-main" onClick={() => entry.isDirectory ? onNavigate(entry.path) : undefined} aria-label={entry.isDirectory ? `Open ${entry.name}` : entry.name}>
          <span className="remote-file-icon">{entry.isDirectory ? <Folder size={15} /> : <ArrowDownToLine size={15} />}</span><span>{entry.name}</span><small>{remoteEntryDetails(entry)}</small>
        </button>
        <button className="remote-file-action" onClick={() => onDownload(entry, entry.isDirectory ? "sftp" : transferProtocol)} title={`${entry.isDirectory ? "Download directory" : "Download"} ${entry.name}`} aria-label={`${entry.isDirectory ? "Download directory" : "Download"} ${entry.name}`}><Download size={14} /></button>
        {entry.isRegular && <button className="remote-file-action" onClick={() => onEdit(entry, openEncoding)} title={`Edit ${entry.name} as ${openEncoding}`} aria-label={`Edit ${entry.name}`}><Pencil size={14} /></button>}
        <button className="remote-file-action" onClick={() => onCopyPath(entry)} title={`Copy path for ${entry.name}`} aria-label={`Copy path for ${entry.name}`}><Copy size={14} /></button>
        <button className="remote-file-action" onClick={() => onSetPermissions(entry)} title={`Change permissions for ${entry.name}`} aria-label={`Change permissions for ${entry.name}`}><Settings2 size={14} /></button>
        <button className="remote-file-action" onClick={() => onRename(entry)} title={`Rename ${entry.name}`} aria-label={`Rename ${entry.name}`}><Pencil size={14} /></button>
        <button className="remote-file-action danger" onClick={() => onDelete(entry)} title={`Delete ${entry.name}`} aria-label={`Delete ${entry.name}`}><Trash2 size={14} /></button>
      </div>)}
      {status === "ready" && entries.length === 0 && <div className="remote-files-empty">This directory is empty.</div>}
    </div>
    {transfers.length > 0 && <TransferPanel transfers={transfers} onCancelTransfer={onCancelTransfer} onRetryTransfer={onRetryTransfer} />}
    <div className="remote-files-note">SFTP is the default and supports bounded recursive transfers. SCP is available for single-file compatibility transfers; directories always use SFTP. Individual files commit from temporary local or remote paths, and cancellation never presents a partial local file as complete.</div>
  </section>;
}

function RemoteEditorModal({ document, onClose, onReload, onSave, onSaveAs }: { document: RemoteTextDocument; onClose: () => void; onReload: (dirty: boolean) => Promise<RemoteTextDocument | null>; onSave: (content: string, encoding: RemoteTextDocument["encoding"]) => Promise<void>; onSaveAs: (path: string, content: string, encoding: RemoteTextDocument["encoding"], overwrite: boolean) => Promise<void> }) {
  const highlightRef = useRef<HTMLPreElement>(null);
  const [content, setContent] = useState(document.content);
  const [encoding, setEncoding] = useState<RemoteTextDocument["encoding"]>(document.encoding);
  const [searchQuery, setSearchQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = content !== document.content || encoding !== document.encoding;
  const lineCount = content.split(/\r?\n/).length;
  const matchCount = countTextMatches(content, searchQuery, matchCase);
  const language = remoteEditorLanguage(document.path);

  const close = async () => {
    if (busy) return;
    if (dirty && !await confirmAction("Discard unsaved remote changes?")) return;
    onClose();
  };

  const reload = async () => {
    setBusy(true);
    try {
      const reloaded = await onReload(dirty);
      if (!reloaded) return;
      // The same server revision keeps this component mounted: reset it too.
      setContent(reloaded.content);
      setEncoding(reloaded.encoding);
      setError(null);
    } catch (reloadError) {
      setError(String(reloadError));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!dirty) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(content, encoding);
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setBusy(false);
    }
  };

  const replaceAll = () => {
    if (!searchQuery) return;
    setContent((current) => replaceTextMatches(current, searchQuery, replacement, matchCase));
  };

  const saveAs = async () => {
    const target = await promptText("Remote target path", document.path);
    if (!target?.trim() || target === document.path) return;
    const overwrite = await chooseOverwrite("Choose how an existing remote target should be handled. Replace promotes a complete file with a recovery copy; Create only refuses an existing target.");
    if (overwrite === null) return;
    setBusy(true);
    setError(null);
    try {
      await onSaveAs(target, content, encoding, overwrite);
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setBusy(false);
    }
  };

  const syncHighlightScroll = (event: ReactUIEvent<HTMLTextAreaElement>) => {
    if (!highlightRef.current) return;
    highlightRef.current.scrollTop = event.currentTarget.scrollTop;
    highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
  };

  return <div className="palette-backdrop" role="presentation" onMouseDown={close}><section className="remote-editor-modal" role="dialog" aria-modal="true" aria-label={`Edit ${document.path}`} onMouseDown={(event) => event.stopPropagation()}>
    <div className="session-editor-heading"><div><span className="eyebrow">REMOTE FILE / {encoding.toUpperCase()}</span><h2>{document.path}</h2><p>Bounded editor buffer · {formatBytes(document.size)} · revision {document.revision.slice(0, 18)}…</p></div><button type="button" className="icon-button" aria-label="Close remote editor" onClick={close} disabled={busy}><X size={17} /></button></div>
    <div className="remote-editor-toolbar"><div className="remote-editor-search"><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Find" aria-label="Find in remote file" /><input value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder="Replace with" aria-label="Replacement text" /><label className="remote-editor-case"><input type="checkbox" checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} /> Aa</label><button type="button" className="outline-button" onClick={replaceAll} disabled={!searchQuery || matchCount === 0 || busy}>Replace all</button><span>{searchQuery ? `${matchCount.toLocaleString()} match${matchCount === 1 ? "" : "es"}` : "Search"}</span></div><div className="remote-editor-meta"><label>Save encoding<select value={encoding} onChange={(event) => setEncoding(event.target.value as RemoteTextDocument["encoding"])} aria-label="Remote file save encoding" disabled={busy}><option value="utf-8">UTF-8</option><option value="windows-1252">Windows-1252</option></select></label><span>{lineCount.toLocaleString()} lines</span><span className={dirty ? "remote-editor-dirty" : ""}>{dirty ? "Unsaved changes" : "No local changes"}</span></div></div>
    {error && <div className="connect-error remote-editor-error" role="alert"><CircleX size={14} /><span>{error.includes("changed since") ? "The remote file changed after it was opened. Reload it before saving to avoid overwriting someone else’s work." : error.includes("target already exists") ? "That remote target already exists. Choose Replace when using Save as if overwriting is intentional." : error}</span></div>}
    {document.backupCleanupFailed && <div className="remote-editor-save-warning" role="status"><ShieldCheck size={14} /><span>{remoteEditorSaveNotice(document.path, true)}</span></div>}
    <div className="remote-editor-code-shell">
      <pre ref={highlightRef} className="remote-editor-highlight" aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlightRemoteCode(content, language) }} />
      <textarea className="remote-editor-textarea" value={content} onChange={(event) => setContent(event.target.value)} onScroll={syncHighlightScroll} spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-label="Remote file contents" disabled={busy} />
    </div>
    <div className="session-editor-footer"><span className="remote-editor-safety"><ShieldCheck size={13} /> Conflict check + recovery copy</span><div><button type="button" className="outline-button" onClick={close} disabled={busy}>Close</button><button type="button" className="outline-button" onClick={() => void reload()} disabled={busy}>Reload from server</button><button type="button" className="outline-button" onClick={() => void saveAs()} disabled={busy}>{busy ? "Working…" : "Save as"}</button><button type="button" className="primary-button" onClick={() => void save()} disabled={busy || !dirty}>{busy ? "Saving…" : "Save remote file"}</button></div></div>
  </section></div>;
}

function TransferManagerView({ transfers, onCancelTransfer, onRetryTransfer }: { transfers: SshTransferEvent[]; onCancelTransfer: (transferId: string) => void; onRetryTransfer: (transfer: SshTransferEvent) => void }) {
  const active = transfers.filter((transfer) => !["completed", "cancelled", "failed"].includes(transfer.state)).length;
  const completed = transfers.filter((transfer) => transfer.state === "completed").length;
  return <section className="transfer-manager" aria-label="Global transfer manager">
    <div className="transfer-manager-heading"><div><span className="eyebrow">WORKSPACE / TRANSFERS</span><strong>Global transfer manager</strong><p>All SFTP and SCP jobs share one bounded queue. Each job can be cancelled without presenting a partial file as complete.</p></div><div className="transfer-manager-summary"><span><b>{active}</b> active</span><span><b>{completed}</b> completed</span><span><b>{transfers.length}</b> retained</span></div></div>
    <div className="transfer-manager-meta"><span>Latest jobs across every SSH session</span><span className="remote-files-safe"><ShieldCheck size={13} /> Native transport · bounded concurrency</span></div>
    <TransferPanel transfers={transfers} onCancelTransfer={onCancelTransfer} onRetryTransfer={onRetryTransfer} />
    <div className="transfer-manager-note">Transfers are retained in memory for the current application run. Source and destination paths are displayed for operator review; secrets are never included in transfer events.</div>
  </section>;
}

function AuditHistoryView({ events, onClear }: { events: AuditEvent[]; onClear: () => void }) {
  return <section className="audit-manager" aria-label="Local audit history">
    <div className="audit-manager-heading"><div><span className="eyebrow">LOCAL / AUDIT</span><strong>Audit history</strong><p>Bounded lifecycle facts only. Terminal commands, remote paths, hostnames, errors, and credential material are never recorded.</p></div><button type="button" className="outline-button danger-button" onClick={onClear} disabled={events.length === 0}><Trash2 size={14} /> Clear history</button></div>
    <div className="audit-manager-meta"><span>{events.length} of 1,000 events retained</span><span className="remote-files-safe"><ShieldCheck size={13} /> Separate from sessions and vault</span></div>
    {events.length === 0 ? <div className="audit-empty"><History size={22} /><strong>No audit events yet</strong><span>Connection and transfer lifecycle events will appear here without recording terminal input.</span></div> : <div className="audit-list">{events.slice().reverse().map((event) => <div className="audit-row" key={event.id}><div className="audit-row-icon"><History size={15} /></div><div className="audit-row-copy"><strong>{auditEventLabel(event.kind)}</strong><small>{event.protocol ?? "LOCAL"} · {new Date(event.timestamp * 1000).toLocaleString()}</small></div></div>)}</div>}
    <div className="audit-manager-note">Audit history is local and bounded. It is not included in secret-free session exports and never becomes a terminal transcript.</div>
  </section>;
}

function auditEventLabel(kind: AuditEventKind): string {
  if (kind === "sessionOpened") return "Session opened";
  if (kind === "connectionSucceeded") return "Connection succeeded";
  if (kind === "connectionFailed") return "Connection failed";
  if (kind === "disconnected") return "Disconnected";
  if (kind === "transferCompleted") return "Transfer completed";
  return "Transfer failed";
}

function TransferPanel({ transfers, onCancelTransfer, onRetryTransfer }: { transfers: SshTransferEvent[]; onCancelTransfer: (transferId: string) => void; onRetryTransfer: (transfer: SshTransferEvent) => void }) {
  return <section className="transfer-panel" aria-label="Transfers"><div className="transfer-panel-heading"><span className="eyebrow">TRANSFER QUEUE</span><span>{transfers.length} retained</span></div>{transfers.length === 0 && <div className="transfer-empty"><ArrowDownToLine size={20} /><strong>No transfers yet</strong><span>Start an upload or download from a connected SSH session. Jobs will appear here across all sessions.</span></div>}{transfers.slice().reverse().map((transfer) => {
    const percent = transfer.totalBytes && transfer.totalBytes > 0 ? Math.min(100, Math.round((transfer.bytesTransferred / transfer.totalBytes) * 100)) : null;
    const active = !["completed", "cancelled", "failed"].includes(transfer.state);
    const retryable = transfer.state === "failed" || transfer.state === "cancelled";
    return <div className="transfer-row" key={transfer.transferId}><div className="transfer-row-icon">{transfer.state === "completed" ? <CheckCircle2 size={15} /> : transfer.state === "failed" ? <CircleX size={15} /> : <LoaderCircle className={active ? "spin" : ""} size={15} />}</div><div className="transfer-row-copy"><strong>{transfer.direction === "download" ? "↓" : "↑"} {transfer.destination.split(/[\\/]/).pop() || transfer.destination}</strong><small>{transfer.protocol.toUpperCase()} · {transfer.state} · {formatBytes(transfer.bytesTransferred)}{transfer.totalBytes ? ` / ${formatBytes(transfer.totalBytes)}` : ""}{percent === null ? "" : ` · ${percent}%`}{transfer.bytesPerSecond ? ` · ${formatBytesPerSecond(transfer.bytesPerSecond)}` : ""}{active && transfer.etaSeconds != null ? ` · ETA ${formatTransferEta(transfer.etaSeconds)}` : ""}</small><small className="transfer-paths" title={`${transfer.source} → ${transfer.destination}`}>{transfer.source} → {transfer.destination}</small>{transfer.error && <small className="transfer-error">{transfer.error}</small>}<div className="transfer-progress"><span style={{ width: `${percent ?? (active ? 8 : 100)}%` }} /></div></div>{active ? <button className="transfer-cancel" onClick={() => onCancelTransfer(transfer.transferId)} aria-label="Cancel transfer" title="Cancel transfer"><CircleX size={14} /></button> : retryable ? <button className="transfer-cancel" onClick={() => onRetryTransfer(transfer)} aria-label="Retry transfer" title="Retry transfer"><RefreshCw size={14} /></button> : null}</div>;
  })}</section>;
}

function TunnelDialog({ kind, onClose, onStart }: { kind: "local" | "remote" | "dynamic"; onClose: () => void; onStart: (request: { bindHost: string; bindPort: number; targetHost?: string; targetPort?: number }) => Promise<void> }) {
  const [bindHost, setBindHost] = useState("127.0.0.1");
  const [bindPort, setBindPort] = useState("0");
  const [targetHost, setTargetHost] = useState("127.0.0.1");
  const [targetPort, setTargetPort] = useState(kind === "remote" ? "3000" : "5432");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = kind === "dynamic" ? "New SOCKS5 proxy" : `New ${kind} forward`;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const listener = parseTunnelPort(bindPort, true);
    const target = kind === "dynamic" ? undefined : parseTunnelPort(targetPort, false);
    if (!bindHost.trim() || listener == null || (kind !== "dynamic" && (!targetHost.trim() || target == null))) {
      setError("Enter a bind host and port 0–65535. A target requires a host and port 1–65535.");
      return;
    }
    setBusy(true); setError(null);
    try { await onStart({ bindHost: bindHost.trim(), bindPort: listener, ...(kind === "dynamic" ? {} : { targetHost: targetHost.trim(), targetPort: target! }) }); }
    catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  };
  return <div className="palette-backdrop" role="presentation" onMouseDown={() => { if (!busy) onClose(); }}>
    <form className="quick-connect" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => void submit(event)} onKeyDown={(event) => { if (event.key === "Escape" && !busy) onClose(); }}>
      <div className="session-editor-heading"><div><span className="eyebrow">SSH / PORT FORWARDING</span><h2>{title}</h2><p>{kind === "remote" ? "Listen on the SSH server and reach a service from this computer." : kind === "dynamic" ? "Create a local SOCKS5 listener through this SSH session." : "Listen on this computer and reach a service from the SSH server."}</p></div><button type="button" className="icon-button" aria-label="Close tunnel dialog" disabled={busy} onClick={onClose}><X size={17} /></button></div>
      <div className="quick-connect-grid">
        <label>{kind === "remote" ? "Remote" : "Local"} bind host<input autoFocus required value={bindHost} onChange={(event) => setBindHost(event.target.value)} /></label>
        <label>Bind port (0 = automatic)<input required inputMode="numeric" value={bindPort} onChange={(event) => setBindPort(event.target.value)} /></label>
        {kind !== "dynamic" && <><label>{kind === "remote" ? "Local" : "Remote"} target host<input required value={targetHost} onChange={(event) => setTargetHost(event.target.value)} /></label><label>Target port<input required inputMode="numeric" value={targetPort} onChange={(event) => setTargetPort(event.target.value)} /></label></>}
      </div>
      <p className="quick-connect-hint">Loopback is the default. Choose a broader bind address only when you intend to expose the listener.</p>
      {error && <p role="alert" className="connection-error">{error}</p>}
      <div className="session-editor-footer"><span>Bound to the selected SSH connection</span><div><button type="button" className="outline-button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={busy}>{busy ? "Starting…" : "Start tunnel"}</button></div></div>
    </form>
  </div>;
}

function TunnelView({ tunnels, onNewTunnel, onNewDynamicForward, onNewRemoteForward, onCancelTunnel }: { tunnels: SshTunnelEvent[]; onNewTunnel: () => void; onNewDynamicForward: () => void; onNewRemoteForward: () => void; onCancelTunnel: (tunnelId: string) => void }) {
  return <section className="tunnel-view" aria-label="SSH tunnel manager">
    <div className="tunnel-view-toolbar">
      <div><span className="eyebrow">SSH / PORT FORWARDING</span><strong>Port forwarding</strong><p>Choose the direction explicitly. Listeners stay bounded and every tunnel can be stopped.</p></div>
      <div className="tunnel-view-actions"><button className="outline-button" onClick={onNewDynamicForward}><Network size={14} /> New SOCKS5 proxy</button><button className="outline-button" onClick={onNewRemoteForward}><ArrowUpFromLine size={14} /> New remote forward</button><button className="primary-button" onClick={onNewTunnel}><Plus size={14} /> New local forward</button></div>
    </div>
    <div className="tunnel-view-meta"><span>{tunnels.length} recent tunnel{tunnels.length === 1 ? "" : "s"}</span><span className="remote-files-safe"><ShieldCheck size={13} /> Native direct-tcpip · max 16 clients</span></div>
    {tunnels.length === 0 ? <div className="tunnel-empty"><Network size={19} /><strong>No tunnels yet</strong><span>Create a local, remote, or SOCKS5 tunnel through this SSH session.</span><div className="tunnel-empty-actions"><button className="outline-button" onClick={onNewTunnel}><Plus size={14} /> Create local forward</button><button className="outline-button" onClick={onNewRemoteForward}><ArrowUpFromLine size={14} /> Create remote forward</button><button className="outline-button" onClick={onNewDynamicForward}><Network size={14} /> Create SOCKS5 proxy</button></div></div> : <div className="tunnel-list">{tunnels.slice().reverse().map((tunnel) => {
      const active = !["stopped", "failed"].includes(tunnel.state);
      const stateIcon = tunnel.state === "failed" ? <CircleX size={15} /> : tunnel.state === "stopped" ? <CheckCircle2 size={15} /> : <LoaderCircle className={active ? "spin" : ""} size={15} />;
      const remote = tunnel.kind === "remote";
      const dynamic = tunnel.kind === "dynamic";
      return <article className={`tunnel-row tunnel-${tunnel.state}`} key={tunnel.tunnelId}>
        <div className="tunnel-row-icon">{stateIcon}</div>
        <div className="tunnel-row-copy"><div className="tunnel-endpoints"><strong>{tunnel.localHost}:{tunnel.localPort}</strong><span>{remote ? "⇢" : "→"}</span><strong>{dynamic ? "SOCKS5" : `${tunnel.targetHost}:${tunnel.targetPort}`}</strong></div><small>{remote ? "remote listener → local target" : dynamic ? "local SOCKS5 proxy" : "local listener → remote target"} · {tunnel.state} · {tunnel.connections} connection{tunnel.connections === 1 ? "" : "s"} · {formatBytes(tunnel.bytesForwarded)} forwarded</small>{tunnel.error && <small className="tunnel-error">{tunnel.error}</small>}</div>
        {active && <button className="transfer-cancel" onClick={() => onCancelTunnel(tunnel.tunnelId)} aria-label="Stop tunnel" title="Stop tunnel"><CircleX size={14} /></button>}
      </article>;
    })}</div>}
    <div className="tunnel-view-note">Local forwarding listens only on the bind address you choose. The remote target is resolved from the SSH server, and tunnel output is not interpreted as terminal HTML.</div>
  </section>;
}

function RemoteMonitorView({ snapshot, status, error, live, intervalSeconds, onLiveChange, onIntervalChange, onRefresh }: { snapshot: RemoteMonitorSnapshot | null; status: "idle" | "loading" | "ready" | "error"; error: string | null; live: boolean; intervalSeconds: number; onLiveChange: (enabled: boolean) => void; onIntervalChange: (seconds: number) => void; onRefresh: () => void }) {
  const memoryUsed = snapshot?.memoryTotalBytes != null && snapshot.memoryAvailableBytes != null
    ? Math.max(0, snapshot.memoryTotalBytes - snapshot.memoryAvailableBytes)
    : null;
  const statusLabel = status === "loading" ? "Collecting" : status === "ready" ? "Snapshot ready" : status === "error" ? "Unavailable" : "Ready";
  return <section className="remote-monitor" aria-label="Remote system monitor">
    <div className="remote-monitor-toolbar">
      <div><span className="eyebrow">SSH / SYSTEM SNAPSHOT</span><strong>Remote system monitor</strong><p>Collect a bounded read-only snapshot through the active SSH connection. Live refresh is opt-in and stops when this view closes.</p></div>
      <div className="remote-monitor-actions"><span className={`remote-monitor-status monitor-${status}`}><span /> {statusLabel}</span><label className="remote-monitor-live"><input type="checkbox" checked={live} onChange={(event) => onLiveChange(event.target.checked)} /> Live <select value={intervalSeconds} onChange={(event) => { const next = Number(event.target.value); if (isRemoteMonitorRefreshInterval(next)) onIntervalChange(next); }} disabled={!live} aria-label="Live monitor interval">{REMOTE_MONITOR_REFRESH_INTERVALS.map((seconds) => <option key={seconds} value={seconds}>{seconds}s</option>)}</select></label><button className="primary-button" onClick={onRefresh} disabled={status === "loading"}><RefreshCw className={status === "loading" ? "spin" : ""} size={14} /> {status === "loading" ? "Collecting…" : "Refresh snapshot"}</button></div>
    </div>
    {error && <div className="connect-error remote-monitor-error" role="alert"><CircleX size={14} /><span>{error}</span></div>}
    {snapshot ? <>
      <div className="remote-monitor-identity"><div><span>Host</span><strong>{snapshot.hostname ?? "Unknown host"}</strong></div><div><span>Kernel</span><strong>{snapshot.kernel ?? "Unavailable"}</strong></div><div><span>Metrics</span><strong>{snapshot.supportedMetrics.length} available</strong></div></div>
      <div className="remote-monitor-grid">
        <MonitorMetric label="Uptime" value={formatDuration(snapshot.uptimeSeconds)} detail="remote clock" />
        <MonitorMetric label="Load average" value={snapshot.loadAverage ? snapshot.loadAverage.map((value) => value.toFixed(2)).join(" · ") : "Unavailable"} detail="1 / 5 / 15 min where supported" />
        <MonitorMetric label="Memory" value={memoryUsed != null && snapshot.memoryTotalBytes != null ? `${formatBytes(memoryUsed)} / ${formatBytes(snapshot.memoryTotalBytes)}` : "Unavailable"} detail="used / total" />
        <MonitorMetric label="Available memory" value={snapshot.memoryAvailableBytes != null ? formatBytes(snapshot.memoryAvailableBytes) : "Unavailable"} detail="best-effort capability" />
        <MonitorMetric label="Root disk" value={snapshot.rootDiskUsedPercent != null ? `${snapshot.rootDiskUsedPercent}% used` : "Unavailable"} detail="/ filesystem" />
        <MonitorMetric label="Processes" value={snapshot.processCount != null ? snapshot.processCount.toLocaleString() : "Unavailable"} detail="visible process count" />
      </div>
      <div className="remote-monitor-note"><ShieldCheck size={14} /><span>Only a fixed, read-only metrics query is sent. Missing commands or platform-specific files produce unavailable fields instead of an assumed Linux result.</span></div>
    </> : <div className="remote-monitor-empty"><Gauge size={21} /><strong>{status === "error" ? "No compatible metrics returned" : "No snapshot yet"}</strong><span>{status === "error" ? "The host may not expose the standard read-only capabilities." : "Refresh to request a one-shot snapshot from this SSH session."}</span></div>}
  </section>;
}

function MonitorMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="remote-monitor-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function NetworkDiagnosticsView({ tcpPort, onTcpPortChange, pingInterval, pingPacketSize, onPingIntervalChange, onPingPacketSizeChange, mtrResult, onMtr, scanProtocol, onScanProtocolChange, host, port, timeout, status, dnsReport, dnsRecordType, onDnsRecordTypeChange, dnsServer, onDnsServerChange, result, fingerprint, error, scanId, scanStatus, scanStart, scanEnd, scanConcurrency, scanScanned, scanTotal, scanResults, diagnosticKind, diagnosticStatus, pingResult, traceMaxHops, onHostChange, onPortChange, onTimeoutChange, onTraceMaxHopsChange, onResolve, onCheckTcp, onInspectFingerprint, onPing, onCancelDiagnostic, onScanStartChange, onScanEndChange, onScanConcurrencyChange, onStartScan, onCancelScan }: {
  pingInterval: string;
  pingPacketSize: string;
  onPingIntervalChange: (value: string) => void;
  onPingPacketSizeChange: (value: string) => void;
  mtrResult: TracerouteResult | null;
  onMtr: () => void;
  scanProtocol: "tcp" | "udp";
  onScanProtocolChange: (value: "tcp" | "udp") => void;
  host: string;
  port: string;
  tcpPort: string;
  onTcpPortChange: (value: string) => void;
  timeout: string;
  status: "idle" | "running" | "ready" | "error";
  dnsReport: { tool: string; output: string; elapsedMs: number } | null;
  dnsRecordType: string;
  onDnsRecordTypeChange: (value: string) => void;
  dnsServer: string;
  onDnsServerChange: (value: string) => void;
  result: TcpConnectReport | null;
  fingerprint: SshHostKeyInspection | null;
  error: string | null;
  scanId: string | null;
  scanStatus: "idle" | "running" | "completed" | "cancelled" | "failed";
  scanStart: string;
  scanEnd: string;
  scanConcurrency: string;
  scanScanned: number;
  scanTotal: number;
  scanResults: TcpCheckResult[];
  diagnosticKind: "ping" | "mtr" | null;
  diagnosticStatus: "idle" | "running" | "completed" | "cancelled" | "failed";
  pingResult: PingResult | null;
  traceMaxHops: string;
  onHostChange: (value: string) => void;
  onPortChange: (value: string) => void;
  onTimeoutChange: (value: string) => void;
  onTraceMaxHopsChange: (value: string) => void;
  onResolve: () => void;
  onCheckTcp: () => void;
  onInspectFingerprint: () => void;
  onPing: () => void;
  onCancelDiagnostic: () => void;
  onScanStartChange: (value: string) => void;
  onScanEndChange: (value: string) => void;
  onScanConcurrencyChange: (value: string) => void;
  onStartScan: () => void;
  onCancelScan: () => void;
}) {
  type Tool = "scan" | "ping" | "mtr" | "dns" | "tcp" | "ssh";
  const [tool, setTool] = useState<Tool>("scan");
  const [follow, setFollow] = useState(true);
  const [copyNotice, setCopyNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const progress = scanProgress(scanScanned, scanTotal);
  const openPorts = openScanResults(scanResults);
  const outputRef = useRef<HTMLPreElement>(null);
  const scanActive = scanStatus === "running";
  const diagnosticActive = diagnosticStatus === "running";
  const busy = scanActive || diagnosticActive || status === "running";
  const tools: { id: Tool; label: string }[] = [{ id: "scan", label: "Port scan" }, { id: "ping", label: "Ping" }, { id: "mtr", label: "MTR" }, { id: "dns", label: "DNS" }, { id: "tcp", label: "TCP check" }, { id: "ssh", label: "SSH key" }];
  const label = tools.find(item => item.id === tool)!.label;
  const selectedStatus = tool === "scan" ? scanStatus : ["ping", "mtr"].includes(tool) ? diagnosticKind === tool ? diagnosticStatus : "idle" : status;
  const lines: string[] = [];
  if (tool === "scan") {
    lines.push(`PORT SCAN  /  ${scanProtocol.toUpperCase()}`, "");
    if (scanStatus !== "idle" || scanResults.length) {
      lines.push(`Scan ${scanId?.slice(0, 8) ?? "starting"}    ${scanStatus.toUpperCase()}    ${scanScanned}/${scanTotal} host/port checks`, "", "HOST                                     PORT       PROTOCOL   STATE", "----------------------------------------------------------------------------");
      for (const item of openPorts) lines.push(`${item.host.padEnd(41)}${String(item.port).padEnd(11)}${scanProtocol.toUpperCase().padEnd(11)}${item.status === "open-or-filtered" ? "open or filtered" : item.status.replaceAll("-", " ")}`);
      if (!openPorts.length) lines.push(scanActive ? "No open ports found yet." : "No open ports found.");
      if (scanActive) lines.push("", "Scanning…");
      else lines.push("", `${openPorts.length} open ports · ${scanScanned} host/port checks completed`, `Scan ${scanStatus}.`);
    } else lines.push("Ready. Enter a target and port range, then press Run.");
    if (scanProtocol === "udp") lines.push("", "UDP: reply = open; silence = open or filtered.", "Only confirmed open ports are listed; services may ignore empty datagrams.");
  } else if (tool === "mtr") {
    const report = mtrResult;
    lines.push("MTR  /  PACKET LOSS & LATENCY", "");
    if (report) lines.push(`Target: ${report.host}    Elapsed: ${formatElapsedTime(report.elapsedMs)}`, "", ...report.hops);
    else lines.push(diagnosticKind === tool && diagnosticActive ? "Collecting live probe cycles…" : diagnosticKind === tool && diagnosticStatus === "failed" ? "Diagnostic failed." : "Ready. Enter a target, then press Run.");
    if (diagnosticKind === tool && diagnosticStatus === "cancelled") lines.push("", "Cancelled.");
  } else if (tool === "ping") {
    lines.push("PING", "");
    if (pingResult) {
      const loss = pingResult.sent ? ((pingResult.sent - pingResult.received) / pingResult.sent * 100).toFixed(1) : "0.0";
      lines.push(`Target: ${pingResult.host}    Payload: ${pingResult.packetSize} bytes    Interval: ${pingResult.intervalMs} ms`, "", ...pingResult.lines, "", `Sent: ${pingResult.sent}    Successful probes: ${pingResult.received}    Loss: ${loss}%    Elapsed: ${formatElapsedTime(pingResult.elapsedMs)}`);
    }
    else lines.push(diagnosticKind === "ping" && diagnosticActive ? "Waiting for echo reply…" : "Ready. Enter a target, then press Run.");
    if (diagnosticKind === "ping" && diagnosticStatus === "cancelled") lines.push("", "Cancelled.");
  } else if (tool === "dns") {
    if (dnsReport) lines.push(`;; ${dnsReport.tool} · ${dnsReport.elapsedMs} ms`, "", dnsReport.output);
    else lines.push("DNS LOOKUP", "", status === "running" ? "Querying DNS…" : "Ready. Enter a hostname or IP, choose a record type, then press Run.");
  } else if (tool === "tcp") {
    if (result) lines.push(result.output);
    else lines.push("TCP CONNECT DIAGNOSTIC", "", `Target: ${host.trim() || "Not entered"}`, `Port: ${tcpPort} / TCP`, `Timeout: ${timeout} ms`, "", status === "running" ? "Resolving addresses and attempting TCP connections…" : "Ready. Enter a target and port, then press Run.", "", "Reports resolved addresses, connection attempts, timing, socket endpoints and errors.", "Tests TCP connectivity without sending application data.");
  } else {
    lines.push("SSH HOST KEY", "", ...(fingerprint ? [`Target: ${fingerprint.host}:${fingerprint.port}`, fingerprint.fingerprint, "", "Observed only; host trust has not been changed."] : [status === "running" ? "Inspecting host key…" : "Ready. Enter an SSH target and port, then press Run."]));
  }
  if (error) lines.push("", `ERROR: ${error}`);
  const output = lines.join("\n");
  useEffect(() => {
    if (follow && outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [follow, output]);
  const run = () => {
    setFollow(true); setCopyNotice(""); setExportNotice("");
    ({ scan: onStartScan, ping: onPing, mtr: onMtr, dns: onResolve, tcp: onCheckTcp, ssh: onInspectFingerprint })[tool]();
  };
  const exportOutput = async () => {
    if (exporting) return;
    setExporting(true); setExportNotice("");
    // Capture the displayed report now; a live test may keep producing output.
    const snapshot = output;
    const fileName = `conxol-${tool}-${new Date().toISOString().replaceAll(":", "-")}.txt`;
    try {
      if (IS_TAURI) {
        const saved = await invoke<boolean>("network_diagnostic_output_export", { tool, content: snapshot });
        if (saved) setExportNotice("Text output saved.");
      } else {
        const url = URL.createObjectURL(new Blob([snapshot], { type: "text/plain;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = fileName;
        document.body.append(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setExportNotice("Text output downloaded.");
      }
    } catch { setExportNotice("Could not save text output. Try another destination."); }
    finally { setExporting(false); }
  };
  return <section className="diagnostics-cli" aria-label="Network diagnostics">
    <nav className="diagnostics-cli-tools" aria-label="Diagnostic tool">{tools.map(item => <button key={item.id} type="button" aria-pressed={tool === item.id} disabled={busy && item.id !== tool} onClick={() => { setTool(item.id); setCopyNotice(""); setExportNotice(""); setFollow(true); }}>{item.label}</button>)}</nav>
    <form className="diagnostics-cli-controls" onSubmit={event => { event.preventDefault(); if (!busy) run(); }}>
      <label className="diagnostics-cli-host">Target<input required value={host} disabled={busy} onChange={event => onHostChange(event.target.value)} placeholder={tool === "scan" ? "IP, CIDR (192.0.2.0/24), or hostname" : "Hostname or IP address"} /></label>
      {tool === "scan" && <>
        <label>Protocol<select value={scanProtocol} disabled={busy} onChange={event => onScanProtocolChange(event.target.value as "tcp" | "udp")}><option value="tcp">TCP</option><option value="udp">UDP</option></select></label>
        <label>From<input type="number" min="1" max="65535" required value={scanStart} disabled={busy} onChange={event => onScanStartChange(event.target.value)} /></label>
        <label>To<input type="number" min="1" max="65535" required value={scanEnd} disabled={busy} onChange={event => onScanEndChange(event.target.value)} /></label>
        <label>Workers<input type="number" min="1" max="128" required value={scanConcurrency} disabled={busy} onChange={event => onScanConcurrencyChange(event.target.value)} /></label>
      </>}
      {tool === "dns" && <>
        <label>Record<select value={dnsRecordType} disabled={busy} onChange={event => onDnsRecordTypeChange(event.target.value)}>{["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA", "PTR", "SRV", "CAA"].map(type => <option key={type}>{type}</option>)}</select></label>
        <label className="diagnostics-dns-server">DNS server<input value={dnsServer} disabled={busy} onChange={event => onDnsServerChange(event.target.value)} placeholder="System default" title="Optional IPv4 or IPv6 resolver address" /></label>
      </>}
      {(tool === "tcp" || tool === "ssh") && <label>Port<input type="number" min="1" max="65535" required value={tool === "tcp" ? tcpPort : port} disabled={busy} onChange={event => (tool === "tcp" ? onTcpPortChange : onPortChange)(event.target.value)} /></label>}
      {tool === "ping" && <>
        <label>Interval (ms)<input type="number" min="200" max="60000" required value={pingInterval} disabled={busy} onChange={event => onPingIntervalChange(event.target.value)} /></label>
        <label>Packet (bytes)<input type="number" min="0" max="65500" required value={pingPacketSize} disabled={busy} onChange={event => onPingPacketSizeChange(event.target.value)} title="ICMP payload size, excluding headers" /></label>
      </>}
      {(tool === "mtr") && <label>Max hops<input type="number" min="1" max="32" required value={traceMaxHops} disabled={busy} onChange={event => onTraceMaxHopsChange(event.target.value)} /></label>}
      {tool !== "mtr" && <label>Timeout (ms)<input type="number" min="50" max="60000" required value={timeout} disabled={busy} onChange={event => onTimeoutChange(event.target.value)} /></label>}
      {scanActive || diagnosticActive ? <button type="button" className="outline-button" onClick={scanActive ? onCancelScan : onCancelDiagnostic}><Square size={14} /> Stop</button> : <button type="submit" className="primary-button" disabled={busy}><Play size={14} /> Run</button>}
    </form>
    {tool === "scan" && scanStatus !== "idle" && <div className="diagnostics-scan-progress">
      <div><span>{scanActive ? progress.total ? "Scanning" : "Preparing scan…" : `Scan ${scanStatus}`}</span><span>{progress.total ? `${progress.completed} / ${progress.total} checks · ${progress.percent}%` : scanActive ? "Waiting for scan total" : "0 checks"}</span></div>
      <progress aria-label="Port scan progress" max={progress.total || 1} value={progress.total ? progress.completed : scanActive ? undefined : 0} />
    </div>}
    <div className="diagnostics-cli-console">
      <div className="diagnostics-cli-console-bar"><span>{label} <span className="diagnostics-cli-state">/ {selectedStatus}</span></span><div><button type="button" aria-pressed={follow} onClick={() => setFollow(value => !value)}>Follow {follow ? "on" : "off"}</button><button type="button" onClick={() => { void writeClipboardText(output).then(() => setCopyNotice("Copied"), () => setCopyNotice("Copy failed")); }}>{copyNotice || "Copy output"}</button><button type="button" disabled={exporting} onClick={() => void exportOutput()}>{exporting ? "Saving…" : "Export text"}</button></div></div>
      {exportNotice && <p className="diagnostics-export-notice" role="status">{exportNotice}</p>}
      <pre ref={outputRef} className="diagnostics-cli-output" tabIndex={0} aria-label={`${label} output`} onScroll={event => { const element = event.currentTarget; if (element.scrollHeight - element.scrollTop - element.clientHeight > 40) setFollow(false); }}>{output}</pre>
    </div>
    <footer className="diagnostics-cli-footer"><span>{tool === "scan" ? "IP or CIDR · Up to 256 hosts, 4096 ports, 65536 checks" : tool === "ping" ? "Native IPv4 Ping · Interval between probe starts · Payload size excludes headers" : tool === "mtr" ? "Live until stopped · Cumulative hop statistics · Native IPv4 MTR" : "Run against the selected target"}</span><span>{busy ? "Working…" : "Select a tool · Enter a target · Run"}</span></footer>
  </section>;
}

function formatRemoteModified(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "modified unknown";
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? "modified unknown" : `modified ${date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })}`;
}

function remoteEntryDetails(entry: RemoteEntry) {
  const details = [
    entry.isDirectory ? "directory" : entry.isSymlink ? "symlink" : entry.isRegular ? (entry.size == null ? "size unknown" : formatBytes(entry.size)) : "special file",
    formatRemoteModified(entry.modifiedUnixSeconds),
    formatRemotePermissions(entry.permissions),
    formatRemoteOwner(entry),
  ].filter(Boolean);
  return details.join(" · ");
}

function formatRemotePermissions(permissions?: number | null) {
  if (permissions == null || !Number.isFinite(permissions)) return null;
  return `mode ${((permissions >>> 0) & 0o7777).toString(8).padStart(4, "0")}`;
}

function formatRemoteOwner(entry: RemoteEntry) {
  const owner = entry.owner?.trim() || (entry.uid != null ? `uid ${entry.uid}` : null);
  const group = entry.group?.trim() || (entry.gid != null ? `gid ${entry.gid}` : null);
  return owner && group ? `${owner}:${group}` : owner || group;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatBytesPerSecond(bytes: number) {
  return `${formatBytes(bytes)}/s`;
}

function formatTransferEta(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
}

function formatElapsedTime(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const seconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [
    days > 0 ? `${days}d` : "",
    hours > 0 || days > 0 ? `${hours}h` : "",
    minutes > 0 || hours > 0 || days > 0 ? `${minutes}m` : "",
    `${seconds % 60}s`,
  ].filter(Boolean).join(" ");
}

function formatDuration(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "Unavailable";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function EmptyProtocolView({ view, onAction }: { view: "files" | "tunnels" | "monitor"; onAction?: () => void }) {
  const isFiles = view === "files";
  const isMonitor = view === "monitor";
  return <section className="empty-protocol"><div className="empty-protocol-art"><div className="empty-ring ring-one" /><div className="empty-ring ring-two" />{isFiles ? <Folder size={24} /> : isMonitor ? <Gauge size={24} /> : <Network size={24} />}</div><span className="eyebrow">{isFiles ? "REMOTE FILES" : isMonitor ? "REMOTE MONITOR" : "NETWORK FABRIC"}</span><h2>{isFiles ? "Open an SSH session to browse files" : isMonitor ? "Connect an SSH session to inspect it" : "No tunnels are active"}</h2><p>{isFiles ? "SFTP listing, streaming transfers, cancellation, and path safety are ready for a connected SSH session." : isMonitor ? "The monitor sends a single bounded read-only query and leaves unsupported platform metrics blank." : "Create a tunnel from a connected SSH session. The manager will expose endpoints, ownership, state, and byte counts."}</p>{onAction ? <button className="outline-button" onClick={onAction}><Network size={14} /> Quick connect</button> : <button className="outline-button" disabled><Settings2 size={14} /> Delivery map</button>}</section>;
}

function InfoCard({ icon: Icon, label, title, detail, action, onAction }: { icon: LucideIcon; label: string; title: string; detail: string; action: string; onAction: () => void }) {
  return <article className="info-card"><div className="info-card-top"><span className="info-icon"><Icon size={15} /></span><span>{label}</span><button aria-label={`More information about ${label}`} title={`More information about ${label}`} onClick={onAction}><MoreHorizontal size={15} /></button></div><h3>{title}</h3><p>{detail}</p><button className="text-button" onClick={onAction}>{action} <ExternalLink size={12} /></button></article>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function HelpModal({ mode, keyboard, onClose, onExportDiagnostics }: { mode: "help" | "about"; keyboard: AppSettings["keyboard"]; onClose: () => void; onExportDiagnostics: () => Promise<boolean> }) {
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [diagnosticsMessage, setDiagnosticsMessage] = useState("");
  const [diagnosticsError, setDiagnosticsError] = useState("");
  const exportReport = async () => {
    if (diagnosticsBusy) return;
    setDiagnosticsBusy(true); setDiagnosticsMessage(""); setDiagnosticsError("");
    try { const saved = await onExportDiagnostics(); setDiagnosticsMessage(saved ? "Diagnostics saved." : "Export cancelled."); }
    catch (cause) { setDiagnosticsError(String(cause)); }
    finally { setDiagnosticsBusy(false); }
  };
  const tabs = ["Overview", "Shortcuts"] as const;
  const [tab, setTab] = useState<typeof tabs[number] | "About">(mode === "about" ? "About" : "Overview");
  const shortcuts: Array<[string, string]> = [
    ["New terminal", keyboard.newTerminal], ["New session", keyboard.quickConnect],
    ["Command palette", keyboard.commandPalette], ["Close tab", keyboard.closeTab],
    ["Next tab", keyboard.nextTab], ["Previous tab", keyboard.previousTab],
    ["Split right", keyboard.splitRight], ["Split down", keyboard.splitDown],
    ["Focus pane", keyboard.focusPane], ["Search terminal", keyboard.searchTerminal],
    ["Toggle sidebar", keyboard.toggleSidebar], ["Open macros", keyboard.openMacros],
    ["Stop broadcast", keyboard.emergencyBroadcastDisable],
  ];
  return <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="help-modal help-compact" role="dialog" aria-modal="true" aria-label={mode === "about" ? "About" : "Conxol help"} onMouseDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <header className="help-header">
        <div className="help-brand"><div className="desktop-home-logo" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path className="conxol-mark-frame" d="M36 10H22a14 14 0 0 0 0 28h14" /><path className="conxol-mark-prompt" d="m21 19 6 5-6 5m10 1h7" /></svg></div><div><h2>Conxol</h2><p>Your network, in command</p></div></div>
        <button autoFocus type="button" className="icon-button" aria-label={mode === "about" ? "Close about" : "Close help"} onClick={onClose}><X size={16} /></button>
      </header>
      {mode === "help" && <div className="help-tabs" role="tablist" aria-label="Help topics">
        {tabs.map((item, index) => <button key={item} type="button" id={`help-tab-${item}`} role="tab" aria-selected={tab === item} aria-controls={`help-panel-${item}`} tabIndex={tab === item ? 0 : -1} onClick={() => setTab(item)} onKeyDown={event => {
          let next = index;
          if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
          else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = tabs.length - 1;
          else return;
          event.preventDefault(); setTab(tabs[next]); document.getElementById(`help-tab-${tabs[next]}`)?.focus();
        }}>{item}</button>)}
      </div>}
      <div className="help-body">
        <section className="help-panel" id="help-panel-Overview" role="tabpanel" aria-labelledby="help-tab-Overview" hidden={tab !== "Overview"}>
          <h3>Get started</h3>
          <div className="help-guide"><Plus size={16} /><div><strong>Open a session</strong><p>Use the + tab to choose SSH, Telnet, Serial, or a remote desktop. Start a local shell from Home.</p></div></div>
          <div className="help-guide"><Folder size={16} /><div><strong>Organize your hosts</strong><p>Create folders in the sidebar and drag saved hosts into them. Right-click a host to edit its settings. Empty folders can be deleted.</p></div></div>
          <div className="help-guide"><Search size={16} /><div><strong>Find your way</strong><p>Search saved hosts in the sidebar. Use terminal search for output, split panes to work side by side, and the command palette for quick actions.</p></div></div>
          <div className="help-tip"><ShieldCheck size={14} /><p>Review SSH fingerprints before trusting a new host. Multiline paste asks for confirmation. Telnet and serial traffic are unencrypted.</p></div>
        </section>
        <section className="help-panel" id="help-panel-Shortcuts" role="tabpanel" aria-labelledby="help-tab-Shortcuts" hidden={tab !== "Shortcuts"}>
          <h3>Keyboard shortcuts</h3>
          <div className="help-shortcuts-grid">{shortcuts.map(([label, value]) => <div key={label} className="help-shortcut"><span>{label}</span><kbd>{formatShortcut(value)}</kbd></div>)}</div>
          <p className="help-note">Change shortcuts in Settings → Shortcuts. Escape always stops broadcast.</p>
        </section>
        <section className="help-panel" id="help-panel-About" hidden={mode !== "about"}>
          <h3>About</h3>
          <p className="help-about-description">An open-source workspace for terminals, remote sessions, and everyday network operations.</p>
          <dl className="help-about-details">
            <div><dt>Maintainer</dt><dd><a href="https://github.com/thetonmoyroy" target="_blank" rel="noopener noreferrer">Tonmoy Roy <span className="help-profile-handle">@thetonmoyroy</span></a></dd></div>
            <div><dt>Version</dt><dd>{desktopPackage.version}</dd></div>
            <div><dt>License</dt><dd>Apache License 2.0</dd></div>
          </dl>
          <div className="help-diagnostics"><div><h4>Support diagnostics</h4><p>Save app information, recent SSH errors, and algorithm details for troubleshooting. Passwords, key contents, host addresses, and terminal output are excluded.</p></div><button type="button" className="outline-button" disabled={diagnosticsBusy} onClick={() => void exportReport()}><Download size={14} />{diagnosticsBusy ? "Saving…" : "Export diagnostics"}</button></div>
          <p className="help-note">For SSH issues, reproduce the failure and export before restarting Conxol. The report keeps the latest 64 failure records from this app session.</p>
          {diagnosticsMessage && <p className="help-note" role="status">{diagnosticsMessage}</p>}
          {diagnosticsError && <p className="help-diagnostics-error" role="alert">{diagnosticsError}</p>}
          <ThirdPartyCredits />
        </section>
      </div>
      <footer className="help-footer"><span>Maintained by <a href="https://github.com/thetonmoyroy" target="_blank" rel="noopener noreferrer">Tonmoy Roy</a></span><span className="help-version">v{desktopPackage.version}</span><button type="button" className="outline-button" onClick={onClose}>Done</button></footer>
    </section>
  </div>;
}

function SavedSessionPicker({ sessions, onClose, onNew, onSelect }: { sessions: SavedSession[]; onClose: () => void; onNew: () => void; onSelect: (session: SavedSession) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectionCommitted = useRef(false);
  const selectSession = (session: SavedSession) => {
    if (selectionCommitted.current) return;
    selectionCommitted.current = true;
    onSelect(session);
  };
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [view, setView] = useState<"all" | "favorites" | "recent">("all");
  const [folder, setFolder] = useState("");
  const [protocol, setProtocol] = useState("");
  const [sort, setSort] = useState("name");
  const folders = [...new Set(sessions.flatMap(session => sessionFolderAncestors(session.folder ?? "")))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const protocols = [...new Set(sessions.map(session => session.protocol))].sort();
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = sessions.filter(session => (view !== "favorites" || session.favorite) && (view !== "recent" || !!session.last_used_at)
    && (!folder || (folder === "unfiled" ? !session.folder : sessionFolderWithin(session.folder ?? "", folder.slice(7)))) && (!protocol || session.protocol === protocol)).filter(session => terms.every(term => `${session.name} ${session.hostname} ${session.username ?? ""} ${session.folder ?? ""} ${session.tags.join(" ")} ${session.protocol}`.toLowerCase().includes(term)))
    .sort((a, b) => ((sort === "recent" || view === "recent") ? (b.last_used_at ?? 0) - (a.last_used_at ?? 0) : sort === "folder" ? (a.folder ?? "").localeCompare(b.folder ?? "", undefined, { numeric: true }) : 0)
      || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  const resetFilters = () => { setQuery(""); setFolder(""); setProtocol(""); setView("all"); setActiveIndex(0); };
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { dialog?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { document.getElementById(`saved-session-choice-${activeIndex}`)?.scrollIntoView({ block: "nearest" }); }, [activeIndex, query, folder, protocol, view, sort]);
  return <dialog ref={dialogRef} className="saved-session-picker" aria-labelledby="saved-session-picker-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <header className="session-browser-top"><div className="session-browser-title"><h2 id="saved-session-picker-title">Sessions</h2><small>Choose a device to connect</small></div><button type="button" className="outline-button" onClick={onNew}><Plus size={14} /> New session</button><button type="button" aria-label="Close saved sessions" onClick={onClose}><X size={18} /></button></header>
    <div className="session-browser-toolbar">
      <div className="saved-session-search"><Search size={16} /><input autoFocus aria-label="Search saved sessions" placeholder="Search devices, addresses, folders or tags…" value={query} onChange={event => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActiveIndex(index => matches.length ? (index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length : 0); }
        if (event.key === "Enter" && matches[activeIndex]) { event.preventDefault(); if (!event.repeat) selectSession(matches[activeIndex]); }
      }} />{query && <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); setActiveIndex(0); }}><X size={14} /></button>}</div>
      <select aria-label="Filter by protocol" value={protocol} onChange={event => { setProtocol(event.target.value); setActiveIndex(0); }}><option value="">All protocols</option>{protocols.map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="Sort sessions" value={view === "recent" ? "recent" : sort} disabled={view === "recent"} onChange={event => { setSort(event.target.value); setActiveIndex(0); }}><option value="name">Name A–Z</option><option value="folder">Folder</option><option value="recent">Last used</option></select>
    </div>
    <div className="session-browser-body">
      <nav className="session-browser-folders" aria-label="Browse saved sessions">
        {([['all', 'All devices'], ['favorites', 'Favorites'], ['recent', 'Recent']] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={view === id && !folder} className={view === id && !folder ? "active" : ""} onClick={() => { setView(id); setFolder(""); setActiveIndex(0); }}>{id === "favorites" ? <Star size={14} /> : id === "recent" ? <History size={14} /> : <Server size={14} />}<span>{label}</span><small>{sessions.filter(session => id === "all" || (id === "favorites" ? session.favorite : !!session.last_used_at)).length}</small></button>)}
        <div className="session-browser-section">Folders</div>
        <button type="button" aria-pressed={folder === "unfiled"} className={folder === "unfiled" ? "active" : ""} onClick={() => { setFolder("unfiled"); setView("all"); setActiveIndex(0); }}><Folder size={14} /><span>Unfiled</span><small>{sessions.filter(session => !session.folder).length}</small></button>
        {folders.map(path => <button type="button" key={path} title={path} aria-pressed={folder === `folder:${path}`} className={folder === `folder:${path}` ? "active" : ""} style={{ paddingLeft: 12 + Math.min(path.split("/").length - 1, 8) * 12 }} onClick={() => { setFolder(`folder:${path}`); setView("all"); setActiveIndex(0); }}><Folder size={14} /><span>{path.slice(path.lastIndexOf("/") + 1)}</span><small>{sessions.filter(session => sessionFolderWithin(session.folder ?? "", path)).length}</small></button>)}
      </nav>
      <section className="session-browser-devices" aria-label="Devices">
        <div className="session-browser-context"><strong>{folder === "unfiled" ? "Unfiled" : folder ? folder.slice(7) : view === "favorites" ? "Favorites" : view === "recent" ? "Recent devices" : "All devices"}</strong><span>{matches.length} devices</span></div>
        <div className="saved-session-list-heading"><span>Device</span><span>Address</span><span>Folder</span><span>Protocol</span></div>
        <div className="saved-session-results">{matches.map((session, index) => <button type="button" id={`saved-session-choice-${index}`} key={session.id} className={index === activeIndex ? "selected" : ""} title={[session.name, session.hostname, session.folder, session.tags.join(", ")].filter(Boolean).join(" · ")} onFocus={() => setActiveIndex(index)} onClick={() => selectSession(session)}><span className="saved-device-name">{session.protocol === "LOCAL" ? <TerminalIcon size={15} /> : <Server size={15} />}<strong>{session.name}</strong>{session.favorite && <Star size={11} className="saved-device-star" />}</span><span className="saved-device-address">{session.hostname || (session.protocol === "LOCAL" ? "Local terminal" : "—")}</span><span className="saved-device-folder">{session.folder || "Unfiled"}</span><span className="saved-device-protocol">{session.protocol}</span></button>)}{!matches.length && <div className="saved-session-empty"><Search size={24} /><strong>{sessions.length ? "No matching devices" : "No saved sessions yet"}</strong><p>{sessions.length ? "Try another search or clear the filters." : "Create a new session to add your first device."}</p>{sessions.length > 0 && <button type="button" className="outline-button" onClick={resetFilters}>Clear filters</button>}</div>}</div>
      </section>
    </div>
    <footer><span aria-live="polite">{matches.length} of {sessions.length} devices</span><small>↑ ↓ navigate · Enter connect · Esc close</small></footer>
  </dialog>;
}

function CommandPalette({ keyboard, onClose, onNewTerminal, onNewShell, onNewWslTerminal, onQuickConnect, onOpenFiles, onOpenSettings, onOpenCredentials, onOpenSnippets, onOpenMacros, onOpenNotes, onOpenAudit, onToggleSidebar, onFocusPane }: { keyboard: AppSettings["keyboard"]; onClose: () => void; onNewTerminal: () => void; onNewShell: (shell: LocalShellChoice) => void; onNewWslTerminal: () => void; onQuickConnect: () => void; onOpenFiles: () => void; onOpenSettings: () => void; onOpenCredentials: () => void; onOpenSnippets: () => void; onOpenMacros: () => void; onOpenNotes: () => void; onOpenAudit: () => void; onToggleSidebar: () => void; onFocusPane: () => void }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const commands = [
    ...quickActions(keyboard)
      .filter((action) => action.label !== "Command palette")
      .map((action) => ({
        ...action,
        run: action.shell ? () => onNewShell(action.shell!) : action.label === "New local terminal" ? onNewTerminal
          : action.label === "New WSL terminal" ? onNewWslTerminal
            : action.label === "Quick connect" ? onQuickConnect
            : action.label === "Open SFTP" ? onOpenFiles
              : action.label === "Settings" ? onOpenSettings
                : action.label === "Credential vault" ? onOpenCredentials
                    : action.label === "Snippets" ? onOpenSnippets
                      : action.label === "Notes" ? onOpenNotes
                      : action.label === "Macros" ? onOpenMacros
                        : action.label === "Audit history" ? onOpenAudit
                          : action.label === "Focus pane" ? onFocusPane
                          : onClose,
      })),
    { label: "Toggle sidebar", hint: formatShortcut(keyboard.toggleSidebar), icon: PanelLeftClose, run: onToggleSidebar },
  ].filter((action) => action.label.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => setActiveIndex(0), [query]);

  const execute = (index: number) => {
    const action = commands[index];
    if (!action) return;
    action.run();
    onClose();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => commands.length === 0 ? 0 : (index + 1) % commands.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => commands.length === 0 ? 0 : (index - 1 + commands.length) % commands.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      execute(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return <div className="palette-backdrop" role="presentation" onMouseDown={onClose}><section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}><div className="palette-search"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleKeyDown} placeholder="Search commands" aria-label="Search commands" aria-controls="command-palette-list" aria-activedescendant={commands[activeIndex] ? `command-${activeIndex}` : undefined} /><kbd>ESC</kbd></div><div className="palette-section-label">Actions</div>{commands.length > 0 ? <div id="command-palette-list" role="listbox" aria-label="Available commands">{commands.map((action, index) => { const ActionIcon = action.icon; return <button key={action.label} id={`command-${index}`} type="button" role="option" aria-selected={index === activeIndex} className={`palette-item ${index === activeIndex ? "active" : ""}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => execute(index)}><ActionIcon size={16} /><span>{action.label}</span><kbd>{action.hint}</kbd></button>; })}</div> : <div className="palette-empty">No matching commands</div>}<div className="palette-footer"><span>Navigate <b>↑ ↓</b></span><span>Run <b>↵</b></span><span>Close <b>esc</b></span></div></section></div>;
}

function WslTerminalDialog({ onClose, onSelect }: { onClose: () => void; onSelect: (distribution: string) => void }) {
  const [distributions, setDistributions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!IS_TAURI) {
      setLoading(false);
      setError("WSL discovery requires the Windows desktop runtime.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setDistributions(await invoke<string[]>("terminal_list_wsl"));
    } catch (refreshError) {
      setDistributions([]);
      setError(String(refreshError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const platformMessage = error?.includes("not available on this platform")
    ? "WSL is available only in the Windows desktop build."
    : error;

  return <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="quick-connect" role="dialog" aria-modal="true" aria-label="New WSL terminal" onMouseDown={(event) => event.stopPropagation()}>
      <div className="quick-connect-heading">
        <div>
          <span className="eyebrow">LOCAL / WINDOWS</span>
          <h2>New WSL terminal</h2>
          <p>Choose an installed distribution. Conxol does not execute a shell to discover or launch it.</p>
        </div>
        <button type="button" className="icon-button" aria-label="Close WSL terminal picker" onClick={onClose}><X size={17} /></button>
      </div>
      <div className="wsl-dialog-body">
        {loading ? <div className="wsl-empty"><LoaderCircle className="spin" size={20} /><strong>Checking Windows WSL</strong><span>This is a bounded local capability query.</span></div>
          : platformMessage ? <div className="wsl-empty"><ShieldAlert size={20} /><strong>WSL is unavailable</strong><span>{platformMessage}</span></div>
            : distributions.length === 0 ? <div className="wsl-empty"><TerminalIcon size={20} /><strong>No WSL distribution detected</strong><span>Install a distribution in Windows, then refresh this list.</span></div>
              : <div className="wsl-distribution-list" role="listbox" aria-label="Installed WSL distributions">{distributions.map((distribution) => <button key={distribution} type="button" className="wsl-distribution" role="option" onClick={() => onSelect(distribution)}><TerminalIcon size={16} /><span><strong>{distribution}</strong><small>Launch interactive shell</small></span><ExternalLink size={14} /></button>)}</div>}
      </div>
      <div className="quick-connect-footer">
        <span><ShieldCheck size={14} /> No SSH keys, credentials, or personal files are read</span>
        <div><button type="button" className="outline-button" onClick={onClose}>Cancel</button><button type="button" className="outline-button" onClick={() => void refresh()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={14} /> Refresh</button></div>
      </div>
    </section>
  </div>;
}

function CredentialVaultModal({ onClose, onSave, onDelete }: { onClose: () => void; onSave: (credentialId: string, secret: string) => Promise<void>; onDelete: (credentialId: string) => Promise<void> }) {
  const [credentialId, setCredentialId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => {
    setSecret("");
    onClose();
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!credentialId.trim() || !secret) return;
    setBusy(true);
    try {
      await onSave(credentialId, secret);
    } finally {
      setSecret("");
      setBusy(false);
    }
  };

  const remove = async () => {
    const backendLabel = "encrypted workspace vault";
    if (!credentialId.trim() || !await confirmAction(`Delete credential “${credentialId.trim()}” from the ${backendLabel}?`)) return;
    setBusy(true);
    try {
      await onDelete(credentialId);
    } finally {
      setSecret("");
      setBusy(false);
    }
  };

  return <div className="palette-backdrop" role="presentation" onMouseDown={close}><form className="credential-modal" role="dialog" aria-modal="true" aria-label="Credential vault" onMouseDown={(event) => event.stopPropagation()} onSubmit={save}>
    <div className="session-editor-heading"><div><span className="eyebrow">NATIVE SECURITY</span><h2>Credential vault</h2><p>Save an opaque reference. Stored secrets remain in native storage and are never listed or returned to React.</p></div><button type="button" className="icon-button" aria-label="Close credential vault" onClick={close}><X size={17} /></button></div>
    <div className="credential-modal-body">
      <label>Credential reference<input {...literalInputProps} required autoFocus value={credentialId} onChange={(event) => setCredentialId(event.target.value)} placeholder="prod-bastion-password" autoComplete="off" /><small>Letters, numbers, dots, dashes, and underscores only.</small></label>
      <label>Secret<input {...literalInputProps} required type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Enter only for this explicit save" autoComplete="new-password" /><small>The field is cleared after the native operation. It is not persisted in app state.</small></label>
    </div>
    <div className="credential-modal-note"><KeyRound size={14} /><span>Saved passwords are encrypted with your workspace PIN. Set up the PIN in Settings &gt; Security; unlocking the screen also unlocks this vault. No vault operation runs until you confirm.</span></div>
    <div className="session-editor-footer"><button type="button" className="outline-button danger-button" onClick={() => void remove()} disabled={busy || !credentialId.trim()}><Trash2 size={14} /> Delete reference</button><div><button type="button" className="outline-button" onClick={close} disabled={busy}>Cancel</button><button type="submit" className="primary-button" disabled={busy || !credentialId.trim() || !secret}>{busy ? "Saving…" : "Save secret"}</button></div></div>
  </form></div>;
}

function newSnippetRecord(): SnippetRecord {
  return { id: crypto.randomUUID(), title: "", description: "", command: "", tags: [], variables: [] };
}

function snippetVariables(command: string): string[] {
  return [...new Set([...command.matchAll(/\$\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]))];
}

function renderSnippetCommand(command: string, values: Record<string, string>): string {
  return command.replace(/\$\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, name: string) => values[name] === undefined ? match : values[name]);
}

function SnippetsModal({ snippets, onClose, onSave, onDelete, onCopy }: { snippets: SnippetRecord[]; onClose: () => void; onSave: (snippet: SnippetRecord) => Promise<void>; onDelete: (snippet: SnippetRecord) => Promise<void>; onCopy: (command: string) => Promise<void> }) {
  const [selectedId, setSelectedId] = useState<string | null>(snippets[0]?.id ?? null);
  const [draft, setDraft] = useState<SnippetRecord>(() => newSnippetRecord());
  const selected = snippets.find((snippet) => snippet.id === selectedId);
  const active = selected ?? draft;

  const save = async (snippet: SnippetRecord) => {
    await onSave(snippet);
    setSelectedId(snippet.id);
    setDraft(snippet);
  };

  const remove = async () => {
    if (!selected) return;
    await onDelete(selected);
    setSelectedId(null);
    setDraft(newSnippetRecord());
  };

  return <div className="palette-backdrop" role="presentation" onMouseDown={onClose}><section className="snippets-modal" role="dialog" aria-modal="true" aria-label="Command snippets" onMouseDown={(event) => event.stopPropagation()}>
    <div className="session-editor-heading"><div><span className="eyebrow">COMMAND LIBRARY</span><h2>Snippets</h2><p>Preview, edit, then copy for a deliberate manual paste. Nothing runs automatically.</p></div><button type="button" className="icon-button" aria-label="Close snippets" onClick={onClose}><X size={17} /></button></div>
    <div className="snippet-layout">
      <aside className="snippet-list" aria-label="Saved snippets"><div className="snippet-list-heading"><span>{snippets.length} saved</span><button type="button" className="outline-button" onClick={() => { setSelectedId(null); setDraft(newSnippetRecord()); }}><Plus size={13} /> New</button></div>{snippets.length === 0 ? <p className="snippet-empty">No snippets yet. Start with a safe, reviewable command.</p> : snippets.map((snippet) => <button type="button" key={snippet.id} className={`snippet-list-item ${snippet.id === selectedId ? "selected" : ""}`} onClick={() => setSelectedId(snippet.id)}><strong>{snippet.title || "Untitled snippet"}</strong><small>{snippet.tags.join(" · ") || "No tags"}</small></button>)}</aside>
      <SnippetForm key={active.id} snippet={active} isNew={!selected} onSave={save} onDelete={remove} onCopy={onCopy} />
    </div>
  </section></div>;
}

function newMacroRecord(): MacroRecord {
  return { id: crypto.randomUUID(), title: "", description: "", tags: [], actions: [], approval: "beforeRun" };
}

function newMacroAction(kind: MacroAction["kind"]): MacroAction {
  if (kind === "sendText") return { kind, text: "" };
  if (kind === "wait") return { kind, milliseconds: 250 };
  if (kind === "sendKey") return { kind, key: "enter" };
  if (kind === "executeCommand") return { kind, command: "" };
  if (kind === "openSession") return { kind, sessionId: "" };
  return { kind, workspaceId: "" };
}

function macroActionSummary(action: MacroAction): string {
  if (action.kind === "sendText") return `Send text · ${action.text.trim() || "empty"}`;
  if (action.kind === "executeCommand") return `Execute command · ${action.command.trim() || "empty"}`;
  if (action.kind === "wait") return `Wait · ${action.milliseconds} ms`;
  if (action.kind === "sendKey") return `Send key · ${action.key}`;
  if (action.kind === "openSession") return "Open saved session";
  return "Switch workspace";
}

function MacrosModal({ initialDraft, macros, terminals, savedSessions, onClose, onSave, onDelete, onRun }: { initialDraft?: MacroRecord; macros: MacroRecord[]; terminals: WorkspaceTerminal[]; savedSessions: SavedSession[]; onClose: () => void; onSave: (record: MacroRecord) => Promise<void>; onDelete: (record: MacroRecord) => Promise<void>; onRun: (record: MacroRecord, targetIds: string[]) => Promise<void> }) {
  const [selectedId, setSelectedId] = useState<string | null>(initialDraft ? null : macros[0]?.id ?? null);
  const [draft, setDraft] = useState<MacroRecord>(() => initialDraft ?? newMacroRecord());
  const [query, setQuery] = useState("");
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const selected = macros.find(record => record.id === selectedId);
  const active = selected ?? draft;
  const readyTerminals = terminals.filter(terminal => terminal.status === "connected" && terminal.remoteProtocol !== "rdp" && terminal.remoteProtocol !== "vnc");
  const currentTargetIds = targetIds.filter(id => readyTerminals.some(terminal => terminal.id === id));
  const visibleMacros = macros.filter(record => `${record.title} ${record.tags.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => a.title.localeCompare(b.title));
  const save = async (record: MacroRecord) => { await onSave(record); setSelectedId(record.id); setDraft(record); };
  const remove = async () => { if (selected) await onDelete(selected); };
  return <div className="palette-backdrop" role="presentation" onMouseDown={onClose}><section className="macros-modal" role="dialog" aria-modal="true" aria-label="Terminal macros" onMouseDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <div className="session-editor-heading"><div><h2>Macros</h2><p>Build a sequence, choose terminals, then review and run.</p></div><button type="button" className="icon-button" aria-label="Close macros" onClick={onClose}><X size={17} /></button></div>
    <div className="macro-layout">
      <aside className="macro-list" aria-label="Saved macros">
        <button type="button" className="outline-button macro-new" onClick={() => { setSelectedId(null); setDraft(newMacroRecord()); }}><Plus size={14} /> New macro</button>
        <input className="macro-search" autoFocus aria-label="Search macros" placeholder="Search macros…" value={query} onChange={event => setQuery(event.target.value)} />
        <div className="macro-library"><small>{visibleMacros.length} macro{visibleMacros.length === 1 ? "" : "s"}</small>{visibleMacros.length === 0 ? <p className="snippet-empty">{query ? "No matching macros." : "Create a macro to save commands you repeat."}</p> : visibleMacros.map(record => <button type="button" key={record.id} className={`snippet-list-item ${record.id === selectedId ? "selected" : ""}`} onClick={() => setSelectedId(record.id)}><strong>{record.title || "Untitled macro"}</strong><small>{record.actions.length} step{record.actions.length === 1 ? "" : "s"}{record.tags.length > 0 ? ` · ${record.tags.join(" · ")}` : ""}</small></button>)}</div>
      </aside>
      <MacroEditor key={active.id} record={active} isNew={!selected} savedSessions={savedSessions} terminals={terminals} targets={currentTargetIds} readyTerminals={readyTerminals} onTargetsChange={setTargetIds} onSave={save} onDelete={remove} onRun={record => void onRun(record, currentTargetIds)} />
    </div>
  </section></div>;
}

function MacroEditor({ record, isNew, savedSessions, terminals, targets, readyTerminals, onTargetsChange, onSave, onDelete, onRun }: { record: MacroRecord; isNew: boolean; savedSessions: SavedSession[]; terminals: WorkspaceTerminal[]; targets: string[]; readyTerminals: WorkspaceTerminal[]; onTargetsChange: (ids: string[]) => void; onSave: (record: MacroRecord) => Promise<void>; onDelete: () => Promise<void>; onRun: (record: MacroRecord) => void }) {
  const [title, setTitle] = useState(record.title);
  const [description, setDescription] = useState(record.description);
  const [tags, setTags] = useState(record.tags.join(", "));
  const [actions, setActions] = useState<MacroAction[]>(record.actions);
  const [approval, setApproval] = useState<MacroApprovalPolicy>(record.approval ?? "beforeRun");
  const [view, setView] = useState<"edit" | "run">("edit");
  const [nextKind, setNextKind] = useState<MacroAction["kind"]>("executeCommand");
  const updateAction = (index: number, action: MacroAction) => setActions(current => current.map((item, i) => i === index ? action : item));
  const removeAction = (index: number) => setActions(current => current.filter((_, i) => i !== index));
  const buildRecord = (): MacroRecord => ({ id: record.id, title: title.trim(), description: description.trim(), tags: [...new Set(tags.split(",").map(tag => tag.trim()).filter(Boolean))], actions, approval });
  const current = buildRecord();
  const hasSessionActions = actions.some(action => action.kind === "openSession" || action.kind === "switchWorkspace");
  return <form className="macro-form" onSubmit={event => { event.preventDefault(); void onSave(buildRecord()); }}>
    <div className="macro-editor-top"><label>Macro name<input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Check interface status" /></label>{!isNew && <button type="button" className="session-action danger" onClick={() => void onDelete()} aria-label="Delete macro" title="Delete macro"><Trash2 size={15} /></button>}</div>
    <div className="macro-view-tabs" role="tablist" aria-label="Macro workflow" onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "edit" : event.key === "End" ? "run" : view === "edit" ? "run" : "edit"; setView(next); document.getElementById(`macro-${next}-tab`)?.focus(); } }}><button type="button" id="macro-edit-tab" role="tab" tabIndex={view === "edit" ? 0 : -1} aria-selected={view === "edit"} aria-controls="macro-edit-panel" onClick={() => setView("edit")}>1. Edit steps</button><button type="button" id="macro-run-tab" role="tab" tabIndex={view === "run" ? 0 : -1} aria-selected={view === "run"} aria-controls="macro-run-panel" onClick={() => setView("run")}>2. Run macro</button></div>
    <div className="macro-editor-body">
      <section id="macro-edit-panel" role="tabpanel" aria-labelledby="macro-edit-tab" hidden={view !== "edit"}>
        <div className="macro-actions-heading"><span>Steps</span><small>{actions.length} / {MAX_MACRO_ACTIONS} · Runs from top to bottom</small></div>
        <div className="macro-actions-list">{actions.length === 0 && <div className="macro-empty"><strong>Add your first step</strong><p>Start with a command, then add text, keys or a delay as needed.</p></div>}{actions.map((action, index) => <MacroActionRow key={`${index}-${action.kind}`} index={index} action={action} savedSessions={savedSessions} terminals={terminals} onChange={updateAction} onRemove={removeAction} />)}</div>
        <div className="macro-add-step"><label>Step type<select value={nextKind} onChange={event => setNextKind(event.target.value as MacroAction["kind"])}><option value="executeCommand">Run command</option><option value="sendText">Type text (without Enter)</option><option value="sendKey">Press key</option><option value="wait">Wait</option><option value="openSession">Open saved session</option><option value="switchWorkspace">Switch terminal</option></select></label><button type="button" className="outline-button" disabled={actions.length >= MAX_MACRO_ACTIONS} onClick={() => setActions(current => appendMacroAction(current, newMacroAction(nextKind)))}><Plus size={14} /> Add step</button></div>
        <details className="macro-details"><summary>Description & tags <span>Optional</span></summary><label>Description<textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="When to use this macro" rows={2} /></label><label>Tags<input value={tags} onChange={event => setTags(event.target.value)} placeholder="Cisco, maintenance" /></label></details>
      </section>
      <section id="macro-run-panel" role="tabpanel" aria-labelledby="macro-run-tab" hidden={view !== "run"}>
        <div className="macro-actions-heading"><span>Review steps</span><small>{actions.length} step{actions.length === 1 ? "" : "s"}</small></div>
        {actions.length === 0 ? <p className="macro-empty">Add at least one step in Edit steps.</p> : <ol className="macro-review">{actions.map((action, index) => <li key={index}><pre>{macroActionSummary(action)}{action.kind === "openSession" ? ` · ${savedSessions.find(session => session.id === action.sessionId)?.name ?? "Select a saved session"}` : action.kind === "switchWorkspace" ? ` · ${terminals.find(terminal => terminal.id === action.workspaceId)?.label ?? "Select a terminal"}` : ""}</pre></li>)}</ol>}
        <div className="macro-targets"><div className="macro-targets-heading"><span>Run on</span><small>{targets.length} selected</small></div>{readyTerminals.length === 0 ? <p>Connect a terminal to run this macro.</p> : readyTerminals.map(terminal => <label key={terminal.id} className="macro-target"><input type="checkbox" checked={targets.includes(terminal.id)} onChange={() => onTargetsChange(targets.includes(terminal.id) ? targets.filter(id => id !== terminal.id) : [...targets, terminal.id])} /><span>{terminal.label}</span><small>{terminal.remoteHost ?? "local"}</small></label>)}</div>
        <label className="macro-approval">Confirmation<select value={approval} onChange={event => setApproval(event.target.value as MacroApprovalPolicy)}><option value="beforeRun">Confirm once before running</option><option value="eachAction">Confirm before every step</option></select></label>
        {hasSessionActions && <p className="macro-safety"><ShieldAlert size={14} /><span>This macro can open a session or switch the active terminal. Review those steps before running.</span></p>}
      </section>
    </div>
    <div className="macro-editor-footer"><small>{view === "edit" ? "Keep passwords and tokens out of macros." : "You’ll confirm before any step runs."}</small><div><button type="submit" className="outline-button" disabled={actions.length === 0 || !title.trim()}><Save size={14} /> Save macro</button>{view === "edit" ? <button type="button" className="primary-button" disabled={actions.length === 0 || !title.trim()} onClick={() => setView("run")}>Next: choose terminals <ArrowRight size={14} /></button> : <button type="button" className="primary-button" onClick={() => onRun(current)} disabled={actions.length === 0 || targets.length === 0 || !title.trim()}><Play size={14} /> Review & run{targets.length > 0 ? ` (${targets.length})` : ""}</button>}</div></div>
  </form>;
}

function MacroActionRow({ index, action, savedSessions, terminals, onChange, onRemove }: { index: number; action: MacroAction; savedSessions: SavedSession[]; terminals: WorkspaceTerminal[]; onChange: (index: number, action: MacroAction) => void; onRemove: (index: number) => void }) {
  return <div className="macro-action-row"><div className="macro-action-row-heading"><span>{String(index + 1).padStart(2, "0")} · {{ sendText: "Type text", executeCommand: "Run command", sendKey: "Press key", wait: "Wait", openSession: "Open saved session", switchWorkspace: "Switch terminal" }[action.kind]}</span><button type="button" className="session-action danger" onClick={() => onRemove(index)} aria-label={`Remove action ${index + 1}`} title="Remove action"><Trash2 size={13} /></button></div><label>Type<select value={action.kind} onChange={(event) => onChange(index, newMacroAction(event.target.value as MacroAction["kind"]))}><option value="sendText">Send text</option><option value="executeCommand">Execute command</option><option value="sendKey">Send key</option><option value="wait">Wait</option><option value="openSession">Open saved session</option><option value="switchWorkspace">Switch workspace</option></select></label>{action.kind === "sendText" && <label>Text<textarea value={action.text} onChange={(event) => onChange(index, { kind: "sendText", text: event.target.value })} rows={2} placeholder="Text sent exactly as entered" /></label>}{action.kind === "executeCommand" && <label>Command<textarea value={action.command} onChange={(event) => onChange(index, { kind: "executeCommand", command: event.target.value })} rows={2} placeholder="systemctl status app" /></label>}{action.kind === "sendKey" && <label>Key<select value={action.key} onChange={(event) => onChange(index, { kind: "sendKey", key: event.target.value as MacroKey })}><option value="enter">Enter</option><option value="escape">Escape</option><option value="tab">Tab</option><option value="backspace">Backspace</option><option value="ctrlC">Ctrl+C</option><option value="ctrlD">Ctrl+D</option><option value="arrowUp">Arrow up</option><option value="arrowDown">Arrow down</option><option value="arrowLeft">Arrow left</option><option value="arrowRight">Arrow right</option></select></label>}{action.kind === "wait" && <label>Milliseconds<input type="number" min="1" max="300000" value={action.milliseconds} onChange={(event) => onChange(index, { kind: "wait", milliseconds: Number(event.target.value) })} /></label>}{action.kind === "openSession" && <label>Saved session<select value={action.sessionId} onChange={(event) => onChange(index, { kind: "openSession", sessionId: event.target.value })}><option value="">Select a saved session</option>{savedSessions.map((session) => <option key={session.id} value={session.id}>{session.name} · {session.protocol}</option>)}</select></label>}{action.kind === "switchWorkspace" && <label>Workspace<select value={action.workspaceId} onChange={(event) => onChange(index, { kind: "switchWorkspace", workspaceId: event.target.value })}><option value="">Select a workspace</option>{terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.label}</option>)}</select></label>}</div>;
}

function BroadcastModal({ terminals, selectedIds, enabled, onClose, onToggle, onEnable, onDisable }: { terminals: WorkspaceTerminal[]; selectedIds: string[]; enabled: boolean; onClose: () => void; onToggle: (id: string) => void; onEnable: () => void; onDisable: () => void }) {
  const ready = terminals.filter((terminal) => terminal.status === "connected" && terminal.remoteProtocol !== "rdp" && terminal.remoteProtocol !== "vnc");
  return <div className="palette-backdrop" role="presentation" onMouseDown={onClose}><section className="broadcast-modal" role="dialog" aria-modal="true" aria-label="Broadcast input" onMouseDown={(event) => event.stopPropagation()}><div className="session-editor-heading"><div><span className="eyebrow">TERMINAL / BROADCAST</span><h2>Broadcast input</h2><p>Select exact targets before enabling. Every keystroke is sent to all selected terminals.</p></div><button type="button" className="icon-button" aria-label="Close broadcast settings" onClick={onClose}><X size={17} /></button></div><div className="broadcast-warning"><ShieldAlert size={17} /><div><strong>{enabled ? "Broadcast is active" : "Broadcast is off"}</strong><span>Use <kbd>Esc</kbd> at any time to disable it. Pasted multiline input still requires confirmation.</span></div></div><div className="broadcast-target-list"><div className="macro-targets-heading"><span>Target terminals</span><small>{selectedIds.length} selected · {ready.length} ready</small></div>{terminals.map((terminal) => { const isReady = terminal.status === "connected" && terminal.remoteProtocol !== "rdp" && terminal.remoteProtocol !== "vnc"; return <label className={`macro-target ${!isReady ? "disabled" : ""}`} key={terminal.id}><input type="checkbox" disabled={!isReady} checked={selectedIds.includes(terminal.id)} onChange={() => onToggle(terminal.id)} /><span>{terminal.label}</span><small>{isReady ? (terminal.remoteHost ?? "local") : terminal.remoteProtocol === "rdp" || terminal.remoteProtocol === "vnc" ? "remote desktop · text broadcast disabled" : terminal.status}</small></label>; })}</div><div className="session-editor-footer"><span className="remote-editor-safety"><ShieldCheck size={13} /> No input is sent while configuring</span><div><button type="button" className="outline-button" onClick={enabled ? onDisable : onClose}>{enabled ? "Disable" : "Cancel"}</button>{!enabled && <button type="button" className="primary-button" onClick={onEnable} disabled={selectedIds.length === 0}><Radio size={14} /> Enable broadcast</button>}</div></div></section></div>;
}

function SnippetForm({ snippet, isNew, onSave, onDelete, onCopy }: { snippet: SnippetRecord; isNew: boolean; onSave: (snippet: SnippetRecord) => Promise<void>; onDelete: () => Promise<void>; onCopy: (command: string) => Promise<void> }) {
  const [title, setTitle] = useState(snippet.title);
  const [description, setDescription] = useState(snippet.description);
  const [command, setCommand] = useState(snippet.command);
  const [tags, setTags] = useState(snippet.tags.join(", "));
  const [variables, setVariables] = useState(snippet.variables.join(", "));
  const [values, setValues] = useState<Record<string, string>>({});
  const detectedVariables = [...new Set([...variables.split(",").map((value) => value.trim()).filter(Boolean), ...snippetVariables(command)])];
  const rendered = renderSnippetCommand(command, values);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSave({
      id: snippet.id,
      title: title.trim(),
      description: description.trim(),
      command,
      tags: [...new Set(tags.split(",").map((tag) => tag.trim()).filter(Boolean))],
      variables: [...new Set(detectedVariables)],
    });
  };

  return <form className="snippet-form" onSubmit={submit}><div className="snippet-form-heading"><div><span className="settings-section-label">{isNew ? "New snippet" : "Edit snippet"}</span><strong>{title.trim() || "Untitled snippet"}</strong></div>{!isNew && <button type="button" className="session-action danger" onClick={() => void onDelete()} aria-label="Delete snippet" title="Delete snippet"><Trash2 size={14} /></button>}</div>
    <label>Title<input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Restart service" /></label>
    <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this command is for" rows={2} /></label>
    <label>Command<textarea required value={command} onChange={(event) => setCommand(event.target.value)} placeholder="docker restart ${service}" rows={5} /></label>
    <div className="snippet-form-row"><label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="docker, ops" /></label><label>Variables<input value={variables} onChange={(event) => setVariables(event.target.value)} placeholder="service, host" /><small>Detected placeholders are included automatically.</small></label></div>
    <div className="snippet-preview"><div className="snippet-preview-heading"><span>Preview</span><small>{detectedVariables.length} variable{detectedVariables.length === 1 ? "" : "s"}</small></div>{detectedVariables.length > 0 && <div className="snippet-variable-grid">{detectedVariables.map((variable) => <label key={variable}>{variable}<input value={values[variable] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [variable]: event.target.value }))} placeholder={`Value for ${variable}`} /></label>)}</div>}<pre>{rendered || "Your command preview will appear here."}</pre></div>
    <div className="snippet-form-footer"><span><ShieldCheck size={13} /> Manual review required</span><div><button type="button" className="outline-button" onClick={() => void onCopy(rendered)} disabled={!rendered.trim()}>Copy rendered</button><button type="submit" className="primary-button"><CheckCircle2 size={14} /> Save snippet</button></div></div>
  </form>;
}

function SettingsModal({ systemDark, canRestore, settings, error, portableVaultStatus, onClose, onSave, onReset, onExport, onImport, onPortableCreate, onPortableUnlock, onPortableLock }: { systemDark: boolean; canRestore: boolean; settings: AppSettings; error: string | null; portableVaultStatus: PortableVaultStatus | null; onClose: () => void; onSave: (settings: AppSettings) => void; onReset: () => void; onExport: () => Promise<void>; onImport: () => Promise<void>; onPortableCreate: (passphrase: string) => Promise<void>; onPortableUnlock: (passphrase: string) => Promise<void>; onPortableLock: () => Promise<void> }) {
  const settingsTabs = [
    { id: "general", label: "General", icon: Settings2 },
    { id: "terminal", label: "Terminal", icon: TerminalIcon },
    { id: "shortcuts", label: "Shortcuts", icon: Command },
    { id: "network", label: "Network", icon: Network },
    { id: "security", label: "Screen lock", icon: LockKeyhole },
    { id: "backup", label: "Backup", icon: Save },
    { id: "vault", label: "Vault", icon: ShieldCheck },
  ] as const;
  type SettingsTab = typeof settingsTabs[number]["id"];
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("general");
  const [theme, setTheme] = useState(settings.general.theme);
  const previewTheme: ColorTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const [tabPlusSavedSessions, setTabPlusSavedSessions] = useState(settings.general.tabPlusSavedSessions ?? false);
  const [confirmMultilinePaste, setConfirmMultilinePaste] = useState(settings.general.confirmMultilinePaste);
  const [pastePreview, setPastePreview] = useState(settings.general.pastePreview);
  const [rightClickToPaste, setRightClickToPaste] = useState(settings.general.rightClickToPaste);
  const [alwaysShowTerminalSearch, setAlwaysShowTerminalSearch] = useState(settings.general.alwaysShowTerminalSearch);
  const [copyOnSelect, setCopyOnSelect] = useState(settings.terminal.copyOnSelect);
  const [terminalAppearance, setTerminalAppearance] = useState<TerminalAppearance>({ ...defaultTerminalAppearance, ...settings.terminal });
  const [fontSize, setFontSize] = useState(String(settings.appearance.fontSize));
  const [scrollbackLines, setScrollbackLines] = useState(String(settings.terminal.scrollbackLines));
  const [cursorBlink, setCursorBlink] = useState(settings.terminal.cursorBlink);
  const [keyboard, setKeyboard] = useState(settings.keyboard);
  const [reconnectEnabled, setReconnectEnabled] = useState(settings.ssh.reconnectEnabled);
  const [reconnectAttempts, setReconnectAttempts] = useState(String(settings.ssh.reconnectAttempts));
  const [connectTimeoutMs, setConnectTimeoutMs] = useState(String(settings.ssh.connectTimeoutMs));
  const [diagnosticTimeoutMs, setDiagnosticTimeoutMs] = useState(String(settings.network.diagnosticTimeoutMs));
  const [scanConcurrency, setScanConcurrency] = useState(String(settings.network.scanConcurrency));
  const [portablePassphrase, setPortablePassphrase] = useState("");
  const [portableBusy, setPortableBusy] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => { errorRef.current?.focus(); }, [error]);

  const close = () => {
    setPortablePassphrase("");
    onClose();
  };

  const runPortableAction = async (action: (passphrase: string) => Promise<void>) => {
    if (!portablePassphrase) return;
    setPortableBusy(true);
    try {
      await action(portablePassphrase);
    } finally {
      setPortablePassphrase("");
      setPortableBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave({
      general: { theme, confirmMultilinePaste, pastePreview, alwaysShowTerminalSearch, rightClickToPaste, tabPlusSavedSessions },
      appearance: { fontSize: Number(fontSize) },
      terminal: { ...terminalAppearance, colorTheme: "", scrollbackLines: Number(scrollbackLines), cursorBlink, copyOnSelect },
      keyboard,
      ssh: { reconnectEnabled, reconnectAttempts: Number(reconnectAttempts), connectTimeoutMs: Number(connectTimeoutMs) },
      network: { diagnosticTimeoutMs: Number(diagnosticTimeoutMs), scanConcurrency: Number(scanConcurrency) },
    });
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={close}>
      <form className="settings-modal" role="dialog" aria-modal="true" aria-label="Settings" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit} onInvalid={event => {
        const input = event.target as HTMLElement;
        const panel = input.closest<HTMLElement>("[data-settings-panel]");
        if (panel?.dataset.settingsPanel) {
          panel.hidden = false;
          setActiveSettingsTab(panel.dataset.settingsPanel as SettingsTab);
          event.preventDefault();
          requestAnimationFrame(() => input.focus());
        }
      }}>
        <div className="session-editor-heading">
          <div>
            <h2>Workspace settings</h2>
            <p>Customize your terminal and connections.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close settings" onClick={close}><X size={17} /></button>
        </div>

        <div className="workspace-settings-tabs" role="tablist" aria-label="Settings categories">
          {settingsTabs.map((tab, index) => <button key={tab.id} id={`settings-tab-${tab.id}`} type="button" role="tab" aria-selected={activeSettingsTab === tab.id} aria-controls={`settings-panel-${tab.id}`} tabIndex={activeSettingsTab === tab.id ? 0 : -1} onClick={() => setActiveSettingsTab(tab.id)} onKeyDown={event => {
            let next = index;
            if (event.key === "ArrowRight") next = (index + 1) % settingsTabs.length;
            else if (event.key === "ArrowLeft") next = (index + settingsTabs.length - 1) % settingsTabs.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = settingsTabs.length - 1;
            else return;
            event.preventDefault();
            setActiveSettingsTab(settingsTabs[next].id);
            document.getElementById(`settings-tab-${settingsTabs[next].id}`)?.focus();
          }}><tab.icon size={14} />{tab.label}</button>)}
        </div>
        <div className="workspace-settings-body">
          <section id="settings-panel-general" className="workspace-settings-panel" role="tabpanel" aria-labelledby="settings-tab-general" data-settings-panel="general" hidden={activeSettingsTab !== "general"}>
        <div className="settings-section">
          <span className="settings-section-label">General & appearance</span>
          <div className="settings-grid settings-appearance-grid">
            <label>Tab + button opens<select value={tabPlusSavedSessions ? "saved" : "new"} onChange={event => setTabPlusSavedSessions(event.target.value === "saved")}><option value="new">New session</option><option value="saved">Saved sessions (with search)</option></select></label>
            <label>Theme<select value={theme} onChange={(event) => setTheme(event.target.value as AppSettings["general"]["theme"])}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select><small>Applies to the app and terminals.</small></label>
          </div>
        </div>
        <div className="settings-section">
          <span className="settings-section-label">Terminal behavior</span>
          <div className="settings-grid settings-toggle-grid settings-general-options">
            <div className="settings-general-option">
              <label className="settings-check"><input type="checkbox" checked={rightClickToPaste} onChange={event => setRightClickToPaste(event.target.checked)} /> Right-click to paste</label>
              <small>Shift+right-click opens terminal actions.</small>
            </div>
            <div className="settings-general-option">
              <label className="settings-check"><input type="checkbox" checked={alwaysShowTerminalSearch} onChange={event => setAlwaysShowTerminalSearch(event.target.checked)} /> Always show terminal search</label>
              <small>Keep the search bar visible in text terminals.</small>
            </div>
          </div>
        </div>
        <div className="settings-section">
          <span className="settings-section-label">Terminal & clipboard</span>
          <div className="settings-grid settings-toggle-grid">
            <label className="settings-check"><input type="checkbox" checked={cursorBlink} onChange={(event) => setCursorBlink(event.target.checked)} /> Cursor blink</label>
            <label className="settings-check"><input type="checkbox" checked={copyOnSelect} onChange={(event) => setCopyOnSelect(event.target.checked)} /> Automatically copy selected terminal text</label>
            <label className="settings-check"><input type="checkbox" checked={pastePreview} onChange={(event) => setPastePreview(event.target.checked)} /> Preview before pasting multiple lines</label>
            <label className="settings-check"><input type="checkbox" checked={confirmMultilinePaste} onChange={(event) => setConfirmMultilinePaste(event.target.checked)} /> Warn on multiline paste</label>
          </div>
        </div>
          </section>
          <section id="settings-panel-terminal" className="workspace-settings-panel" role="tabpanel" aria-labelledby="settings-tab-terminal" data-settings-panel="terminal" hidden={activeSettingsTab !== "terminal"}>
            <div className="settings-section">
              <span className="settings-section-label">Terminal appearance</span>
              <p>Uses the theme selected in General. Custom colors override the terminal background and text.</p>
              <div className="settings-grid">
                <label>Background<input type="color" value={resolveTerminalTheme(previewTheme, terminalAppearance).background} onChange={event => setTerminalAppearance(current => ({ ...current, background: event.target.value }))} /></label>
                <label>Text color<input type="color" value={resolveTerminalTheme(previewTheme, terminalAppearance).foreground} onChange={event => setTerminalAppearance(current => ({ ...current, foreground: event.target.value }))} /><small>Device ANSI colors and syntax highlights keep their own colors.</small></label>
            <label>Font size<input type="number" min="8" max="32" value={fontSize} onChange={(event) => setFontSize(event.target.value)} /><small>8–32 px.</small></label>
            <label>Scrollback lines<input type="number" min="100" max="100000" value={scrollbackLines} onChange={(event) => setScrollbackLines(event.target.value)} /><small>100–100,000 lines.</small></label>

                <div className="terminal-color-reset"><button type="button" className="outline-button" onClick={() => setTerminalAppearance(current => ({ ...current, background: "", foreground: "" }))}>Reset colors to theme</button></div>
              </div>
            </div>
            <pre className="terminal-appearance-preview" style={{ background: resolveTerminalTheme(previewTheme, terminalAppearance).background, color: resolveTerminalTheme(previewTheme, terminalAppearance).foreground, fontSize: `${Math.max(8, Math.min(32, Number(fontSize) || 14))}px` }}>router&gt; show interfaces brief{"\n"}GigabitEthernet0/0/1  192.0.2.1  UP</pre>
          </section>
          <section id="settings-panel-shortcuts" className="workspace-settings-panel" role="tabpanel" aria-labelledby="settings-tab-shortcuts" data-settings-panel="shortcuts" hidden={activeSettingsTab !== "shortcuts"}>
        <div className="settings-section">
          <span className="settings-section-label">Keyboard shortcuts</span>
          <div className="settings-grid">
            <label>New terminal<input value={keyboard.newTerminal} onChange={(event) => setKeyboard((current) => ({ ...current, newTerminal: event.target.value }))} placeholder="Mod+N" /><small>Mod = Ctrl on Windows/Linux, Cmd on macOS.</small></label>
            <label>Quick connect<input value={keyboard.quickConnect} onChange={(event) => setKeyboard((current) => ({ ...current, quickConnect: event.target.value }))} placeholder="Mod+K" /></label>
            <label>Command palette<input value={keyboard.commandPalette} onChange={(event) => setKeyboard((current) => ({ ...current, commandPalette: event.target.value }))} placeholder="Mod+Shift+P" /></label>
            <label>Close tab<input value={keyboard.closeTab} onChange={(event) => setKeyboard((current) => ({ ...current, closeTab: event.target.value }))} placeholder="Mod+W" /></label>
            <label>Next tab<input value={keyboard.nextTab} onChange={(event) => setKeyboard((current) => ({ ...current, nextTab: event.target.value }))} placeholder="Ctrl+Tab" /></label>
            <label>Previous tab<input value={keyboard.previousTab} onChange={(event) => setKeyboard((current) => ({ ...current, previousTab: event.target.value }))} placeholder="Ctrl+Shift+Tab" /></label>
            <label>Split right<input value={keyboard.splitRight} onChange={(event) => setKeyboard((current) => ({ ...current, splitRight: event.target.value }))} placeholder="Mod+Shift+ArrowRight" /></label>
            <label>Split down<input value={keyboard.splitDown} onChange={(event) => setKeyboard((current) => ({ ...current, splitDown: event.target.value }))} placeholder="Mod+Shift+ArrowDown" /></label>
            <label>Focus pane<input value={keyboard.focusPane} onChange={(event) => setKeyboard((current) => ({ ...current, focusPane: event.target.value }))} placeholder="Mod+1" /></label>
            <label>Search terminal<input value={keyboard.searchTerminal} onChange={(event) => setKeyboard((current) => ({ ...current, searchTerminal: event.target.value }))} placeholder="Mod+F" /></label>
            <label>Toggle sidebar<input value={keyboard.toggleSidebar} onChange={(event) => setKeyboard((current) => ({ ...current, toggleSidebar: event.target.value }))} placeholder="Mod+Shift+B" /></label>
            <label>Open macros<input value={keyboard.openMacros} onChange={(event) => setKeyboard((current) => ({ ...current, openMacros: event.target.value }))} placeholder="Mod+Shift+M" /></label>
            <label>Disable broadcast<input value={keyboard.emergencyBroadcastDisable} onChange={(event) => setKeyboard((current) => ({ ...current, emergencyBroadcastDisable: event.target.value }))} placeholder="Escape" /><small>Escape remains a universal safety cancel.</small></label>
          </div>
          <small className="settings-section-note">Separate keys with + (for example, Mod+Shift+K). Each shortcut must be unique.</small>
        </div>
          </section>
          <section id="settings-panel-network" className="workspace-settings-panel" role="tabpanel" aria-labelledby="settings-tab-network" data-settings-panel="network" hidden={activeSettingsTab !== "network"}>
        <div className="settings-section">
          <span className="settings-section-label">SSH resilience</span>
          <div className="settings-grid settings-toggle-grid settings-network-toggle">
            <label className="settings-check"><input type="checkbox" checked={reconnectEnabled} onChange={(event) => setReconnectEnabled(event.target.checked)} /> Enable bounded reconnect</label>
          </div>
          <div className="settings-grid settings-appearance-grid">
            <label>Reconnect attempts<input type="number" min="0" max="10" value={reconnectAttempts} onChange={(event) => setReconnectAttempts(event.target.value)} /><small>0–10 attempts.</small></label>
            <label>Connect timeout ms<input type="number" min="100" max="60000" value={connectTimeoutMs} onChange={(event) => setConnectTimeoutMs(event.target.value)} /></label>
          </div>
        </div>
        <div className="settings-section">
          <span className="settings-section-label">Network diagnostics</span>
          <div className="settings-grid settings-appearance-grid">
            <label>Default timeout ms<input type="number" min="50" max="60000" value={diagnosticTimeoutMs} onChange={(event) => setDiagnosticTimeoutMs(event.target.value)} /></label>
            <label>Default scan concurrency<input type="number" min="1" max="128" value={scanConcurrency} onChange={(event) => setScanConcurrency(event.target.value)} /><small>1–128 bounded checks.</small></label>
          </div>
        </div>
          </section>
          <section id="settings-panel-security" className="workspace-settings-panel" role="tabpanel" aria-labelledby="settings-tab-security" data-settings-panel="security" hidden={activeSettingsTab !== "security"}>
            <div className="settings-section"><span className="settings-section-label">Workspace PIN lock</span><WorkspaceLockSettings /></div>
          </section>
          <section id="settings-panel-backup" className="workspace-settings-panel" role="tabpanel" aria-labelledby="settings-tab-backup" data-settings-panel="backup" hidden={activeSettingsTab !== "backup"}>
            <WorkspaceBackup canRestore={canRestore} />
          </section>
          <section id="settings-panel-vault" className="workspace-settings-panel" role="tabpanel" aria-labelledby="settings-tab-vault" data-settings-panel="vault" hidden={activeSettingsTab !== "vault"}>
        <div className="settings-section">
          <span className="settings-section-label">Encrypted workspace vault</span>
          <p>Saved passwords use your workspace screen-lock PIN. Set up or change the PIN in Security. Locking the workspace clears the vault key from memory.</p>
          <details><summary>Legacy portable vault</summary>
          <div className="settings-grid settings-vault-grid">
            <div className="settings-vault-status"><strong>{portableVaultStatus?.enabled ? portableVaultStatus.unlocked ? "Unlocked" : portableVaultStatus.exists ? "Locked" : "Not created" : "Unavailable"}</strong><small>{portableVaultStatus?.enabled ? `File: ${portableVaultStatus.path}` : "Portable mode activates only when portable.flag is beside the executable."}</small></div>
            <label>Unlock passphrase<input {...literalInputProps} type="password" value={portablePassphrase} onChange={(event) => setPortablePassphrase(event.target.value)} autoComplete="new-password" placeholder="Vault passphrase" /><small>Cleared after each vault action.</small></label>
            <div className="settings-vault-actions">{portableVaultStatus?.enabled && !portableVaultStatus.unlocked && portableVaultStatus.exists ? <button type="button" className="outline-button" onClick={() => void runPortableAction(onPortableUnlock)} disabled={portableBusy || !portablePassphrase}>Unlock</button> : null}{portableVaultStatus?.enabled && !portableVaultStatus.unlocked && !portableVaultStatus.exists ? <button type="button" className="outline-button" onClick={() => void runPortableAction(onPortableCreate)} disabled={portableBusy || !portablePassphrase}>Create encrypted vault</button> : null}{portableVaultStatus?.unlocked && <button type="button" className="outline-button danger-button" onClick={() => void onPortableLock()} disabled={portableBusy}>Lock vault</button>}</div>
          </div>
          </details>
        </div>

          </section>
        </div>

        {error && <div ref={errorRef} className="connect-error-inline" role="alert" tabIndex={-1}>{error}</div>}

        <div className="session-editor-footer">
          <div className="settings-footer-left"><button type="button" className="outline-button" onClick={onReset}>Reset defaults</button><button type="button" className="outline-button" onClick={() => void onImport()}>Import settings</button><button type="button" className="outline-button" onClick={() => void onExport()}>Export settings</button></div>
          <div><button type="button" className="outline-button" onClick={close}>Cancel</button><button type="submit" className="primary-button"><CheckCircle2 size={14} /> Save settings</button></div>
        </div>
      </form>
    </div>
  );
}

const CONSOLE_BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

function QuickConnectDialog({ connecting = false, initialSession, onSave, error, folders, onClose, onConnectSsh, onConnectTelnet, onConnectSerial, onConnectRemoteDesktop, onShell, onWsl }: { connecting?: boolean; initialSession?: SavedSession; onSave?: (session: SavedSession) => void; error: string | null; folders: string[]; onClose: () => void; onConnectSsh: (request: SshConnectRequest, bookmark?: { name: string; folder: string }) => void; onConnectTelnet: (request: TelnetConnectRequest) => void; onConnectSerial: (request: SerialConnectRequest) => void; onConnectRemoteDesktop: (request: RemoteDesktopConnectRequest) => void; onShell: () => void; onWsl: () => void }) {
  const [pptpProfileId, setPptpProfileId] = useState(initialSession?.pptp_profile_id ?? "");
  const [sshTab, setSshTab] = useState<"advanced" | "terminal" | "network">("advanced");
  const [bookmarkOpen, setBookmarkOpen] = useState(() => {
    try { return localStorage.getItem("conxol.sessionBookmarkOpen") === "true"; } catch { return false; }
  });
  const [sessionName, setSessionName] = useState(initialSession?.name ?? "");
  const [sessionFolder, setSessionFolder] = useState(initialSession?.folder ?? "");
  const [startupDirectory, setStartupDirectory] = useState(initialSession?.startup_directory ?? "");
  const [startupCommand, setStartupCommand] = useState(initialSession?.startup_command ?? "");
  const [tags, setTags] = useState(initialSession?.tags.join(", ") ?? "");
  const [notes, setNotes] = useState(initialSession?.notes ?? "");
  const [favorite, setFavorite] = useState(initialSession?.favorite ?? false);
  const [uri, setUri] = useState("");
  const [uriError, setUriError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [host, setHost] = useState(initialSession?.hostname ?? "");
  const [port, setPort] = useState(String(initialSession?.port ?? 22));
  const [username, setUsername] = useState(initialSession?.username ?? "");
  const [protocol, setProtocol] = useState<"ssh" | "telnet" | "serial" | "local" | DesktopProtocol>((initialSession?.protocol.toLowerCase() as "ssh" | "telnet" | "serial" | "local" | DesktopProtocol) ?? "ssh");
  const [method, setMethod] = useState<"agent" | "privateKey" | "password" | "keyboardInteractive" | "keyboardInteractivePrompt">(initialSession?.auth.kind && initialSession.auth.kind !== "none" ? initialSession.auth.kind : "keyboardInteractivePrompt");
  const [keyPath, setKeyPath] = useState(initialSession?.auth.kind === "privateKey" ? initialSession.auth.keyRef : "");
  const [passphraseCredentialId, setPassphraseCredentialId] = useState(initialSession?.auth.kind === "privateKey" ? initialSession.auth.credentialRef ?? "" : "");
  const [credentialId, setCredentialId] = useState(initialSession && "credentialRef" in initialSession.auth ? initialSession.auth.credentialRef ?? "" : "");
  const [domain, setDomain] = useState(initialSession?.remote_desktop_profile?.domain ?? "");
  const [gatewayEndpoint, setGatewayEndpoint] = useState(initialSession?.remote_desktop_profile?.gateway?.endpoint ?? "");
  const [gatewayUsername, setGatewayUsername] = useState(initialSession?.remote_desktop_profile?.gateway?.username ?? "");
  const [gatewayCredentialId, setGatewayCredentialId] = useState(initialSession?.remote_desktop_profile?.gateway?.credential_ref ?? "");
  const [desktopWidth, setDesktopWidth] = useState(String(initialSession?.remote_desktop_profile?.width ?? 1280));
  const [desktopHeight, setDesktopHeight] = useState(String(initialSession?.remote_desktop_profile?.height ?? 720));
  const [desktopColorDepth, setDesktopColorDepth] = useState(String(initialSession?.remote_desktop_profile?.color_depth ?? 32));
  const [vncQuality, setVncQuality] = useState<RemoteDesktopConnectRequest["vncQuality"]>(initialSession?.remote_desktop_profile?.vnc_quality ?? "balanced");
  const [allowInsecureVnc, setAllowInsecureVnc] = useState(initialSession?.remote_desktop_profile?.allow_insecure_vnc ?? false);
  const [desktopClipboardEnabled, setDesktopClipboardEnabled] = useState(initialSession?.remote_desktop_profile?.clipboard_enabled ?? false);
  const [desktopReconnectEnabled, setDesktopReconnectEnabled] = useState(initialSession?.remote_desktop_profile?.reconnect_enabled ?? true);
  const [desktopReconnectAttempts, setDesktopReconnectAttempts] = useState(String(initialSession?.remote_desktop_profile?.reconnect_attempts ?? 3));
  const [knownHostsPath, setKnownHostsPath] = useState(initialSession?.known_hosts_path ?? "");
  const [pinnedFingerprint, setPinnedFingerprint] = useState(initialSession?.pinned_fingerprint ?? "");
  const [x11Enabled, setX11Enabled] = useState(!!initialSession?.x11_display);
  const [x11Display, setX11Display] = useState(initialSession?.x11_display ?? "");
  const [x11SingleConnection, setX11SingleConnection] = useState(initialSession?.x11_single_connection ?? false);
  const [serverAliveInterval, setServerAliveInterval] = useState(String(initialSession?.server_alive_interval ?? 0));
  const [environmentText, setEnvironmentText] = useState(formatSessionEnvironment(initialSession?.environment ?? []));
  const [jumpHost, setJumpHost] = useState(initialSession?.jump_host_profiles?.[0]?.host ?? "");
  const [jumpPort, setJumpPort] = useState(String(initialSession?.jump_host_profiles?.[0]?.port ?? 22));
  const [jumpUsername, setJumpUsername] = useState(initialSession?.jump_host_profiles?.[0]?.username ?? "");
  const telnetPassword = useRef<HTMLInputElement>(null);
  const [saveTelnetPassword, setSaveTelnetPassword] = useState(false);
  const [terminal, setTerminal] = useState(initialSession?.telnet_profile?.terminal ?? "xterm-256color");
  const [encoding, setEncoding] = useState<"utf-8" | "windows-1252">(initialSession?.telnet_profile?.encoding ?? "utf-8");
  const serialPortExample = navigator.platform.includes("Win") ? "COM3"
    : navigator.platform.includes("Mac") ? "/dev/cu.usbserial-…" : "/dev/ttyUSB0";
  const [serialDevice, setSerialDevice] = useState(initialSession?.serial_profile?.device ?? "");
  const [serialDevices, setSerialDevices] = useState<SerialDeviceInfo[]>([]);
  const [serialDevicesLoading, setSerialDevicesLoading] = useState(false);
  const [serialDevicesError, setSerialDevicesError] = useState<string | null>(null);
  const [baudRate, setBaudRate] = useState(String(initialSession?.serial_profile?.baud_rate ?? 9600));
  const [dataBits, setDataBits] = useState<SerialConnectRequest["dataBits"]>(initialSession?.serial_profile?.data_bits ?? "eight");
  const [stopBits, setStopBits] = useState<SerialConnectRequest["stopBits"]>(initialSession?.serial_profile?.stop_bits ?? "one");
  const [parity, setParity] = useState<SerialConnectRequest["parity"]>(initialSession?.serial_profile?.parity ?? "none");
  const [flowControl, setFlowControl] = useState<SerialConnectRequest["flowControl"]>(initialSession?.serial_profile?.flow_control ?? "none");
  const [lineEnding, setLineEnding] = useState<SerialConnectRequest["lineEnding"]>(initialSession?.serial_profile?.line_ending ?? "cr-lf");
  const nativeRdpClipboardAvailable = supportsNativeRdpClipboard();

  const applyUri = () => {
    try {
      const parsed = parseQuickConnectUri(uri);
      if (IS_ANDROID && (parsed.protocol === "rdp" || parsed.protocol === "vnc")) throw Error("This connection type is not supported on Android.");
      setProtocol(parsed.protocol);
      setHost(parsed.host);
      setPort(String(parsed.port));
      setUsername(parsed.username);
      setMethod("keyboardInteractivePrompt");
      setCredentialId("");
      setKeyPath("");
      setPassphraseCredentialId("");
      setDomain("");
      setGatewayEndpoint("");
      setGatewayUsername("");
      setGatewayCredentialId("");
      setDesktopClipboardEnabled(false);
      setDesktopReconnectEnabled(true);
      setDesktopReconnectAttempts("3");
      setUriError(null);
      setValidationError(null);
    } catch (parseError) {
      setUri("");
      setUriError(parseError instanceof Error ? parseError.message : "The URI could not be applied.");
    }
  };

  const refreshSerialDevices = async () => {
    if (!IS_TAURI) {
      setSerialDevicesError("Device refresh requires the desktop runtime.");
      return;
    }
    setSerialDevicesLoading(true);
    setSerialDevicesError(null);
    try {
      setSerialDevices(await invoke<SerialDeviceInfo[]>("serial_list_devices"));
    } catch (refreshError) {
      setSerialDevicesError(String(refreshError));
    } finally {
      setSerialDevicesLoading(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (connecting) return;
    if (initialSession && onSave) {
      try {
        if (!sessionName.trim()) { throw new Error("Enter a session name."); }
        const auth: SavedAuth = protocol === "ssh"
          ? method === "privateKey" ? { kind: "privateKey", keyRef: keyPath, credentialRef: passphraseCredentialId.trim() || null }
            : method === "password" || method === "keyboardInteractive" ? { kind: method, credentialRef: credentialId.trim() }
            : { kind: method }
          : protocol === "rdp" || protocol === "vnc" ? credentialId.trim() ? { kind: "password", credentialRef: credentialId.trim() } : { kind: "none" }
          : initialSession.auth;
        if ((auth.kind === "password" || auth.kind === "keyboardInteractive") && !auth.credentialRef) throw new Error("Enter a credential reference.");
        if (auth.kind === "privateKey" && !auth.keyRef.trim()) throw new Error("Enter a private key path.");
        const keepalive = Number(serverAliveInterval);
        if (protocol === "ssh" && (!Number.isInteger(keepalive) || keepalive < 0 || keepalive > MAX_SERVER_ALIVE_INTERVAL_SECONDS)) throw new Error("Invalid SSH keepalive interval.");
        let desktopProfile = initialSession.remote_desktop_profile;
        if (protocol === "rdp" || protocol === "vnc") {
          const parsed = parseRemoteDesktopProfile(protocol === "rdp" ? "RDP" : "VNC", {
            domain, gatewayEndpoint, gatewayUsername, gatewayCredentialRef: gatewayCredentialId,
            width: desktopWidth, height: desktopHeight, colorDepth: desktopColorDepth, vncQuality,
            clipboardEnabled: desktopClipboardEnabled, allowInsecureVnc,
            reconnectEnabled: desktopReconnectEnabled, reconnectAttempts: desktopReconnectAttempts,
          });
          if (!parsed.ok) throw new Error(parsed.error);
          desktopProfile = { ...initialSession.remote_desktop_profile, ...parsed.profile, audio_enabled: initialSession.remote_desktop_profile?.audio_enabled ?? false };
        }
        const originalJump = initialSession.jump_host_profiles?.[0];
        const jumps = jumpHost.trim() ? [{ ...originalJump, host: jumpHost.trim(), port: Number(jumpPort), username: jumpUsername.trim() || username.trim(), auth: originalJump?.auth ?? { kind: "keyboardInteractivePrompt" as const } }, ...(initialSession.jump_host_profiles?.slice(1) ?? [])] : [];
        onSave({
          ...initialSession, pptp_profile_id: protocol === "ssh" || protocol === "telnet" ? pptpProfileId || null : null, name: sessionName.trim(), folder: sessionFolder.trim() || null,
          hostname: protocol === "local" ? initialSession.hostname : protocol === "serial" ? serialDevice.trim() : host.trim(),
          port: protocol === "local" || protocol === "serial" ? initialSession.port : Number(port),
          username: protocol === "ssh" || protocol === "telnet" || protocol === "rdp" || protocol === "vnc" ? username.trim() || null : initialSession.username,
          auth: protocol === "telnet" && (host.trim() !== initialSession.hostname || Number(port) !== initialSession.port || (username.trim() || null) !== initialSession.username) ? { kind: "none" } : auth, tags: [...new Set(tags.split(",").map(tag => tag.trim()).filter(Boolean))], notes: notes.trim() || null, favorite,
          startup_directory: startupDirectory.trim() || null, startup_command: startupCommand.trim() || null,
          environment: protocol === "ssh" || protocol === "local" ? parseSessionEnvironment(environmentText) : initialSession.environment,
          ...(protocol === "ssh" ? {
            known_hosts_path: knownHostsPath.trim() || null, pinned_fingerprint: pinnedFingerprint.trim() || null,
            x11_display: x11Enabled ? x11Display.trim() : null, x11_single_connection: x11SingleConnection,
            server_alive_interval: keepalive || null,
            // Preserve legacy host chains until explicitly edited in this form.
            ...(jumpHost.trim() !== (originalJump?.host ?? "") || originalJump ? { jump_host_profiles: jumps, jump_hosts: jumps.map(jump => jump.host) } : {}),
          } : {}),
          ...(protocol === "serial" ? { serial_profile: { device: serialDevice.trim(), baud_rate: Number(baudRate), data_bits: dataBits, stop_bits: stopBits, parity, flow_control: flowControl, line_ending: lineEnding } } : {}),
          ...(protocol === "telnet" ? { telnet_profile: { ...initialSession.telnet_profile, terminal: terminal.trim(), encoding, columns: initialSession.telnet_profile?.columns ?? 120, rows: initialSession.telnet_profile?.rows ?? 32 } } : {}),
          remote_desktop_profile: desktopProfile,
        });
      } catch (error) { setValidationError(error instanceof Error ? error.message : String(error)); }
      return;
    }
    if (protocol === "local") return;
    const targetError = experimentalDesktopTargetError(protocol, host, allowInsecureVnc);
    if (targetError) {
      setValidationError(targetError);
      return;
    }
    setValidationError(null);
    if (protocol === "telnet") {
      const password = telnetPassword.current?.value || undefined;
      if (password && !username.trim()) { setValidationError("Enter a username for Telnet auto login."); return; }
      if (telnetPassword.current) telnetPassword.current.value = "";
      onConnectTelnet({
        pptpProfileId: pptpProfileId || undefined,
        username: username.trim() || undefined, password, savePassword: saveTelnetPassword,
        host: host.trim(),
        port: Number(port),
        terminal: terminal.trim(),
        encoding,
        columns: 120,
        rows: 32,
      });
      return;
    }
    if (protocol === "serial") {
      onConnectSerial({
        device: serialDevice.trim(),
        baudRate: Number(baudRate),
        dataBits,
        stopBits,
        parity,
        flowControl,
        lineEnding,
      });
      return;
    }
    if (protocol === "rdp" || protocol === "vnc") {
      const parsedReconnectAttempts = Number(desktopReconnectAttempts);
      if (!Number.isInteger(parsedReconnectAttempts) || parsedReconnectAttempts < 0 || parsedReconnectAttempts > 10) {
        setValidationError("Reconnect attempts must be between 0 and 10.");
        return;
      }
      onConnectRemoteDesktop({
        protocol,
        host: host.trim(),
        port: Number(port),
        username: username.trim() || (protocol === "vnc" ? "viewer" : ""),
        domain: domain.trim() || undefined,
        gatewayEndpoint: protocol === "rdp" ? gatewayEndpoint.trim() || undefined : undefined,
        gatewayUsername: protocol === "rdp" ? gatewayUsername.trim() || undefined : undefined,
        gatewayCredentialId: protocol === "rdp" ? gatewayCredentialId.trim() || undefined : undefined,
        credentialId: credentialId.trim() || undefined,
        width: Number(desktopWidth),
        height: Number(desktopHeight),
        colorDepth: Number(desktopColorDepth),
        audioEnabled: false,
        clipboardEnabled: desktopClipboardEnabled && (protocol === "vnc" || nativeRdpClipboardAvailable),
        vncQuality,
        allowInsecureVnc: protocol === "vnc" && allowInsecureVnc,
        reconnectEnabled: desktopReconnectEnabled,
        reconnectAttempts: parsedReconnectAttempts,
      });
      return;
    }
    const auth = method === "keyboardInteractivePrompt"
      ? { method: "keyboardInteractivePrompt" as const }
      : method === "agent"
      ? { method: "agent" as const }
      : method === "privateKey"
        ? { method: "privateKey" as const, path: keyPath, passphraseCredentialId: passphraseCredentialId.trim() || undefined }
        : method === "keyboardInteractive"
          ? { method: "keyboardInteractive" as const, credentialId }
        : { method: "password" as const, credentialId };
    const parsedJumpPort = Number(jumpPort);
    const parsedServerAliveInterval = Number(serverAliveInterval);
    if (!Number.isInteger(parsedServerAliveInterval) || parsedServerAliveInterval < 0 || parsedServerAliveInterval > MAX_SERVER_ALIVE_INTERVAL_SECONDS) {
      setUriError(`ServerAliveInterval must be between 0 and ${MAX_SERVER_ALIVE_INTERVAL_SECONDS} seconds.`);
      return;
    }
    let environment: Array<[string, string]>;
    try {
      environment = parseSessionEnvironment(environmentText);
    } catch (parseError) {
      setValidationError(parseError instanceof Error ? parseError.message : "The session environment is invalid.");
      return;
    }
    const jumpHosts = jumpHost.trim() && Number.isInteger(parsedJumpPort) && parsedJumpPort > 0 && parsedJumpPort <= 65535
      ? [{ host: jumpHost.trim(), port: parsedJumpPort, username: jumpUsername.trim() || username.trim(), auth: { method: "keyboardInteractivePrompt" as const } }]
      : undefined;
    onConnectSsh({
      host: host.trim(),
      port: Number(port),
      username: username.trim(),
      auth,
      knownHostsPath: knownHostsPath.trim() || undefined,
      pinnedFingerprint: pinnedFingerprint.trim() || undefined,
      x11: x11Enabled ? { display: x11Display.trim(), singleConnection: x11SingleConnection } : undefined,
      serverAliveInterval: parsedServerAliveInterval,
      environment,
      startupDirectory: startupDirectory.trim() || undefined,
      startupCommand: startupCommand.trim() || undefined,
      jumpHosts,
      pptpProfileId: pptpProfileId || undefined,
      cols: 120,
      rows: 32,
    }, { name: sessionName.trim(), folder: sessionFolder.trim() });
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className={`quick-connect quick-connect-simple session-settings session-settings-${protocol}`}
        role="dialog"
        aria-modal="true"
        aria-label={initialSession ? "Edit session" : "New session"}
        onMouseDown={(event) => event.stopPropagation()}
        onInvalid={(event) => {
          const target = event.target as HTMLElement;
          const panel = target.closest<HTMLElement>("[data-session-tab]");
          if (panel) {
            panel.hidden = false;
            setSshTab(panel.dataset.sessionTab as typeof sshTab);
            event.preventDefault();
            requestAnimationFrame(() => target.focus());
          }
          let group = (event.target as HTMLElement).closest("details");
          while (group) { group.open = true; group = group.parentElement?.closest("details") ?? null; }
        }}
        onSubmit={submit}
      >
        <div className="quick-connect-heading">
          <div>
            <h2>{initialSession ? "Edit session" : "New session"}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close quick connect" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        {!initialSession && <details className="quick-connect-link"><summary>Paste a connection link</summary>
        <div className="quick-connect-uri">
          <label htmlFor="quick-connect-uri-input">Connection link</label>
          <div className="quick-connect-uri-row"><input id="quick-connect-uri-input" value={uri} onChange={(event) => { setUri(event.target.value); setUriError(null); }} placeholder="ssh://ops@example.com:22" autoComplete="off" /><button type="button" className="outline-button" onClick={applyUri} disabled={!uri.trim()}>Apply</button></div>
          <small>{IS_ANDROID ? "Supported: ssh:// and telnet://." : "Supported: ssh://, telnet://, rdp://, and vnc://."} Passwords and query options are never accepted in a URI.</small>
        </div>
        </details>}
        {uriError && <div className="connect-error-inline" role="alert">{uriError}</div>}

        <div className="session-protocols" role="group" aria-label="Session type">
          {[
            { value: "ssh", label: "SSH", icon: KeyRound },
            { value: "telnet", label: "Telnet", icon: TerminalIcon },
            { value: "serial", label: "Console", icon: Cable },
            { value: "rdp", label: "RDP", icon: Monitor },
            { value: "vnc", label: "VNC", icon: Monitor },
          ].filter(item => !IS_ANDROID || (item.value !== "rdp" && item.value !== "vnc")).map(item => <button key={item.value} type="button" disabled={!!initialSession && protocol !== item.value} aria-pressed={protocol === item.value} className={protocol === item.value ? "selected" : ""} onClick={() => {
            const next = item.value as typeof protocol;
            setProtocol(next);
            setAllowInsecureVnc(false);
            setPort(next === "ssh" ? "22" : next === "telnet" ? "23" : next === "rdp" ? "3389" : next === "vnc" ? "5900" : "0");
            setValidationError(null);
          }}><item.icon size={20} /><span>{item.label}</span></button>)}
          <button type="button" disabled={!!initialSession} aria-pressed={protocol === "local"} onClick={() => { onClose(); onShell(); }}><TerminalIcon size={20} /><span>Shell</span></button>
          {navigator.platform.includes("Win") && <button type="button" disabled={!!initialSession} onClick={() => { onClose(); onWsl(); }}><TerminalIcon size={20} /><span>WSL</span></button>}
        </div>
        {(initialSession || protocol === "ssh") && <details className="session-bookmark" open={bookmarkOpen} onToggle={event => {
          const open = event.currentTarget.open;
          setBookmarkOpen(open);
          try { localStorage.setItem("conxol.sessionBookmarkOpen", String(open)); } catch { /* Keep in-memory state when storage is unavailable. */ }
        }}>
          <summary className="session-basic-heading">Bookmark</summary>
          <div className="quick-connect-grid session-bookmark-grid">
                    <label>Session name<input required={!!initialSession} value={sessionName} onChange={event => setSessionName(event.target.value)} placeholder={username && host ? `${username}@${host}` : "My server"} /><small>{initialSession ? "Used for the saved session and terminal tab." : "Optional. Used for the saved session and terminal tab."}</small></label>
                    <label>Folder<input list="new-session-folders" value={sessionFolder} onChange={event => setSessionFolder(event.target.value)} placeholder="e.g. Production/Routers" /><datalist id="new-session-folders">{folders.map(folder => <option key={folder} value={folder} />)}</datalist></label>
          {initialSession && <>
          <label>Tags<input value={tags} onChange={event => setTags(event.target.value)} placeholder="Separate with commas" /></label>
          <label className="quick-connect-check-row"><input type="checkbox" checked={favorite} onChange={event => setFavorite(event.target.checked)} />Favorite</label>
          <label className="quick-connect-wide">Notes<textarea value={notes} onChange={event => setNotes(event.target.value)} /></label>
          </>}
          </div>
        </details>}
        <div className="session-basic-heading">{protocol === "serial" ? "Console settings" : `Basic ${protocol.toUpperCase()} settings`}</div>
        <div className="quick-connect-grid">
          {protocol === "local" ? <p className="quick-connect-wide">Local shell profile</p> : protocol === "serial" ? (
            <>
              <label className="quick-connect-wide">
                Serial port
                <div className="serial-device-input"><input autoFocus required list="serial-device-options" value={serialDevice} onChange={(event) => setSerialDevice(event.target.value)} placeholder={serialPortExample} /><button type="button" className="outline-button" onClick={() => void refreshSerialDevices()} disabled={serialDevicesLoading}>{serialDevicesLoading ? "Refreshing" : "Refresh"}</button></div>
                <datalist id="serial-device-options">{serialDevices.map((item) => <option key={item.device} value={item.device}>{item.kind === "Unknown" ? "" : item.kind}</option>)}</datalist>
                <small>Select a port or type one, such as {serialPortExample}.</small>
                {serialDevicesError && <small className="connect-error-inline" role="alert">{serialDevicesError}</small>}
              </label>
              <label>
                Baud rate
                <select value={baudRate} onChange={event => setBaudRate(event.target.value)}>
                  {!CONSOLE_BAUD_RATES.includes(Number(baudRate)) && <option value={baudRate}>{baudRate}</option>}
                  {CONSOLE_BAUD_RATES.map(rate => <option key={rate} value={rate}>{rate}</option>)}
                </select>
              </label>
              <details className="session-bookmark quick-connect-wide">
                <summary className="session-basic-heading">Advanced console settings</summary>
                <div className="quick-connect-grid session-bookmark-grid">
              <label>
                Data bits
                <select value={dataBits} onChange={(event) => setDataBits(event.target.value as SerialConnectRequest["dataBits"])}>
                  <option value="five">5</option>
                  <option value="six">6</option>
                  <option value="seven">7</option>
                  <option value="eight">8</option>
                </select>
              </label>
              <label>
                Stop bits
                <select value={stopBits} onChange={(event) => setStopBits(event.target.value as SerialConnectRequest["stopBits"])}>
                  <option value="one">1</option>
                  <option value="two">2</option>
                </select>
              </label>
              <label>
                Parity
                <select value={parity} onChange={(event) => setParity(event.target.value as SerialConnectRequest["parity"])}>
                  <option value="none">None</option>
                  <option value="odd">Odd</option>
                  <option value="even">Even</option>
                </select>
              </label>
              <label>
                Flow control
                <select value={flowControl} onChange={(event) => setFlowControl(event.target.value as SerialConnectRequest["flowControl"])}>
                  <option value="none">None</option>
                  <option value="software">Software</option>
                  <option value="hardware">Hardware</option>
                </select>
              </label>
              <label className="quick-connect-wide">
                Line ending
                <select value={lineEnding} onChange={(event) => setLineEnding(event.target.value as SerialConnectRequest["lineEnding"])}>
                  <option value="cr-lf">CRLF</option>
                  <option value="cr">CR</option>
                  <option value="lf">LF</option>
                  <option value="none">None</option>
                </select>
              </label>
                </div>
              </details>
            </>
          ) : (
            <>
              <label className="session-basic-host">
                Remote host
                <input autoFocus required value={host} onChange={(event) => setHost(event.target.value)} placeholder="bastion.example.com" />
                {protocol === "rdp" ? <small>RDP accepts a hostname or IP through native certificate validation; untrusted certificates fail closed. Real-server interoperability remains experimental.</small> : protocol === "vnc" ? <small>{allowInsecureVnc ? "Unencrypted TCP is explicitly enabled for this target; prefer an SSH tunnel or TLS-capable VNC server." : "Safe default: use 127.0.0.1 or ::1, including a local SSH-tunnel endpoint. Remote targets stay blocked until you opt in."}</small> : null}
              </label>
              <label className="session-basic-port">
                Port
                <input required inputMode="numeric" pattern="[0-9]+" value={port} onChange={(event) => setPort(event.target.value)} />
              </label>

              {protocol === "ssh" ? (
                <>
                  <label className="session-basic-username">
                    Username
                    <input {...literalInputProps} required value={username} onChange={(event) => setUsername(event.target.value)} placeholder="ops" />
                  </label>
                  <div className="session-settings-tabs quick-connect-wide" role="tablist" aria-label="SSH settings">
                    {([
                      ["advanced", "Advanced SSH"], ["terminal", "Terminal"], ["network", "Network"],
                    ] as const).map(([tab, label]) => <button key={tab} id={`session-tab-${tab}`} type="button" role="tab" aria-selected={sshTab === tab} aria-controls={`session-panel-${tab}`} onClick={() => setSshTab(tab)}>{label}</button>)}
                  </div>
                  <section className="session-settings-panel quick-connect-wide" id="session-panel-advanced" role="tabpanel" aria-labelledby="session-tab-advanced" data-session-tab="advanced" hidden={sshTab !== "advanced"}>
                  <details className="ssh-auth-override" open={method !== "keyboardInteractivePrompt"}>
                    <summary>Authentication <span>{method === "keyboardInteractivePrompt" ? "Auto" : "Custom"}</span></summary>
                  <label className="quick-connect-wide">
                    Authentication
                    <select value={method} onChange={(event) => setMethod(event.target.value as "agent" | "privateKey" | "password" | "keyboardInteractive" | "keyboardInteractivePrompt")}>
                      <option value="keyboardInteractivePrompt">Auto (recommended)</option>
                      <option value="agent">SSH agent</option>
                      <option value="privateKey">Private key</option>
                      <option value="password">Saved password</option>
                      <option value="keyboardInteractive">Saved challenge response</option>
                    </select>
                  </label>
                  {method === "privateKey" ? (
                    <>
                      <label className="quick-connect-wide">
                        Private key path
                        <input {...literalInputProps} required value={keyPath} onChange={(event) => setKeyPath(event.target.value)} placeholder="~/.ssh/id_ed25519" />
                        <small>The key stays on disk; only its path crosses IPC.</small>
                      </label>
                      <label className="quick-connect-wide">
                        Passphrase credential reference <span className="optional">optional</span>
                        <input {...literalInputProps} value={passphraseCredentialId} onChange={(event) => setPassphraseCredentialId(event.target.value)} placeholder="prod-key-passphrase" />
                        <small>Encrypted-key passphrases are retrieved natively from the vault.</small>
                      </label>
                    </>
                  ) : method === "password" || method === "keyboardInteractive" ? (
                    <label className="quick-connect-wide">
                      {method === "keyboardInteractive" ? "Keyboard-interactive response reference" : "Saved password name"}
                      <input {...literalInputProps} required value={credentialId} onChange={(event) => setCredentialId(event.target.value)} placeholder="prod-bastion-password" />
                      <small>{method === "keyboardInteractive" ? "The native layer answers non-echo prompts with this vault secret; echo prompts are refused." : "Enter the name of a password saved in the credential vault."}</small>
                    </label>
                  ) : (
                    <div className="quick-connect-wide quick-connect-hint">
                      <ShieldCheck size={14} />
                      <span>{method === "keyboardInteractivePrompt" ? "Detects the server’s login method and prompts when needed." : "Requires a loaded key in Windows OpenSSH agent or Pageant. For automatic login detection, choose Auto."}</span>
                    </div>
                  )}
                  </details>
                  </section>
                  <section className="session-settings-panel quick-connect-wide" id="session-panel-network" role="tabpanel" aria-labelledby="session-tab-network" data-session-tab="network" hidden={sshTab !== "network"}>
                  <PptpAttachment value={pptpProfileId} onChange={setPptpProfileId} />
                  <label className="quick-connect-wide">
                    Jump host <span className="optional">optional · Auto login</span>
                    <input value={jumpHost} onChange={(event) => setJumpHost(event.target.value)} placeholder="bastion.internal.example" />
                  </label>
                  {jumpHost.trim() && (
                    <>
                      <label>
                        Jump port
                        <input required inputMode="numeric" pattern="[0-9]+" value={jumpPort} onChange={(event) => setJumpPort(event.target.value)} />
                      </label>
                      <label>
                        Jump username
                        <input {...literalInputProps} required value={jumpUsername} onChange={(event) => setJumpUsername(event.target.value)} placeholder={username || "ops"} />
                      </label>
                    </>
                  )}
                  <label className="quick-connect-wide">
                    Known hosts path <span className="optional">optional · explicit only</span>
                    <input value={knownHostsPath} onChange={(event) => setKnownHostsPath(event.target.value)} placeholder="/path/to/known_hosts" />
                    <small>Leave empty to use saved Conxol trust or review an unknown host fingerprint. Personal known_hosts files are never read automatically.</small>
                  </label>
                  <label className="quick-connect-wide">
                    Pinned SHA-256 fingerprint <span className="optional">optional</span>
                    <input value={pinnedFingerprint} onChange={(event) => setPinnedFingerprint(event.target.value)} placeholder="SHA256:... (for deliberate first trust)" />
                  </label>
                  <label className="quick-connect-wide">
                    ServerAliveInterval <span className="optional">optional · seconds</span>
                    <input type="number" min="0" max={MAX_SERVER_ALIVE_INTERVAL_SECONDS} step="1" value={serverAliveInterval} onChange={(event) => setServerAliveInterval(event.target.value)} />
                    <small>0 disables SSH keepalives. The value is applied inside the native SSH layer.</small>
                  </label>
                  </section>
                  <section className="session-settings-panel quick-connect-wide" id="session-panel-terminal" role="tabpanel" aria-labelledby="session-tab-terminal" data-session-tab="terminal" hidden={sshTab !== "terminal"}>
                  <label>Startup directory<input value={startupDirectory} onChange={event => setStartupDirectory(event.target.value)} /></label>
                  <label>Startup command<input value={startupCommand} onChange={event => setStartupCommand(event.target.value)} /></label>
                  <label className="quick-connect-wide">
                    Remote environment <span className="optional">optional · NAME=value per line</span>
                    <textarea value={environmentText} onChange={(event) => setEnvironmentText(event.target.value)} placeholder={'TERM=xterm-256color\nLANG=C.UTF-8'} rows={4} />
                    <small>Applied only to this SSH shell. These values are session configuration, not vault secrets; do not put passwords or tokens here.</small>
                  </label>
                  <label className="quick-connect-wide quick-connect-check-row">
                    <input type="checkbox" checked={x11Enabled} onChange={(event) => setX11Enabled(event.target.checked)} />
                    <span>Enable SSH X11 forwarding <small>opt-in · external X server</small></span>
                  </label>
                  {x11Enabled && (
                    <>
                      <label className="quick-connect-wide">
                        Local X11 display target
                        <input required value={x11Display} onChange={(event) => setX11Display(event.target.value)} placeholder="tcp://127.0.0.1:6000 or unix:///tmp/.X11-unix/X0" />
                        <small>Explicit target only. Conxol does not read DISPLAY, Xauthority, firewall rules, or start an X server.</small>
                      </label>
                      <label className="quick-connect-wide quick-connect-check-row">
                        <input type="checkbox" checked={x11SingleConnection} onChange={(event) => setX11SingleConnection(event.target.checked)} />
                        <span>Allow one X11 connection only</span>
                      </label>
                    </>
                  )}
                  </section>


                </>
              ) : protocol === "rdp" || protocol === "vnc" ? (
                <>
                  <label className="quick-connect-wide">
                    Username <span className="optional">{protocol === "vnc" ? "optional for no-auth servers" : "required"}</span>
                    <input {...literalInputProps} required={protocol === "rdp"} value={username} onChange={(event) => setUsername(event.target.value)} placeholder={protocol === "rdp" ? "Administrator" : "viewer"} />
                  </label>
                  {protocol === "rdp" && <label>
                    Domain <span className="optional">optional</span>
                    <input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="WORKGROUP" />
                  </label>}
                  {protocol === "rdp" && <>
                    <label>
                      Gateway endpoint <span className="optional">optional · host:port</span>
                      <input value={gatewayEndpoint} onChange={(event) => setGatewayEndpoint(event.target.value)} placeholder="rdg.example.com:443" />
                      <small>Explicit RDS gateway only; system gateway settings are never discovered.</small>
                    </label>
                    <label>
                      Gateway username <span className="optional">required with gateway</span>
                      <input {...literalInputProps} value={gatewayUsername} onChange={(event) => setGatewayUsername(event.target.value)} placeholder="gateway-user" />
                    </label>
                    <label className="quick-connect-wide">
                      Gateway credential reference <span className="optional">required with gateway</span>
                      <input {...literalInputProps} value={gatewayCredentialId} onChange={(event) => setGatewayCredentialId(event.target.value)} placeholder="rdg-password" autoComplete="off" />
                      <small>Separate opaque vault reference; the secret is sent only through the native helper pipe.</small>
                    </label>
                  </>}
                  <label className="quick-connect-wide">
                    Credential reference <span className="optional">{protocol === "vnc" ? "optional for no-auth" : "required"}</span>
                    <input {...literalInputProps} required={protocol === "rdp"} value={credentialId} onChange={(event) => setCredentialId(event.target.value)} placeholder={protocol === "rdp" ? "windows-admin-password" : "vnc-password"} />
                    <small>Only an opaque vault reference crosses IPC. The secret is handed to the isolated native helper.</small>
                  </label>
                  <label>
                    Width
                    <input required inputMode="numeric" pattern="[0-9]+" value={desktopWidth} onChange={(event) => setDesktopWidth(event.target.value)} />
                  </label>
                  <label>
                    Height
                    <input required inputMode="numeric" pattern="[0-9]+" value={desktopHeight} onChange={(event) => setDesktopHeight(event.target.value)} />
                  </label>
                  {protocol === "rdp" ? <label>
                    Color depth
                    <select value={desktopColorDepth} onChange={(event) => setDesktopColorDepth(event.target.value)}><option value="16">16-bit</option><option value="32">32-bit</option></select>
                    <small>The current native RDP candidate supports 16-bit and 32-bit color depth.</small>
                  </label> : <label>
                    Quality
                    <select value={vncQuality} onChange={(event) => setVncQuality(event.target.value as RemoteDesktopConnectRequest["vncQuality"])}><option value="balanced">Balanced</option><option value="low-latency">Low latency</option><option value="low-bandwidth">Low bandwidth</option></select>
                    <small>Controls the VNC encoding preference and bounded refresh cadence.</small>
                  </label>}
                  {protocol === "vnc" && <label className="quick-connect-wide quick-connect-check-row">
                    <input type="checkbox" checked={allowInsecureVnc} onChange={(event) => setAllowInsecureVnc(event.target.checked)} />
                    <span>Allow unencrypted VNC over TCP <small>explicit opt-in · use an SSH tunnel or TLS-capable VNC server when possible</small></span>
                  </label>}
                  {(protocol === "rdp" || protocol === "vnc") && <label className="quick-connect-wide quick-connect-check-row">
                    <input type="checkbox" checked={desktopClipboardEnabled} disabled={protocol === "rdp" && !nativeRdpClipboardAvailable} onChange={(event) => setDesktopClipboardEnabled(event.target.checked)} />
                    <span>Enable clipboard redirection <small>{protocol === "vnc" ? "opt-in · local Latin-1 helper path" : nativeRdpClipboardAvailable ? "opt-in · native Windows backend" : "Windows only · unavailable in this build"}</small></span>
                  </label>}
                  <label className="quick-connect-wide quick-connect-check-row">
                    <input type="checkbox" checked={desktopReconnectEnabled} onChange={(event) => setDesktopReconnectEnabled(event.target.checked)} />
                    <span>Reconnect after connection loss <small>bounded and cancellable</small></span>
                  </label>
                  <label>
                    Reconnect attempts
                    <input type="number" min="0" max="10" step="1" value={desktopReconnectAttempts} onChange={(event) => setDesktopReconnectAttempts(event.target.value)} />
                    <small>0–10 retries after an active connection is lost.</small>
                  </label>
                  {protocol === "rdp" && <div className="quick-connect-wide quick-connect-hint"><ShieldCheck size={14} /><span>Audio redirection is not enabled in the current helper yet; the connection will use video and input only.</span></div>}
                  <div className="quick-connect-wide quick-connect-hint"><ShieldCheck size={14} /><span>{protocol === "rdp" ? "RDP accepts a hostname or IP and uses native platform certificate validation; untrusted certificates fail closed. Real-server and Windows interoperability remain experimental." : allowInsecureVnc ? "VNC plaintext TCP is enabled only by this explicit opt-in. Prefer an SSH tunnel or TLS-capable VNC server; Conxol does not add encryption." : "VNC defaults to IP-literal loopback targets and legacy transport; use a protected tunnel for a remote server, or explicitly opt in to unencrypted TCP."}</span></div>
                </>
              ) : (
                <>
                  <label className="quick-connect-wide">Username (optional)
                    <input {...literalInputProps} value={username} maxLength={256} onChange={event => setUsername(event.target.value)} autoComplete="off" />
                  </label>
                  {!initialSession && <>
                    <label className="quick-connect-wide">Password (optional)
                      <input {...literalInputProps} ref={telnetPassword} type="password" maxLength={4096} autoComplete="new-password" />
                    </label>
                    <label className="quick-connect-wide quick-connect-check-row">
                      <input type="checkbox" checked={saveTelnetPassword} onChange={event => setSaveTelnetPassword(event.target.checked)} />
                      <span>Save password in the system credential store</span>
                    </label>
                    <small className="quick-connect-wide">Leave blank to log in manually. Telnet sends credentials unencrypted.</small>
                  </>}
                  <details className="quick-connect-wide" open={!!pptpProfileId}>
                    <summary>Network</summary>
                    <PptpAttachment value={pptpProfileId} onChange={setPptpProfileId} />
                  </details>
                  <label className="quick-connect-wide">
                    Terminal type
                    <input required value={terminal} onChange={(event) => setTerminal(event.target.value)} placeholder="xterm-256color" />
                  </label>
                  <label className="quick-connect-wide">
                    Encoding
                    <select value={encoding} onChange={(event) => setEncoding(event.target.value as "utf-8" | "windows-1252")}>
                      <option value="utf-8">UTF-8</option>
                      <option value="windows-1252">Windows-1252</option>
                    </select>
                  </label>
                </>
              )}
            </>
          )}
        </div>

        {initialSession && protocol === "local" && <div className="quick-connect-grid">
          {protocol === "local" && <>
            <label>Startup directory<input value={startupDirectory} onChange={event => setStartupDirectory(event.target.value)} /></label>
            <label>Startup command<input value={startupCommand} onChange={event => setStartupCommand(event.target.value)} /></label>
            {protocol === "local" && <label className="quick-connect-wide">Environment<textarea value={environmentText} onChange={event => setEnvironmentText(event.target.value)} /></label>}
          </>}
        </div>}

        {validationError && <div className="connect-error" role="alert"><strong>{initialSession ? "Cannot save session" : "Connection blocked"}</strong><span>{validationError}</span></div>}

        {error && (
          <div className="connect-error" role="alert">
            <strong>{initialSession ? "Session update failed" : "Connection failed"}</strong>
            <span>{error}</span>
          </div>
        )}

        <div className="quick-connect-footer">
          <span>
            <ShieldCheck size={14} />
            {protocol === "ssh"
              ? "New host keys require approval."
              : protocol === "telnet"
                ? "Telnet traffic is plaintext and unauthenticated."
                : protocol === "rdp"
                  ? "RDP uses the isolated helper; credentials stay in the native vault boundary."
                  : protocol === "vnc"
                    ? "VNC capability is isolated; legacy VNC password transport is not SSH-level encryption."
                : "Connect directly to a serial console. This connection is not saved."}
          </span>
          <div>
            <button type="button" className="outline-button" onClick={onClose}>Cancel</button>
            <button className="primary-button" type="submit" disabled={connecting} aria-busy={connecting}>
              <Network size={14} />
              {connecting ? "Connecting…" : initialSession ? "Save session" : `Connect ${protocol === "ssh" ? "SSH" : protocol === "telnet" ? "Telnet" : protocol === "rdp" ? "RDP" : protocol === "vnc" ? "VNC" : "console"}`}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export default App;
