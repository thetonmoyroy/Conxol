import { useState } from "react";
import { writeClipboardText } from "./clipboard-access";
import mtrLicense from "../../../tools/mtr/windows-x86_64/LICENSE.txt?raw";

type Credit = { name: string; author: string; use: string; license: string; url: string };
const groups: { title: string; entries: Credit[] }[] = [
  { title: "Native DNS diagnostics", entries: [
    { name: "Hickory DNS", author: "The Hickory DNS contributors", use: "DNS packet encoding, parsing and record formatting for Conxol’s built-in DNS diagnostics. No external dig executable is required.", license: "MIT OR Apache-2.0", url: "https://github.com/hickory-dns/hickory-dns" },
    { name: "ipconfig", author: "The ipconfig contributors", use: "Discovers configured DNS resolver addresses on Windows.", license: "MIT OR Apache-2.0", url: "https://github.com/liranringel/ipconfig" },
  ] },
  { title: "Bundled third-party binary", entries: [
    { name: "windows-mtr 1.2.9", author: "Benji Shohet (benjisho) and the Windows MTR contributors", use: "mtr.exe provides live MTR diagnostics on Windows. Distributed unmodified with its upstream license and provenance.", license: "Apache-2.0", url: "https://github.com/benjisho/windows-mtr/tree/v1.2.9" },
  ] },
  { title: "System and optional command-line tools", entries: [
    { name: "curl", author: "Daniel Stenberg and the curl contributors", use: "The system curl executable powers FTP, FTPS and TFTP client transfers. It is supplied by the operating system, not bundled by Conxol.", license: "curl license (MIT/X-inspired)", url: "https://curl.se/docs/copyright.html" },
    { name: "mtr (Linux / macOS)", author: "The mtr authors and contributors", use: "An installed mtr executable supplies MTR probe reports on Linux and macOS. Separate from the bundled Windows implementation.", license: "GNU GPL v2; see the installed distribution for details", url: "https://github.com/traviscross/mtr" },
    { name: "Windows ping, Command Prompt, Windows PowerShell and WSL", author: "Microsoft and the respective project contributors", use: "Operating-system executables used for ping diagnostics, local terminals and WSL session discovery. WSL distributions and their commands are installed separately.", license: "Terms provided with Windows and each installed component", url: "https://learn.microsoft.com/windows/" },
    { name: "Unix ping and system shell", author: "The platform utility and shell maintainers", use: "Linux/macOS ping supplies echo probes; the configured system shell or /bin/sh runs local sessions. Implementations vary by platform.", license: "See the installed operating-system or package notices", url: "https://github.com/iputils/iputils" },
    { name: "GNU Bash", author: "The Free Software Foundation and Bash contributors", use: "Optional installed shell for local terminal sessions; not bundled.", license: "See the installed Bash distribution", url: "https://www.gnu.org/software/bash/" },
    { name: "Zsh", author: "The Zsh developers and contributors", use: "Optional installed shell for local terminal sessions; not bundled.", license: "See the installed Zsh distribution", url: "https://www.zsh.org/" },
    { name: "fish", author: "The fish-shell developers and contributors", use: "Optional installed shell for local terminal sessions; not bundled.", license: "See the installed fish distribution", url: "https://fishshell.com/" },
  ] },
  { title: "Projects used by Conxol’s bundled VNC helper", entries: [
    { name: "vnc-rs", author: "HsuJv and vnc-rs contributors", use: "VNC protocol implementation compiled into conxol-vnc-helper. The helper itself is part of Conxol.", license: "MIT OR Apache-2.0", url: "https://github.com/HsuJv/vnc-rs" },
    { name: "jpeg-decoder", author: "The image-rs Developers", use: "JPEG decoding compiled into the VNC helper.", license: "MIT OR Apache-2.0", url: "https://github.com/image-rs/jpeg-decoder" },
  ] },
  { title: "Installer tooling", entries: [
    { name: "NSIS", author: "The NSIS developers and contributors", use: "Installer engine used when building Conxol’s Windows NSIS installer. It is not required by the portable app.", license: "See the NSIS distribution’s component licenses", url: "https://nsis.sourceforge.io/License" },
  ] },
  { title: "Desktop web runtimes", entries: [
    { name: "Microsoft Edge WebView2", author: "Microsoft and Chromium contributors", use: "Web rendering runtime used by the Windows desktop app.", license: "Microsoft WebView2 terms and third-party notices", url: "https://developer.microsoft.com/microsoft-edge/webview2/" },
    { name: "WebKit / WebKitGTK", author: "The WebKit project and contributors", use: "Platform web rendering on macOS and Linux, respectively.", license: "See the platform WebKit distribution and notices", url: "https://webkit.org/" },
  ] },
];

export function ThirdPartyCredits() {
  const [notice, setNotice] = useState("");
  return <>
    <h3>Open-source credits</h3>
    <article className="help-credit">
      <div className="help-credit-heading"><strong>MobaRust / original project</strong><span>Apache-2.0</span></div>
      <p className="help-credit-author">Othmane Blial and contributors</p>
      <p>Conxol is based on this project. Thank you to its original author and contributors for the foundation. The upstream copyright notice is retained.</p>
      <div className="help-credit-source"><a href="https://github.com/OthmaneBlial/MobaRust" target="_blank" rel="noopener noreferrer">Original project</a></div>
    </article>
    <p className="help-note">Thank you to the authors and maintainers of the tools used by Conxol. Availability depends on platform and installed components. These credits summarize executable integrations; each project’s license and distribution notices remain authoritative.</p>
    {groups.map(group => <section className="help-credit-group" key={group.title} aria-label={group.title}>
      <h4>{group.title}</h4>
      {group.entries.map(entry => <article className="help-credit" key={entry.name}>
        <div className="help-credit-heading"><strong>{entry.name}</strong><span>{entry.license}</span></div>
        <p className="help-credit-author">{entry.author}</p>
        <p>{entry.use}</p>
        <div className="help-credit-source"><a href={entry.url} target="_blank" rel="noopener noreferrer">Project / license</a><button type="button" onClick={() => { void writeClipboardText(entry.url).then(() => setNotice(`Copied ${entry.name} link.`), () => setNotice("Could not copy the link.")); }}>Copy link</button></div>
      </article>)}
    </section>)}
    <details className="help-credit-license"><summary>Bundled windows-mtr license — Apache License 2.0</summary><pre tabIndex={0}>{mtrLicense}</pre></details>
    <p className="help-note">Other commands you run inside a terminal and software inside WSL distributions are provided by their own publishers. The experimental RDP helper is excluded from normal application bundles.</p>
    {notice && <p className="help-note" role="status">{notice}</p>}
  </>;
}
