/**
 * Section expansion state (§5.5), kept pure so both the node renderer and the
 * version serializers share one definition.
 *
 * A section's authored `open` flag is the default. Once the reader toggles a
 * section, the live state (`node id -> open section ids`) wins, and that state is
 * what a saved version records — an empty array means "every section collapsed",
 * which is distinct from a node with no recorded state at all.
 */
import type { NodeSpec } from './schema';

/** Open section ids per node id. Absent node => fall back to the authored flags. */
export type SectionState = Record<string, string[]>;

/** The ids the diagram file itself marks as expanded. */
export function authoredOpenIds(spec: NodeSpec): string[] {
  return (spec.sections ?? []).filter((section) => section.open).map((section) => section.id);
}

/** Effective open ids: recorded state wins, authored flags are the fallback. */
export function openSectionIds(state: SectionState, spec: NodeSpec): string[] {
  if (!spec.sections?.length) return [];
  return state[spec.id] ?? authoredOpenIds(spec);
}

/**
 * Immutable toggle: records one section's state without touching the others.
 * The node's authored flags seed the list the first time it is touched.
 */
export function withSectionToggle(
  state: SectionState,
  spec: NodeSpec,
  sectionId: string,
  open: boolean,
): SectionState {
  if (!spec.sections?.length) return state;
  const current = openSectionIds(state, spec);
  const next = open ? [...new Set([...current, sectionId])] : current.filter((id) => id !== sectionId);
  return { ...state, [spec.id]: next };
}
