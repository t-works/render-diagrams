/**
 * kind -> React component (§5.4). The kind vocabulary in lib/kinds.ts is the single
 * source of truth; adding a kind is one entry there plus a row in the skill.
 */
import type { ComponentType } from 'react';
import type { NodeProps } from '@xyflow/react';
import { KINDS } from '../lib/kinds';
import { GroupNode, KindNode } from './Node';

const nodeTypes: Record<string, ComponentType<NodeProps>> = {};
for (const kind of Object.keys(KINDS)) {
  nodeTypes[kind] = kind === 'group' ? GroupNode : KindNode;
}

export { nodeTypes };

/** Unknown kinds were already normalised to `generic` by the loader. */
export function componentFor(kind: string): ComponentType<NodeProps> {
  return nodeTypes[kind] ?? KindNode;
}
