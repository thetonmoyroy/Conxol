"""Reproduce packaged xterm CSS blocking and check the startup stylesheet fix.

Requires Python Playwright and an installed Chromium/Chrome/Edge browser.
Uses only a disposable browser profile and a loopback HTTP fixture.
"""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import shutil
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / 'apps/desktop'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', help='Installed Chrome, Chromium or Edge executable')
    args = parser.parse_args()
    browser_path = args.browser or next((str(path) for path in [
        Path('C:/Program Files/Google/Chrome/Application/chrome.exe'),
        Path('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'),
    ] if path.is_file()), None) or shutil.which('chromium') or shutil.which('google-chrome')
    if not browser_path:
        raise RuntimeError("Pass --browser with an installed Chromium, Chrome or Edge executable")
    index = (DESKTOP / 'index.html').read_text(encoding='utf-8')
    head = re.search(r'<head>(.*?)</head>', index, re.S).group(1)
    assert not re.search(r'<style\b', head), 'Inline startup CSS recreates the packaged xterm CSP regression'
    assert 'href="/startup.css"' in head
    policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'none'"
    boot = '''
      const terminal = new Terminal({cols: 100, rows: 10, fontSize: 16,
        fontFamily: '"Conxol Terminal", Consolas, monospace',
        theme: { background: '#0b100f', foreground: '#dce8dc', green: '#9bc48a' }});
      terminal.open(document.getElementById('host'));
      terminal.write('Welcome to BDCOM fixture\\r\\nPort          Description        Status    Vlan\\r\\n' +
        'tg0/0/1       SHK_20G            \\x1b[32mup\\x1b[0m        Trunk(1)\\r\\n' +
        'tg0/0/2       SHK_20G            down      214\\r\\n', () => { window.fixtureReady = true; });
    '''
    files = {
        '/boot.js': (boot.encode(), 'text/javascript'),
        '/xterm.js': ((DESKTOP / 'node_modules/@xterm/xterm/lib/xterm.js').read_bytes(), 'text/javascript'),
        '/xterm.css': ((DESKTOP / 'node_modules/@xterm/xterm/css/xterm.css').read_bytes(), 'text/css'),
        '/app.css': ((DESKTOP / 'src/styles.css').read_bytes(), 'text/css'),
        '/startup.css': ((DESKTOP / 'public/startup.css').read_bytes(), 'text/css'),
    }
    for font in (DESKTOP / 'src/assets/fonts').glob('*.woff2'):
        files['/assets/fonts/' + font.name] = (font.read_bytes(), 'font/woff2')

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def do_GET(self):
            if self.path in ('/before', '/after'):
                before = self.path == '/before'
                # Tauri nonces inline <style> elements in packaged HTML. Browsers
                # then ignore unsafe-inline for dynamically generated xterm CSS.
                styles = '<style nonce="fixture-nonce">html,body {background:#0b100f}</style>' if before else ''
                html = '<!doctype html><html><head>' + head + styles + '<link rel="stylesheet" href="/xterm.css"><link rel="stylesheet" href="/app.css"></head><body><div id="host"></div><script src="/xterm.js"></script><script src="/boot.js"></script></body></html>'
                body, kind = html.encode(), 'text/html'
                csp = policy.replace("style-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' 'nonce-fixture-nonce'") if before else policy
            elif self.path in files:
                body, kind = files[self.path]
                csp = policy
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Security-Policy', csp)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    output = ROOT / 'target/terminal-csp-check'
    output.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=browser_path, headless=True)
            try:
                context = browser.new_context(viewport={'width': 1050, 'height': 380})
                context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{server.server_port}/') else route.abort())
                for case in ('before', 'after'):
                    page = context.new_page()
                    page.goto(f'http://127.0.0.1:{server.server_port}/{case}')
                    page.wait_for_function('window.fixtureReady === true')
                    page.evaluate('document.fonts.ready')
                    result = page.locator('.xterm-rows').evaluate('(el) => ({font: getComputedStyle(el).fontFamily, whitespace: getComputedStyle(el).whiteSpace, color: getComputedStyle(el.querySelector(".xterm-fg-2")).color})')
                    page.screenshot(path=str(output / f'{case}.png'))
                    if case == 'before':
                        assert result['whitespace'] == 'normal', result
                    else:
                        assert result['whitespace'] == 'pre', result
                        assert 'Conxol Terminal' in result['font'], result
                        assert result['color'] == 'rgb(155, 196, 138)', result
                    print(case, result)
                    page.close()
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    print('Packaged-CSP regression reproduced; external startup CSS preserves xterm columns, font and ANSI colors.')


if __name__ == '__main__':
    main()
