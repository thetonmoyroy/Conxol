export function canReconnectTerminal(protocol: string | null | undefined, status: string, connecting = false): boolean {
  return !connecting && (protocol === "ssh" || protocol === "telnet" || protocol === "serial") && (status === "closed" || status === "error");
}

export function isReconnectKey(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean; isComposing: boolean }): boolean {
  return event.key.toLowerCase() === "r" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat && !event.isComposing;
}
