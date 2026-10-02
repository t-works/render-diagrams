import type { Size } from './schema';
import type { PaletteName } from './palette';

export interface KindMeta {
  /** Default size used for auto-layout before first paint (§5.4). */
  size: Size;
  color: PaletteName;
  /** Legend label. */
  label: string;
  /** Legend one-liner. */
  description: string;
}

/** The fixed kind vocabulary (§5.4). Adding a kind = one entry here + registry + skill. */
export const KINDS: Record<string, KindMeta> = {
  group: {
    size: { width: 220, height: 140 },
    color: 'slate',
    label: 'Group',
    description: 'Container or lane that nests other nodes.',
  },
  task: {
    size: { width: 140, height: 64 },
    color: 'blue',
    label: 'Task',
    description: 'A generic step in a process.',
  },
  source: {
    size: { width: 140, height: 56 },
    color: 'green',
    label: 'Source',
    description: 'An input, dataset or entry point.',
  },
  sink: {
    size: { width: 140, height: 56 },
    color: 'amber',
    label: 'Sink',
    description: 'An output, report or exit point.',
  },
  service: {
    size: { width: 160, height: 72 },
    color: 'teal',
    label: 'Service',
    description: 'A long-running component.',
  },
  store: {
    size: { width: 140, height: 64 },
    color: 'violet',
    label: 'Store',
    description: 'A database, cache or bucket.',
  },
  decision: {
    size: { width: 120, height: 72 },
    color: 'pink',
    label: 'Decision',
    description: 'A branch point.',
  },
  note: {
    size: { width: 160, height: 56 },
    color: 'slate',
    label: 'Note',
    description: 'Annotation, not connected to anything.',
  },
  generic: {
    size: { width: 140, height: 64 },
    color: 'slate',
    label: 'Generic',
    description: 'Fallback used when a kind is unknown.',
  },
};

export const FALLBACK_KIND = 'generic';

export function isKnownKind(kind: string): boolean {
  return Object.hasOwn(KINDS, kind);
}

/** Never throws: unknown kinds fall back to `generic` (§5.4). */
export function kindMeta(kind: string): KindMeta {
  return KINDS[kind] ?? KINDS[FALLBACK_KIND];
}
