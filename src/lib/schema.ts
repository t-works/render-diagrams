/**
 * Shared types for the diagram envelope (§5.3).
 * Pure types + budget constants — no React, no IO, so the CLI validator can use this.
 */

export type Direction = 'LR' | 'TB';
export type EdgeVariant = 'default' | 'dashed' | 'animated';

export interface Port {
  id: string;
  label?: string;
}

export interface Section {
  id: string;
  label: string;
  open?: boolean;
  items?: string[];
}

/** A point in diagram model space (child coordinates are parent-relative). */
export interface NodePosition {
  x: number;
  y: number;
}

/**
 * A recorded node size. `width` is always recorded; `height` is recorded only
 * for containers/groups (round-2 refinement) so leaves keep growing with their
 * sections. `Size` (both required) is still used for kind defaults / ELK input.
 */
export interface NodeSize {
  width: number;
  height?: number;
}

/** A fully-resolved size — kind defaults, measured overrides and ELK input. */
export interface Size {
  width: number;
  height: number;
}

export interface NodeSpec {
  id: string;
  kind: string;
  label: string;
  color?: string;
  parent?: string;
  position?: NodePosition;
  size?: NodeSize;
  inputs?: Port[];
  outputs?: Port[];
  sections?: Section[];
}

export interface EdgeSpec {
  id?: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  label?: string;
  variant?: EdgeVariant;
}

export interface DiagramMeta {
  id: string;
  title: string;
  order?: number;
  description?: string;
  /** Accepted as an alias for the top-level `direction`; top-level wins. */
  direction?: Direction;
}

export interface Diagram {
  specVersion?: string;
  meta: DiagramMeta;
  direction?: Direction;
  nodes: NodeSpec[];
  edges?: EdgeSpec[];
}

/** §5.6 budget. Exceeding it is a warning, never an error. */
export const BUDGET = { nodes: 300, edges: 500 } as const;

export function diagramDirection(d: Diagram): Direction {
  return d.direction ?? d.meta.direction ?? 'LR';
}
