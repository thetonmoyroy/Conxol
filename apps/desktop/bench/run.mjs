// Start Vite: pnpm --dir apps/desktop exec vite --host 127.0.0.1 --port 1427
// Install playwright-core outside the repo and set PLAYWRIGHT_CORE_PATH to its
// absolute module directory, or make it available through Node resolution.
// Run: node apps/desktop/bench/run.mjs [1|4] (CPU slowdown factor).
// Headless Edge isolates xterm/highlighting; it does not benchmark Tauri or transport.
import { createRequire } from 'node:module';
import process from 'node:process';
import console from 'node:console';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
import fs from 'node:fs';
(async () => {
 const browser = await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 try {
 const page = await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror', e => console.error(e));
 await page.goto('http://127.0.0.1:1427/bench/terminal.html');
 await page.waitForFunction(() => typeof globalThis.runTerminalBenchmark === 'function');
 const rate = Number(process.argv[2] || 1); if (![1, 4].includes(rate)) throw new Error('CPU rate must be 1 or 4'); const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', {rate}); const results = [];
 for (const enabled of [false,true,true,false,false,true]) {
   const r = await page.evaluate(enabled => globalThis.runTerminalBenchmark(enabled), enabled);
   results.push(r); console.log(JSON.stringify(r));
 }
 fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), `terminal-results${rate === 4 ? '-cpu4x' : ''}.json`),JSON.stringify({cpuThrottle:rate, renderer:'dom', environment:'Headless Microsoft Edge, Windows; synthetic xterm renderer only; no SSH/Telnet/IPC',results},null,2));
 } finally {await browser.close();}
})().catch(e => {console.error(e);process.exitCode=1});


