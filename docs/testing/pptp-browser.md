# PPTP browser

On Windows, connect a profile in Tools > PPTP manager and click **Open browser**
on its row. A separate window opens Google. Enter an HTTP/HTTPS URL or search
words in the address bar and press Enter. The address follows native page
navigation and redirects. Back/forward operate the active page's history;
reload/stop, Google home, and Ctrl+L are available in the toolbar.
Bare IPv4 destinations default to HTTP, including ports and paths. An explicit
HTTP or HTTPS scheme is preserved; hostnames default to HTTPS.

**New session > Web** saves a named website in the normal sidebar library,
including its folder and a required PPTP profile. `WEB` records store the complete
HTTP/HTTPS URL in `hostname`, its effective port in `port`, and the route in
`pptp_profile_id`. They carry no SSH credentials or startup commands. The normal
session store, edit/delete/favorite tools and encrypted backup preserve them.
Opening a Web session resolves the saved record natively, starts or awaits the
assigned PPTP connection with its saved password, and opens the saved URL in a
new tab in that profile's browser. There is no direct-network option. Profiles
without a saved password must first be connected in PPTP manager. Existing
browser tabs are preserved. Windows WebView2 is currently required to open sites.
Run `cargo xtask test-web-sessions` for URL/route validation and session-store
round-trip regressions, and the frontend `saved-web-session.test.mjs` for URL
normalization and form-record validation. The Web form was visually inspected
in a local browser preview; live PPTP opening remains manual acceptance.

The tab strip creates up to 12 independent native webviews. Switching tabs
preserves each page, title, URL, login state, and history. Tabs share the browser
window's temporary WebView2 profile and PPTP proxy. Closing a tab closes its
webview; closing the final tab closes only that browser window.

**Inspect** toggles a 360px network panel, resizing the actual native page rather
than overlaying it. The panel shows profile/server routing, DNS resolver,
destination IPv4/port, requested page URL, HTTP status and navigation failures.
Its connection list covers all tabs, retains up to 128 transport events in memory,
and offers error filtering, clearing, per-destination timings and byte totals.
Background browser failures remain in this list rather than replacing the active
page's error message. **Developer tools** opens WebView2's own Console, Network
and Elements tools for JavaScript errors and resource-level request details.
HTTPS bodies are not decrypted by Conxol's proxy; transport success alone does
not prove that a site's login scripts ran successfully.

Navigation completion and HTTP failures are observed through WebView2's native
NavigationCompleted event. Proxy arguments preserve Wry's normal disabling of
WebView2 SmartScreen/UI service features, avoiding navigation delays while those
services are unreachable through a private tunnel. No certificate bypass is used.

Each browser uses its own temporary WebView2 data directory and a bounded
loopback SOCKS5 listener. TCP connections and Google DNS (8.8.8.8, TCP/53) use
the selected private PPTP connector. There is no host DNS or direct TCP fallback.
Only IPv4 destinations are supported. The tunnel must be able to reach the DNS
resolver and the requested website; private IPv4 URLs do not require DNS.
Popups and non-HTTP(S) navigation are blocked. WebRTC non-proxied UDP and QUIC
are disabled. Browser content cannot invoke workspace commands. Closing the
browser stops its proxy and active requests; disconnecting the tunnel or locking
the workspace closes the browser. Closing a browser leaves Conxol running.

Validation: frontend URL regression tests, TypeScript and lint checks, and native
`cargo xtask test-pptp-browser` (tab selection/close behavior, bounded diagnostics,
IP retention after navigation failure, URL validation and a disposable loopback
SOCKS5 handshake verifying failure without direct fallback without a tunnel).
The browser preview layout was rendered and inspected at 1280×820 using an
isolated headless Edge profile against the local Vite server.
The proxy starts accepting before WebView2 navigates, and its loopback endpoint
is explicitly excluded from WebView2's host DNS blocking rule.
Live PPTP/Google browsing and WebView2 runtime behavior require
manual acceptance on Windows; compilation alone does not verify those paths.
No release build or installer is required for these checks.
