import type { Terminal } from "@xterm/xterm";

/** The source emulator answers protocol queries, including during handoff.
 * The mirrored emulator must render output without answering those queries twice. */
export function suppressMirroredTerminalReports(terminal: Pick<Terminal, "parser">) {
  const handlers = [
    ...[
      { final: "c" }, { prefix: ">", final: "c" },
      { final: "n" }, { prefix: "?", final: "n" },
      { intermediates: "$", final: "p" }, { prefix: "?", intermediates: "$", final: "p" },
      { final: "t" },
    ].map(identifier => terminal.parser.registerCsiHandler(identifier, () => true)),
    terminal.parser.registerDcsHandler({ intermediates: "$", final: "q" }, () => true),
    ...[4, 10, 11, 12].map(identifier => terminal.parser.registerOscHandler(identifier, data => data.split(";").includes("?"))),
  ];
  return () => handlers.forEach(handler => handler.dispose());
}
