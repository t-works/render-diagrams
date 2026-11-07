/** Pure conversion from validated Diagram + ELK placements to React Flow nodes/edges. */
import type { CSSProperties } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { diagramDirection, type Diagram, type NodeSpec } from './schema';
import { isKnownKind, kindMeta } from './kinds';
import type { NodeData } from '../nodes/Node';
import type { Placement } from './layout';

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
    const container = isContainer(spec);
    // Recorded geometry (a saved version) is authoritative over ELK placement.
    const recordedWidth = spec.size?.width;
    const recordedHeight = spec.size?.height;
    const width = recordedWidth ?? placement?.width ?? meta.size.width;
    const height = recordedHeight ?? placement?.height ?? meta.size.height;
    // Round-2: only an explicit height makes a node fixed. A width-only leaf
    // stays auto-height so an expanded section can grow it in place (§5.5).
    const fixed = recordedHeight !== undefined;
    // Auto-height nodes omit height (min-height keeps the collapsed size exact) so an
    // expanded section can grow the node in place (§5.5).
    const style: CSSProperties = container || fixed ? { width, height } : { width, minHeight: height };
    const data: NodeData = { spec, direction, fixed };

    return {
      id: spec.id,
      type: container ? 'group' : isKnownKind(spec.kind) ? spec.kind : 'generic',
      position: spec.position ?? placement?.position ?? { x: 0, y: 0 },
      // Set explicit React Flow dimensions only for recorded geometry: a set
      // `node.height` is applied as a fixed inline height, so width-only leaves
      // must leave it unset. No recorded size => byte-identical old output.
      ...(recordedWidth !== undefined ? { width } : {}),
      ...(recordedHeight !== undefined ? { height } : {}),
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
