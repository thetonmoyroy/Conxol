import type { ITheme } from "@xterm/xterm";

export type ColorTheme = "dark" | "light" | "dracula" | "nord" | "gruvbox" | "tokyoNight" | "catppuccin" | "oneDark" | "solarizedDark" | "solarizedLight";
export type ThemePreference = ColorTheme | "system";

export function cachedTheme(): ThemePreference {
  try {
    // Read the old cache once so existing installs retain their preference.
    const value = localStorage.getItem("conxol-theme") ?? localStorage.getItem("termix-theme") ?? localStorage.getItem("mobarust-theme");
    if (value && isThemePreference(value)) {
      try { localStorage.setItem("conxol-theme", value); } catch { /* The cached preference remains usable if storage is full. */ }
    }
    return value && isThemePreference(value) ? value : "dark";
  } catch { return "dark"; }
}

export const terminalThemes: Record<"dark" | "light", ITheme> = {
  dark: {
    background: "#101514", foreground: "#dce8dc", cursor: "#e8b45c",
    cursorAccent: "#101514", selectionBackground: "#3b5148",
    black: "#101514", red: "#ee8d78", green: "#9bc48a", yellow: "#e8b45c",
    blue: "#86a9cc", magenta: "#c9a3c7", cyan: "#77c4bb", white: "#dce8dc",
    brightBlack: "#63746b", brightRed: "#f09f89", brightGreen: "#b9dc9d",
    brightYellow: "#f3ca78", brightBlue: "#a7c6e2", brightMagenta: "#e0bedf",
    brightCyan: "#99e0d5", brightWhite: "#f2f5eb",
  },
  light: {
    background: "#fbfcf8", foreground: "#263b30", cursor: "#946015",
    cursorAccent: "#fbfcf8", selectionBackground: "#ccdccc",
    black: "#263b30", red: "#b53c32", green: "#326b3f", yellow: "#895b0b",
    blue: "#285f99", magenta: "#885183", cyan: "#216d70", white: "#e1e7df",
    brightBlack: "#607264", brightRed: "#bc4937", brightGreen: "#437d43",
    brightYellow: "#986916", brightBlue: "#3674ae", brightMagenta: "#96558e",
    brightCyan: "#287b77", brightWhite: "#ffffff",
  },
};

// Each palette includes the normal and bright ANSI colors used by device output.
function palette(background: string, foreground: string, selectionBackground: string, colors: string): ITheme {
  const [black, red, green, yellow, blue, magenta, cyan, white, brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite] = colors.split(" ").map(color => `#${color}`);
  return { background, foreground, selectionBackground, cursor: foreground, cursorAccent: background, black, red, green, yellow, blue, magenta, cyan, white, brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite };
}
export const terminalPresets: Record<string, { label: string; theme: ITheme }> = {
  dracula: { label: "Dracula", theme: palette("#282a36", "#f8f8f2", "#44475a", "21222c ff5555 50fa7b f1fa8c bd93f9 ff79c6 8be9fd f8f8f2 6272a4 ff6e6e 69ff94 ffffa5 d6acff ff92df a4ffff ffffff") },
  nord: { label: "Nord", theme: palette("#2e3440", "#d8dee9", "#434c5e", "3b4252 bf616a a3be8c ebcb8b 81a1c1 b48ead 88c0d0 e5e9f0 4c566a bf616a a3be8c ebcb8b 81a1c1 b48ead 8fbcbb eceff4") },
  gruvbox: { label: "Gruvbox Dark", theme: palette("#282828", "#ebdbb2", "#504945", "282828 cc241d 98971a d79921 458588 b16286 689d6a a89984 928374 fb4934 b8bb26 fabd2f 83a598 d3869b 8ec07c ebdbb2") },
  tokyoNight: { label: "Tokyo Night", theme: palette("#1a1b26", "#c0caf5", "#33467c", "15161e f7768e 9ece6a e0af68 7aa2f7 bb9af7 7dcfff a9b1d6 414868 f7768e 9ece6a e0af68 7aa2f7 bb9af7 7dcfff c0caf5") },
  catppuccin: { label: "Catppuccin Mocha", theme: palette("#1e1e2e", "#cdd6f4", "#45475a", "45475a f38ba8 a6e3a1 f9e2af 89b4fa f5c2e7 94e2d5 bac2de 585b70 f38ba8 a6e3a1 f9e2af 89b4fa f5c2e7 94e2d5 a6adc8") },
  oneDark: { label: "One Dark", theme: palette("#282c34", "#abb2bf", "#3e4451", "282c34 e06c75 98c379 e5c07b 61afef c678dd 56b6c2 abb2bf 5c6370 e06c75 98c379 e5c07b 61afef c678dd 56b6c2 ffffff") },
  solarizedDark: { label: "Solarized Dark", theme: palette("#002b36", "#839496", "#073642", "073642 dc322f 859900 b58900 268bd2 d33682 2aa198 eee8d5 002b36 cb4b16 586e75 657b83 839496 6c71c4 93a1a1 fdf6e3") },
  solarizedLight: { label: "Solarized Light", theme: palette("#fdf6e3", "#657b83", "#eee8d5", "073642 dc322f 859900 b58900 268bd2 d33682 2aa198 eee8d5 002b36 cb4b16 586e75 657b83 839496 6c71c4 93a1a1 fdf6e3") },
};
export function selectedTerminalPreset(value: string): string {
  return Object.hasOwn(terminalPresets, value) ? value : "";
}

