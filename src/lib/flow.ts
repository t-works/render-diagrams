/** Pure conversion from validated Diagram + ELK placements to React Flow nodes/edges. */
import type { CSSProperties } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { diagramDirection, type Diagram, type NodeSpec } from './schema';
import { isKnownKind, kindMeta } from './kinds';
import type { NodeData } from '../nodes/Node';
import type { Placement } from './layout';

/**
 * After first paint, grow container groups to fit their measured children.
 * ELK sized them from collapsed kind sizes, but an initially-open `section` (or a
 * wrapping label) renders taller — without this the group border cuts through it.
 * Only group boxes change; no node is moved, so the canvas does not jump.
 */
export function growGroups(nodes: Node[]): Node[] {
  const INSET = 12; // matches ELK's group padding
  const sizeOf = (n: Node) => {
    const s = n.style as { width?: number; height?: number } | undefined;
    return {
      width: Math.max(n.measured?.width ?? 0, s?.width ?? 0),
      height: Math.max(n.measured?.height ?? 0, s?.height ?? 0),
    };
  };

  const effective = new Map<string, { width: number; height: number }>();
  const result = [...nodes];
  // Reverse order: children precede their parent after the first pass.
  for (let i = result.length - 1; i >= 0; i--) {
    const node = result[i];
    if (node.type !== 'group') {
      effective.set(node.id, sizeOf(node));
      continue;
    }
    const own = sizeOf(node);
    let width = own.width;
    let height = own.height;
    for (const child of result) {
      if (child.parentId !== node.id) continue;
      const cs = effective.get(child.id) ?? sizeOf(child);
      width = Math.max(width, child.position.x + cs.width + INSET);
      height = Math.max(height, child.position.y + cs.height + INSET);
    }
    if (width > own.width || height > own.height) {
      result[i] = { ...node, style: { ...node.style, width, height } };
    }
    effective.set(node.id, { width, height });
  }
  return result;
}

export function buildFlow(
  diagram: Diagram,
  placements: ReadonlyMap<string, Placement>,
): { nodes: Node[]; edges: Edge[] } {
  const direction = diagramDirection(diagram);
  const childIds = new Set(diagram.nodes.map((n) => n.parent).filter((p): p is string => !!p));
  const isContainer = (n: NodeSpec) => n.kind === 'group' || childIds.has(n.id);
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));

  const nodes: Node[] = diagram.nodes.map((spec) => {
    const placement = placements.get(spec.id);
    const meta = kindMeta(spec.kind);
    const width = placement?.width ?? spec.size?.width ?? meta.size.width;
    const height = placement?.height ?? spec.size?.height ?? meta.size.height;
    const container = isContainer(spec);
    const fixed = !!spec.size;
    // Auto-height nodes omit height (min-height keeps the collapsed size exact) so an
    // expanded section can grow the node in place (§5.5).
    const style: CSSProperties = container || fixed ? { width, height } : { width, minHeight: height };
    const data: NodeData = { spec, direction, fixed };

    return {
      id: spec.id,
      type: container ? 'group' : isKnownKind(spec.kind) ? spec.kind : 'generic',
      position: placement?.position ?? { x: 0, y: 0 },
      style,
      data,
      connectable: false,
      selectable: true,
      ...(spec.parent ? { parentId: spec.parent, extent: 'parent' as const } : {}),
    };
  });

  const edges: Edge[] = (diagram.edges ?? []).map((e, i) => {
    const source = byId.get(e.source);
    const target = byId.get(e.target);
    return {
      id: e.id ?? `e-${e.source}-${e.target}-${i}`,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourcePort ?? source?.outputs?.[0]?.id,
      targetHandle: e.targetPort ?? target?.inputs?.[0]?.id,
      label: e.label,
      animated: e.variant === 'animated',
      ...(e.variant === 'dashed' ? { style: { strokeDasharray: '6 4' } } : {}),
    };
  });

  return { nodes, edges };
}
