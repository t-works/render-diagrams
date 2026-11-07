/**
 * Saved layout versions (§10).
 *
 * A "version" is a coordinate-bearing view of one diagram: `position` for every
 * recorded node and a `size` whose `width` is always present and whose `height`
 * is present only for containers/groups (round-2 refinement). It is persisted
 * to `localStorage` under a per-diagram key. This module holds the pure,
 * side-effect-free pieces plus the guarded read accessor; the write/import side
 * (save/clear/download/upload) lands in Run 2.
 */
import type { Node } from '@xyflow/react';
import type { Diagram, NodeSpec } from './schema';

/** One recorded node's geometry, keyed by node id. */
export interface VersionNode {
  id: string;
  position?: { x: number; y: number };
  size?: { width: number; height?: number };
}

/** The persisted envelope. */
export interface LayoutVersion {
  id: string;
  nodes: VersionNode[];
}

/** localStorage key for one diagram's saved version. */
export const versionStorageKey = (id: string): string => `render-diagrams:layout-version:${id}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * Pure shape check for a persisted version. Malformed entries are skipped
 * rather than throwing; an envelope that is not `{ id, nodes: [...] }` yields
 * `null` (the caller falls back to auto-layout, AC8).
 */
export function parseVersion(raw: unknown): LayoutVersion | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  if (!Array.isArray(raw.nodes)) return null;

  const nodes: VersionNode[] = [];
  for (const entry of raw.nodes) {
    if (!isRecord(entry)) continue;
    if (typeof entry.id !== 'string' || entry.id === '') continue;

    const node: VersionNode = { id: entry.id };

    const position = entry.position;
    if (isRecord(position) && isFiniteNumber(position.x) && isFiniteNumber(position.y)) {
      node.position = { x: position.x, y: position.y };
    }

    const size = entry.size;
    if (isRecord(size) && isFiniteNumber(size.width) && size.width >= 0) {
      node.size =
        isFiniteNumber(size.height) && size.height >= 0
          ? { width: size.width, height: size.height }
          : { width: size.width };
    }

    nodes.push(node);
  }

  return { id: raw.id, nodes };
}

/**
 * Guarded read of a diagram's saved version. Returns `null` when there is no
 * version or storage is unavailable/corrupt (never throws).
 */
export function loadVersion(id: string): LayoutVersion | null {
  try {
    const raw = window.localStorage.getItem(versionStorageKey(id));
    if (raw === null) return null;
    return parseVersion(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** A version carries geometry iff a node has a position or a positive width. */
export function hasGeometry(version: unknown): boolean {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  return parsed.nodes.some((node) => node.position !== undefined || (node.size?.width ?? 0) > 0);
}

/**
 * Immutable merge by node id: returns a fresh `Diagram` whose nodes copy only
 * `position`/`size` from matching version entries (unknown ids are ignored).
 * The input diagram is never mutated (Reset must be able to clear geometry).
 */
export function mergeGeometry(diagram: Diagram, version: unknown): Diagram {
  const parsed = parseVersion(version);
  const byId = new Map<string, VersionNode>((parsed?.nodes ?? []).map((node) => [node.id, node]));

  const nodes: NodeSpec[] = diagram.nodes.map((spec) => {
    const recorded = byId.get(spec.id);
    if (!recorded) return { ...spec };
    const next: NodeSpec = { ...spec };
    if (recorded.position) next.position = { x: recorded.position.x, y: recorded.position.y };
    if (recorded.size) next.size = { ...recorded.size };
    return next;
  });

  return { ...diagram, nodes };
}

/** Container detection shared by the serializer: a group or any node with children. */
function isContainerSpec(spec: NodeSpec, childIds: ReadonlySet<string>): boolean {
  return spec.kind === 'group' || childIds.has(spec.id);
}

/**
 * Pure serializer for the live React Flow node list: `position` and `width` are
 * recorded for every node, `height` only for containers/groups. Nodes with no
 * matching spec (or no measurable width) are skipped.
 */
export function serializeVersion(diagram: Diagram, nodes: readonly Node[]): LayoutVersion {
  const specById = new Map(diagram.nodes.map((spec) => [spec.id, spec]));
  const childIds = new Set(
    diagram.nodes.map((spec) => spec.parent).filter((parent): parent is string => typeof parent === 'string'),
  );

  const recorded: VersionNode[] = [];
  for (const node of nodes) {
    const spec = specById.get(node.id);
    if (!spec) continue;
    const width = node.width ?? node.measured?.width;
    if (width === undefined) continue;
    const height = node.height ?? node.measured?.height;

    const entry: VersionNode = {
      id: node.id,
      position: { x: node.position.x, y: node.position.y },
      size: { width },
    };
    if (isContainerSpec(spec, childIds) && height !== undefined) entry.size!.height = height;
    recorded.push(entry);
  }

  return { id: diagram.meta.id, nodes: recorded };
}
