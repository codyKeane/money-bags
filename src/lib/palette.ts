// Validated categorical palette (dataviz reference instance). Both mode
// variants passed scripts/validate_palette.js; slot ORDER is the CVD-safety
// mechanism — assign in sequence, never cycle, never generate a 9th hue.
// Slots below 3:1 contrast on the light surface (aqua, yellow, magenta) are
// legal because every use pairs the color with visible text (badges, direct
// labels) — never color alone.

export interface PaletteSlot {
  light: string;
  dark: string;
}

export const CATEGORICAL_SLOTS: readonly PaletteSlot[] = [
  { light: "#2a78d6", dark: "#3987e5" }, // 1 blue
  { light: "#1baf7a", dark: "#199e70" }, // 2 aqua
  { light: "#eda100", dark: "#c98500" }, // 3 yellow
  { light: "#008300", dark: "#008300" }, // 4 green
  { light: "#4a3aa7", dark: "#9085e9" }, // 5 violet
  { light: "#e34948", dark: "#e66767" }, // 6 red
  { light: "#e87ba4", dark: "#d55181" }, // 7 magenta
  { light: "#eb6834", dark: "#d95926" }, // 8 orange
] as const;

// Categories store the light-mode hex; look the dark variant up at render time.
const darkByLight = new Map(CATEGORICAL_SLOTS.map((s) => [s.light, s.dark]));

export function darkVariant(lightHex: string): string {
  return darkByLight.get(lightHex) ?? lightHex;
}

// Chart chrome & ink (light / dark), from the validated reference palette.
export const CHROME = {
  surface: { light: "#fcfcfb", dark: "#1a1a19" },
  inkPrimary: { light: "#0b0b0b", dark: "#ffffff" },
  inkSecondary: { light: "#52514e", dark: "#c3c2b7" },
  inkMuted: { light: "#898781", dark: "#898781" },
  gridline: { light: "#e1e0d9", dark: "#2c2c2a" },
  baseline: { light: "#c3c2b7", dark: "#383835" },
  deltaGood: { light: "#006300", dark: "#0ca30c" },
} as const;
