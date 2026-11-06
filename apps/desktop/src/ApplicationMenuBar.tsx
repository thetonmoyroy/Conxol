import { useEffect, useRef, type ReactNode } from "react";

function closeMenus(nav: HTMLElement) {
  nav.querySelectorAll("details[open]").forEach(menu => menu.removeAttribute("open"));
}

export function ApplicationMenuBar({ children }: { children: ReactNode }) {
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const nav = navRef.current;
      if (nav && !nav.contains(event.target as Node)) closeMenus(nav);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, []);

  return <nav ref={navRef} className="desktop-menubar" aria-label="Application menu"
    onBlur={event => {
      // WebKit on macOS does not focus clicked buttons. A null relatedTarget
      // must not hide the clicked item between pointerdown and click.
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) closeMenus(event.currentTarget);
    }}
    onClick={event => {
      if ((event.target as Element).closest("button")) closeMenus(event.currentTarget);
    }}
    onKeyDown={event => {
      if (event.key === "Escape") {
        const menu = (event.target as Element).closest("details");
        menu?.removeAttribute("open");
        menu?.querySelector("summary")?.focus();
      }
    }}
  >{children}</nav>;
}
