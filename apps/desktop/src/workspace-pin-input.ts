import type { FormEvent, ClipboardEvent } from "react";
import { literalInputProps } from "./literal-input.ts";

// Keep PINs uncontrolled: secrets must not enter React state.
export function filterPinInput(event: FormEvent<HTMLInputElement>) {
  const field = event.currentTarget;
  const value = field.value;
  const next = value.replace(/[^0-9]/g, "").slice(0, 12);
  if (value === next) return;
  const caret = value.slice(0, field.selectionStart ?? value.length).replace(/[^0-9]/g, "").length;
  field.value = next;
  field.setSelectionRange(Math.min(caret, next.length), Math.min(caret, next.length));
}

export function guardPinPaste(event: ClipboardEvent<HTMLInputElement>) {
  // Reject a mixed paste rather than silently changing the user's secret.
  if (/[^0-9]/.test(event.clipboardData.getData("text"))) event.preventDefault();
}

export const workspacePinInputProps = {
  ...literalInputProps,
  inputMode: "numeric",
  pattern: "[0-9]{4,12}",
  minLength: 4,
  maxLength: 12,
  onBeforeInput: (event: FormEvent<HTMLInputElement>) => {
    const data = (event.nativeEvent as InputEvent).data;
    if (data && /[^0-9]/.test(data)) event.preventDefault();
  },
  onInput: filterPinInput,
  onPaste: guardPinPaste,
} as const;
