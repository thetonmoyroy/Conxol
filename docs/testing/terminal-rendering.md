# Terminal formatting in packaged builds

The startup screen must load its CSS from `apps/desktop/public/startup.css`
through the early stylesheet link in `index.html`. Do not put that CSS back in
an inline `<style>` block.

Tauri adds nonces to inline style blocks in embedded HTML. A nonce in `style-src`
causes Chromium to ignore `unsafe-inline` for other style elements. xterm 5.5
creates its font, whitespace, color and cell-layout styles dynamically without
that nonce. The packaged app then renders proportional, uncolored text with
collapsed column spacing, even though the development build works normally.

Keeping startup CSS external preserves the existing CSP and permits xterm's
runtime styles under the configured policy. It also retains the early dark
background and animated loader. SSH/Telnet stream bytes and serial newline
handling are unchanged.

Run `python tools/check-terminal-csp.py` after installing Python Playwright.
The check uses an already-installed Chrome/Edge/Chromium executable (override
with `--browser PATH`), a disposable browser context and a loopback-only fixture;
it does not connect to devices or use a personal browser profile. It reproduces
the blocked-style case, then verifies preserved whitespace, bundled monospace
font selection and ANSI color in the fixed case. Screenshots are written to
`target/terminal-csp-check/before.png` and `after.png`.

Also run `pnpm --dir apps/desktop build` and confirm the built index contains
`/startup.css` and no inline style block. A new installer requires a separately
requested release build; existing installed binaries do not receive this fix.
