/** Keep identifiers and secrets exactly as typed in Windows and macOS webviews. */
export const literalInputProps = {
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  writingSuggestions: false,
  textprediction: "false",
} as const;
