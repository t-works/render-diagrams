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
  size?: Size;
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
