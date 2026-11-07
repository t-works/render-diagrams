import { createContext, useContext } from 'react';
import type { NodeSpec } from '../lib/schema';
import { openSectionIds, type SectionState } from '../lib/sections';

/**
 * The live expansion state for every node, provided by `DiagramPage` around the
 * canvas. Node bodies read it through `useOpenSections` and report toggles
 * through `useSectionToggle`, so a `<details>` click is never lost to a re-render
 * and the same state feeds the save/export serializers.
 */
export interface SectionsApi {
  state: SectionState;
  toggle: (nodeId: string, sectionId: string, open: boolean) => void;
}

export const SectionsContext = createContext<SectionsApi>({ state: {}, toggle: () => {} });

/** Effective open section ids for one node (state wins, authored flags fall back). */
export function useOpenSections(spec: NodeSpec): string[] {
  const { state } = useContext(SectionsContext);
  return openSectionIds(state, spec);
}

export function useSectionToggle(): SectionsApi['toggle'] {
  return useContext(SectionsContext).toggle;
}
