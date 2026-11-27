/** Refit after font/layout changes have settled; coalesce rapid zoom steps. */
export function createTerminalFitScheduler(fit: () => boolean, followBottom: () => void, request: (callback: () => void) => number, cancel: (id: number) => void) {
  let frame: number | null = null;
  let follow = false;
  let disposed = false;
  return {
    schedule(atBottom = false) {
      if (disposed) return;
      follow ||= atBottom;
      if (frame !== null) return;
      frame = request(() => {
        frame = null;
        if (disposed) return;
        const scroll = follow;
        follow = false;
        if (fit() && scroll) followBottom();
      });
    },
    dispose() {
      disposed = true;
      if (frame !== null) cancel(frame);
      frame = null;
    },
  };
}

/** Apply the latest size after any update already in flight. */
export function createTerminalResizeQueue(resize: (cols: number, rows: number) => Promise<void>) {
  let pending = Promise.resolve();
  return (cols: number, rows: number) => {
    const update = pending.catch(() => undefined).then(() => {
      if (pending === update) return resize(cols, rows);
    });
    pending = update;
    return update;
  };
}
