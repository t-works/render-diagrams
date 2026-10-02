/**
 * ELK auto-layout (§5.5). ELK positions nodes only; React Flow routes the edges.
 * Layout runs against collapsed kind sizes so it is valid before first paint.
 */
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import { diagramDirection, type Diagram, type NodeSpec, type Size } from './schema';
import { kindMeta } from './kinds';

export interface Placement {
  position: { x: number; y: number };
  width: number;
  height: number;
}

const elk = new ELK();

const GROUP_PADDING = '[top=34,left=12,bottom=12,right=12]';

function sizeOf(node: NodeSpec): Size {
  return node.size ?? kindMeta(node.kind).size;
}

export async function layoutDiagram(
  diagram: Diagram,
  /** Measured sizes for Re-layout (§5.5); overrides kind defaults and `size`. */
  sizeOverrides?: ReadonlyMap<string, Size>,
): Promise<Map<string, Placement>> {
  const childrenOf = new Map<string, NodeSpec[]>();
  for (const node of diagram.nodes) {
    const key = node.parent ?? '';
    const list = childrenOf.get(key);
    if (list) list.push(node);
    else childrenOf.set(key, [node]);
  }

  const build = (node: NodeSpec): ElkNode => {
    const kids = childrenOf.get(node.id) ?? [];
    const isContainer = kids.length > 0 || node.kind === 'group';
    const override = sizeOverrides?.get(node.id);

    if (!isContainer) {
      const { width, height } = override ?? sizeOf(node);
      return { id: node.id, width, height };
    }

    if (kids.length === 0) {
      // Empty group: fall back to its declared/default size.
      const { width, height } = override ?? sizeOf(node);
      return { id: node.id, width, height };
    }

    return {
      id: node.id,
      // Explicit size (or a measured size from Re-layout) wins; otherwise ELK sizes the group.
      width: override?.width ?? node.size?.width ?? 0,
      height: override?.height ?? node.size?.height ?? 0,
      layoutOptions: { 'elk.padding': GROUP_PADDING },
      children: kids.map(build),
    };
  };

  const root: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': diagramDirection(diagram) === 'LR' ? 'RIGHT' : 'DOWN',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '64',
      'elk.spacing.nodeNode': '40',
      'elk.padding': '[top=24,left=24,bottom=24,right=24]',
    },
    children: (childrenOf.get('') ?? []).map(build),
    // Ports are deliberately not handed to ELK (§5.5): routing is React Flow's job.
    edges: (diagram.edges ?? []).map((edge, i) => ({
      id: edge.id ?? `edge-${i}`,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  const result = await elk.layout(root);
  const placements = new Map<string, Placement>();

  const walk = (nodes: ElkNode[] | undefined) => {
    for (const n of nodes ?? []) {
      placements.set(n.id, {
        position: { x: n.x ?? 0, y: n.y ?? 0 },
        width: n.width ?? 0,
        height: n.height ?? 0,
      });
      walk(n.children);
    }
  };
  walk(result.children);

  return placements;
}