export function isThemePreference(value: string): value is ThemePreference {
  return value === "system" || value === "dark" || value === "light" || !!selectedTerminalPreset(value);
}
export function themeMode(theme: ColorTheme): "dark" | "light" {
  return theme === "light" || theme === "solarizedLight" ? "light" : "dark";
}
export function workspaceTheme(theme: ThemePreference, legacyPreset = ""): ThemePreference {
  return (theme === "dark" || theme === "light" || theme === "system") && selectedTerminalPreset(legacyPreset) ? legacyPreset as ColorTheme : theme;
}
export function appThemeVariables(theme: ColorTheme): Record<string, string> {
  const palette = selectedTerminalPreset(theme) ? terminalPresets[theme].theme : terminalThemes[themeMode(theme)];
  const bg = palette.background!;
  const fg = palette.foreground!;
  const mix = (amount: number) => `color-mix(in srgb, ${bg}, ${fg} ${amount}%)`;
  const accent = themeMode(theme) === "light" ? palette.blue! : palette.brightBlue!;
  const variables = {
    "--bg": bg, "--panel": mix(3), "--panel-raised": mix(6), "--panel-soft": mix(9),
    "--line": mix(14), "--line-strong": mix(24), "--text": fg, "--muted": mix(68), "--faint": mix(52),
    "--amber": accent, "--amber-soft": `color-mix(in srgb, ${accent} 14%, transparent)`,
    "--mint": palette.green!, "--mint-soft": `color-mix(in srgb, ${palette.green} 14%, transparent)`,
    "--coral": palette.red!, "--theme-selection": palette.selectionBackground!,
    "--theme-background": bg, "--theme-foreground": fg,
    "--icon-sessions": palette.blue!, "--icon-files": palette.cyan!, "--icon-settings": palette.magenta!,
  };
  // The original Dark theme keeps its hand-tuned workspace colors.
  if (theme === "dark") Object.assign(variables, {
    "--bg": "#0b100f", "--panel": "#101615", "--panel-raised": "#141c1a", "--panel-soft": "#17221f",
    "--line": "rgba(193, 214, 195, 0.12)", "--line-strong": "rgba(193, 214, 195, 0.2)",
    "--text": "#dce8dc", "--muted": "#82938a", "--faint": "#53635b",
    "--amber": "#e8b45c", "--amber-soft": "rgba(232, 180, 92, 0.12)",
    "--mint": "#9bc48a", "--mint-soft": "rgba(155, 196, 138, 0.13)", "--coral": "#ee8d78",
    "--icon-sessions": "#4b93bd", "--icon-files": "#4f9fb1", "--icon-settings": "#b76578",
  });
  return { ...variables, ...Object.fromEntries(Object.entries(variables).map(([name, value]) => [`--app-${name.slice(2)}`, value])) };
}
