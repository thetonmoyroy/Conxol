export const DEFAULT_SIDEBAR_WIDTH = 164;
export const MIN_SIDEBAR_WIDTH = 140;
export function sidebarWidth(width: number, viewportWidth: number): number {
  return Math.round(Math.min(Math.max(MIN_SIDEBAR_WIDTH, viewportWidth - 390), Math.max(MIN_SIDEBAR_WIDTH, Number.isFinite(width) ? width : DEFAULT_SIDEBAR_WIDTH)));
}
