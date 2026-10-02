/** Palette is a fixed set of names; each name maps to CSS variables in index.css. */
export const PALETTE = [
  'slate',
  'blue',
  'teal',
  'green',
  'amber',
  'red',
  'violet',
  'pink',
] as const;

export type PaletteName = (typeof PALETTE)[number];

export function isPaletteName(value: unknown): value is PaletteName {
  return typeof value === 'string' && (PALETTE as readonly string[]).includes(value);
}
