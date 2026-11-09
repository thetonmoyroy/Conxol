import type { IDisposable, ITerminalAddon } from "@xterm/xterm";

type GpuAddon = ITerminalAddon & {
  onContextLoss: (listener: () => void) => IDisposable;
};
type RendererTerminal = {
  rows: number;
  loadAddon: (addon: ITerminalAddon) => void;
  refresh: (start: number, end: number) => void;
};

/** A renderer failure must fall back without remounting or closing the transport. */
export function attachTerminalGpuRenderer(terminal: RendererTerminal, createAddon: () => GpuAddon): IDisposable {
  let addon: GpuAddon | undefined;
  let contextLoss: IDisposable | undefined;
  const dispose = () => {
    contextLoss?.dispose();
    contextLoss = undefined;
    const previous = addon;
    addon = undefined;
    previous?.dispose();
  };
  try {
    addon = createAddon();
    contextLoss = addon.onContextLoss(() => {
      dispose();
      terminal.refresh(0, terminal.rows - 1);
    });
    terminal.loadAddon(addon);
  } catch {
    // Unsupported WebGL2 leaves xterm's existing DOM renderer usable.
    dispose();
  }
  return { dispose };
}
