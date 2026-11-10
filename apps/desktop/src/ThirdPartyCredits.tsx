import { useState } from "react";
import { writeClipboardText } from "./clipboard-access";

type Credit = { name: string; author: string; use: string; license: string; url: string };
const groups: { title: string; entries: Credit[] }[] = [
  { title: "Native DNS diagnostics", entries: [
    { name: "Hickory DNS", author: "The Hickory DNS contributors", use: "DNS packet encoding, parsing and record formatting for Conxol’s built-in DNS diagnostics. No external dig executable is required.", license: "MIT OR Apache-2.0", url: "https://github.com/hickory-dns/hickory-dns" },
  ] },
  { title: "System and optional command-line tools", entries: [
    { name: "curl", author: "Daniel Stenberg and the curl contributors", use: "The system curl executable powers FTP, FTPS and TFTP client transfers. It is supplied by the operating system, not bundled by Conxol.", license: "curl license (MIT/X-inspired)", url: "https://curl.se/docs/copyright.html" },
    { name: "Command Prompt, Windows PowerShell and WSL", author: "Microsoft and the respective project contributors", use: "Operating-system executables used for local terminals and WSL session discovery. WSL distributions and their commands are installed separately.", license: "Terms provided with Windows and each installed component", url: "https://learn.microsoft.com/windows/" },
    { name: "Unix system shell", author: "The platform utility and shell maintainers", use: "The configured system shell or /bin/sh runs local sessions. Implementations vary by platform.", license: "See the installed operating-system or package notices", url: "https://pubs.opengroup.org/onlinepubs/9799919799/utilities/sh.html" },
    { name: "GNU Bash", author: "The Free Software Foundation and Bash contributors", use: "Optional installed shell for local terminal sessions; not bundled.", license: "See the installed Bash distribution", url: "https://www.gnu.org/software/bash/" },
    { name: "Zsh", author: "The Zsh developers and contributors", use: "Optional installed shell for local terminal sessions; not bundled.", license: "See the installed Zsh distribution", url: "https://www.zsh.org/" },
    { name: "fish", author: "The fish-shell developers and contributors", use: "Optional installed shell for local terminal sessions; not bundled.", license: "See the installed fish distribution", url: "https://fishshell.com/" },
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
    <p className="help-note">Thank you to the authors and maintainers of the projects used by Conxol. Availability depends on platform and installed components. These credits cover Conxol components and third-party integrations; each project’s license and distribution notices remain authoritative.</p>
    {groups.map(group => <section className="help-credit-group" key={group.title} aria-label={group.title}>
      <h4>{group.title}</h4>
      {group.entries.map(entry => <article className="help-credit" key={entry.name}>
        <div className="help-credit-heading"><strong>{entry.name}</strong><span>{entry.license}</span></div>
        <p className="help-credit-author">{entry.author}</p>
        <p>{entry.use}</p>
        <div className="help-credit-source"><a href={entry.url} target="_blank" rel="noopener noreferrer">Project / license</a><button type="button" onClick={() => { void writeClipboardText(entry.url).then(() => setNotice(`Copied ${entry.name} link.`), () => setNotice("Could not copy the link.")); }}>Copy link</button></div>
      </article>)}
    </section>)}
    <p className="help-note">Other commands you run inside a terminal and software inside WSL distributions are provided by their own publishers.</p>
    {notice && <p className="help-note" role="status">{notice}</p>}
  </>;
}
