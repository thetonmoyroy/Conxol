import assert from 'node:assert/strict';
import { fitAndroidTerminal, attachTerminalTouchPan } from '../src/terminal-mobile-layout.ts';
const { EventTarget, Event, performance, console } = globalThis;

const grids = [];
for (const size of [{ cols: 38, rows: 30 }, { cols: 85, rows: 12 }, { cols: 140, rows: 45 }]) {
  assert(fitAndroidTerminal({ resize: (...grid) => grids.push(grid) }, { proposeDimensions: () => size }));
}
assert.deepEqual(grids, [[120, 30], [120, 12], [120, 45]], 'rotation and keyboard changes must not reflow columns');
assert(!fitAndroidTerminal({ resize: () => assert.fail() }, { proposeDimensions: () => undefined }));

const viewport = new EventTarget();
viewport.scrollLeft = 50;
let enabled = true;
const dispose = attachTerminalTouchPan(viewport, () => enabled);
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

// Touch movement reaches xterm immediately; xterm owns paint scheduling.
const frames = new Map();
let frameId = 0;
globalThis.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
function fixture(initial = 100) {
  const surface = new EventTarget();
  surface.scrollLeft = 0;
  let position = initial, active = true, normal = true, calls = 0;
  const dispose = attachTerminalTouchPan(surface, () => active, {
    rowHeight: () => 10,
    scrollLines: lines => { calls++; position = Math.max(0, Math.min(1000, position + lines)); },
    viewportY: () => position,
    normalBuffer: () => normal,
  });
  const touch = (type, y, time, count = 1) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, { touches: { value: Array.from({length: count}, () => ({clientX: 100, clientY: y})) }, timeStamp: {value: time} });
    surface.dispatchEvent(event);
    return event;
  };
  return {touch, dispose, position: () => position, calls: () => calls, lock: () => { active = false; }, alternate: () => { normal = false; }};
}
const frame = time => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)); };
try {
  const direct = fixture();
  direct.touch('touchstart', 100, 0);
  assert(direct.touch('touchmove', 40, 20).defaultPrevented);
  assert.equal(direct.position(), 106, 'drag updates the buffer in the input task, without an extra animation frame');
  assert.equal(frames.size, 0, 'drag must rely on xterm paint coalescing rather than its own delay');
  direct.touch('touchmove', -400, 30);
  assert.equal(direct.position(), 150, 'large sparse emulator moves must not leave an easing backlog');
  direct.touch('touchend', -400, 200, 0);
  assert.equal(frames.size, 0, 'holding before release must not fling');
  direct.dispose();

  function fling(hz) {
    const scroll = fixture(500);
    scroll.touch('touchstart', 100, 0);
    scroll.touch('touchmove', 50, 20);
    scroll.touch('touchend', 50, 21, 0);
    const start = performance.now();
    for (let step = 1; step <= hz; step++) frame(start + step * 1000 / hz);
    const distance = scroll.position() - 500;
    scroll.dispose();
    return distance;
  }
  const sixty = fling(60), high = fling(120), faster = fling(144);
  assert(Math.abs(sixty - high) <= 1, '120Hz fling distance must match 60Hz within one row');
  assert(Math.abs(sixty - faster) <= 1, '144Hz must not change scrolling speed');

  const interrupted = fixture();
  interrupted.touch('touchstart', 100, 0);
  interrupted.touch('touchmove', 50, 10);
  interrupted.touch('touchend', 50, 11, 0);
  assert.equal(frames.size, 1);
  interrupted.touch('touchstart', 100, 20);
  assert.equal(frames.size, 0, 'touching again interrupts momentum');
  interrupted.touch('touchmove', 50, 30);
  interrupted.touch('touchend', 50, 31, 0);
  interrupted.lock();
  const before = interrupted.position();
  frame(performance.now() + 16);
  assert.equal(interrupted.position(), before, 'locking cancels momentum');
  assert.equal(frames.size, 0);
  interrupted.dispose();

  const boundary = fixture(0);
  boundary.touch('touchstart', 100, 0);
  boundary.touch('touchmove', 150, 10);
  boundary.touch('touchend', 150, 11, 0);
  frame(performance.now() + 16);
  assert.equal(frames.size, 0, 'momentum stops at the history boundary');
  boundary.dispose();

  const alternate = fixture();
  alternate.alternate();
  alternate.touch('touchstart', 100, 0);
  assert(!alternate.touch('touchmove', 50, 10).defaultPrevented, 'alternate-screen applications retain xterm touch behavior');
  alternate.dispose();
  const closed = fixture();
  closed.touch('touchstart', 100, 0);
  closed.touch('touchmove', 50, 10);
  closed.touch('touchend', 50, 11, 0);
  closed.dispose();
  assert.equal(frames.size, 0, 'closing a terminal cancels momentum');
} finally {
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
}
console.log('Android scroll: immediate drag, refresh-independent momentum, interruption and disposal passed');
