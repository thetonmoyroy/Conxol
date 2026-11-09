import assert from 'node:assert/strict';
import { fitAndroidTerminal, attachTerminalHorizontalPan } from '../src/terminal-mobile-layout.ts';
const { EventTarget, Event } = globalThis;

const grids = [];
for (const size of [{ cols: 38, rows: 30 }, { cols: 85, rows: 12 }, { cols: 140, rows: 45 }]) {
  assert(fitAndroidTerminal({ resize: (...grid) => grids.push(grid) }, { proposeDimensions: () => size }));
}
assert.deepEqual(grids, [[120, 30], [120, 12], [120, 45]], 'rotation and keyboard changes must not reflow columns');
assert(!fitAndroidTerminal({ resize: () => assert.fail() }, { proposeDimensions: () => undefined }));

const viewport = new EventTarget();
viewport.scrollLeft = 50;
let enabled = true;
const dispose = attachTerminalHorizontalPan(viewport, () => enabled);
const touch = (type, x, y, count = 1) => {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'touches', { value: Array.from({ length: count }, () => ({ clientX: x, clientY: y })) });
  viewport.dispatchEvent(event);
  return event;
};
touch('touchstart', 200, 200);
assert(!touch('touchmove', 197, 201).defaultPrevented, 'small movements preserve taps and selection');
assert(touch('touchmove', 100, 202).defaultPrevented);
assert.equal(viewport.scrollLeft, 150);
touch('touchend', 100, 202, 0);
touch('touchstart', 200, 200);
assert(!touch('touchmove', 198, 100).defaultPrevented, 'vertical gestures belong to xterm scrollback');
assert(!touch('touchmove', 50, 98).defaultPrevented, 'keep the initial vertical axis for diagonal gestures');
assert.equal(viewport.scrollLeft, 150);
touch('touchstart', 200, 200);
assert(!touch('touchmove', 100, 200, 2).defaultPrevented, 'leave multitouch to the browser');
assert(!touch('touchmove', 80, 200).defaultPrevented);
enabled = false;
touch('touchstart', 200, 200);
assert(!touch('touchmove', 100, 200).defaultPrevented);
enabled = true;
touch('touchstart', 200, 200);
enabled = false;
assert(!touch('touchmove', 100, 200).defaultPrevented, 'locking cancels an active gesture');
enabled = true;
dispose();
touch('touchstart', 200, 200);
assert(!touch('touchmove', 100, 200).defaultPrevented, 'disposed panes cannot consume gestures');
assert.equal(viewport.scrollLeft, 150);
