import { createContext, useContext } from "react";
export type WorkspaceLockStatus = { enabled: boolean; locked: boolean; idleMinutes: number; retryAfterSeconds: number };
let locked = true;
export function setWorkspaceLocked(value: boolean) { locked = value; }
export function isWorkspaceLocked() { return locked; }
export const WorkspaceLockContext = createContext<{ status: WorkspaceLockStatus | null; refresh: () => Promise<void>; lock: () => Promise<void> }>({ status: null, refresh: async () => {}, lock: async () => {} });
export function useWorkspaceLock() { return useContext(WorkspaceLockContext); }
export function validWorkspacePin(pin: string): boolean { return pin.length >= 4 && pin.length <= 12 && !/[^0-9]/.test(pin); }
