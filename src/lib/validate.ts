/**
 * Hand-written checker for the §5.3 invariants (§5.7).
 * Cross-field checks (uniqueness, references, ordering) are awkward in JSON Schema,
 * trivial in a loop. Used by the CLI, the loader's runtime path, and the agent loop.
 */
import { BUDGET, type Diagram } from './schema';
import { isKnownKind, kindMeta } from './kinds';
import { isPaletteName } from './palette';

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

export interface ValidateOptions {
  /** meta.ids of the other diagrams, for cross-file uniqueness. */
  knownIds?: ReadonlySet<string>;
}

export interface ParseResult extends ValidationResult {
  /** Present only when there are no errors. */
  diagram: Diagram | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const URL_SAFE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function validateDiagram(input: unknown, opts: ValidateOptions = {}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (m: string) => errors.push(m);
  const warn = (m: string) => warnings.push(m);

  if (!isObj(input)) {
    return { errors: ['Diagram root must be a JSON object.'], warnings };
  }

  // ---- meta ----
  const meta = input.meta;
  if (!isObj(meta)) {
    err('meta: missing or not an object.');
  }
  const id = isObj(meta) && typeof meta.id === 'string' ? meta.id : null;
  if (!id) {
    err('meta.id: required string.');
  } else {
    if (!URL_SAFE.test(id)) err(`meta.id "${id}": must be URL-safe (letters, digits, "-", "_").`);
    if (opts.knownIds?.has(id)) err(`meta.id "${id}": duplicate across diagrams.`);
  }
  if (!isObj(meta) || typeof meta.title !== 'string' || meta.title.trim() === '') {
    err('meta.title: required non-empty string.');
  }
  if (isObj(meta) && meta.order !== undefined && typeof meta.order !== 'number') {
    err('meta.order: must be a number when present.');
  }
  if (isObj(meta) && meta.description !== undefined && typeof meta.description !== 'string') {
    err('meta.description: must be a string when present.');
  }

  // ---- direction (top-level wins, meta.direction accepted) ----
  for (const [where, value] of [
    ['direction', input.direction],
    ['meta.direction', isObj(meta) ? meta.direction : undefined],
  ] as const) {
    if (value !== undefined && value !== 'LR' && value !== 'TB') {
      err(`${where}: must be "LR" or "TB".`);
    }
  }

  // ---- nodes ----
  if (!Array.isArray(input.nodes)) {
    err('nodes: must be an array.');
    return { errors, warnings };
  }

  const nodeIndex = new Map<string, number>();
  const nodeById = new Map<string, Record<string, unknown>>();

  input.nodes.forEach((raw, i) => {
    const at = `nodes[${i}]`;
    if (!isObj(raw)) {
      err(`${at}: must be an object.`);
      return;
    }
    const nid = typeof raw.id === 'string' ? raw.id : null;
    if (!nid) err(`${at}.id: required string.`);
    else if (nodeIndex.has(nid)) err(`${at}.id "${nid}": duplicate within this diagram.`);
    else nodeIndex.set(nid, i);

    if (typeof raw.kind !== 'string' || raw.kind === '') {
      err(`${at}.kind: required string.`);
    } else if (!isKnownKind(raw.kind)) {
      warn(`${at}.kind "${raw.kind}": unknown, falling back to "generic".`);
    }
    if (typeof raw.label !== 'string' || raw.label.trim() === '') {
      err(`${at}.label: required non-empty string.`);
    }
    if (raw.color !== undefined && !isPaletteName(raw.color)) {
      warn(`${at}.color "${String(raw.color)}": not in the palette, using the kind default.`);
    }

    if (raw.size !== undefined) {
      if (!isObj(raw.size)) err(`${at}.size: must be an object.`);
      else {
        const { width, height } = raw.size;
        if (typeof width !== 'number' || width <= 0) err(`${at}.size.width: must be a positive number.`);
        if (typeof height !== 'number' || height <= 0) err(`${at}.size.height: must be a positive number.`);
      }
    }

    if (raw.parent !== undefined && typeof raw.parent !== 'string') {
      err(`${at}.parent: must be a string.`);
    }

    for (const slot of ['inputs', 'outputs'] as const) {
      const ports = raw[slot];
      if (ports === undefined) continue;
      if (!Array.isArray(ports)) {
        err(`${at}.${slot}: must be an array.`);
        continue;
      }
      const seen = new Set<string>();
      ports.forEach((p, j) => {
        if (!isObj(p) || typeof p.id !== 'string' || p.id === '') {
          err(`${at}.${slot}[${j}].id: required string.`);
        } else if (seen.has(p.id)) {
          err(`${at}.${slot}[${j}].id "${p.id}": duplicate.`);
        } else seen.add(p.id);
      });
    }

    if (raw.sections !== undefined) {
      if (!Array.isArray(raw.sections)) {
        err(`${at}.sections: must be an array.`);
      } else {
        const seen = new Set<string>();
        raw.sections.forEach((s, j) => {
          if (!isObj(s) || typeof s.id !== 'string' || s.id === '') {
            err(`${at}.sections[${j}].id: required string.`);
            return;
          }
          if (seen.has(s.id)) err(`${at}.sections[${j}].id "${s.id}": duplicate.`);
          seen.add(s.id);
          if (typeof s.label !== 'string' || s.label.trim() === '') {
            err(`${at}.sections[${j}].label: required non-empty string.`);
          }
          if (s.items !== undefined && !(Array.isArray(s.items) && s.items.every((x) => typeof x === 'string'))) {
            err(`${at}.sections[${j}].items: must be an array of strings.`);
          }
        });
      }
    }

    if (nid) nodeById.set(nid, raw);
  });

  // ---- parent references + ordering ----
  input.nodes.forEach((raw, i) => {
    if (!isObj(raw) || typeof raw.parent !== 'string') return;
    const parentIndex = nodeIndex.get(raw.parent);
    if (parentIndex === undefined) {
      err(`nodes[${i}].parent "${raw.parent}": does not resolve to a node.`);
    } else if (parentIndex > i) {
      err(`nodes[${i}].parent "${raw.parent}": parent must appear before its children.`);
    }
  });

  // ---- edges ----
  const edgeIds = new Set<string>();
  const edges = input.edges;
  if (edges !== undefined && !Array.isArray(edges)) {
    err('edges: must be an array.');
  } else if (Array.isArray(edges)) {
    edges.forEach((raw, i) => {
      const at = `edges[${i}]`;
      if (!isObj(raw)) {
        err(`${at}: must be an object.`);
        return;
      }
      const source = typeof raw.source === 'string' ? raw.source : null;
      const target = typeof raw.target === 'string' ? raw.target : null;
      if (!source) err(`${at}.source: required string.`);
      if (!target) err(`${at}.target: required string.`);

      const src = source ? nodeById.get(source) : undefined;
      const tgt = target ? nodeById.get(target) : undefined;
      if (source && !src) err(`${at}.source "${source}": does not resolve to a node.`);
      if (target && !tgt) err(`${at}.target "${target}": does not resolve to a node.`);

      const portId = (node: Record<string, unknown> | undefined, slot: string, name: string, nodeId: string | null) => {
        if (!node) return;
        const ports = Array.isArray(node[slot]) ? (node[slot] as unknown[]) : [];
        const ids = ports.filter(isObj).map((p) => p.id).filter((x): x is string => typeof x === 'string');
        if (name && !ids.includes(name)) {
          err(`${at}.${slot === 'outputs' ? 'sourcePort' : 'targetPort'} "${name}": not a port on "${nodeId}".`);
        }
        if (!name && ids.length === 0) {
          err(`${at}: "${nodeId}" has no ${slot}; declare ${slot} on that node or add an explicit port reference.`);
        }
      };
      portId(src, 'outputs', typeof raw.sourcePort === 'string' ? raw.sourcePort : '', source);
      portId(tgt, 'inputs', typeof raw.targetPort === 'string' ? raw.targetPort : '', target);

      const eid = typeof raw.id === 'string' ? raw.id : null;
      if (eid) {
        if (edgeIds.has(eid)) err(`${at}.id "${eid}": duplicate.`);
        else edgeIds.add(eid);
      }

      if (raw.variant !== undefined && !['default', 'dashed', 'animated'].includes(String(raw.variant))) {
        err(`${at}.variant: must be "default", "dashed" or "animated".`);
      }
      if (source && target && source === target) warn(`${at}: self-loop ("${source}").`);
    });
  }

  // ---- budget (§5.6) ----
  const nodeCount = input.nodes.length;
  const edgeCount = Array.isArray(edges) ? edges.length : 0;
  if (nodeCount > BUDGET.nodes) {
    warn(`Large diagram: ${nodeCount} nodes exceeds the ${BUDGET.nodes}-node budget; rendering may be slow.`);
  }
  if (edgeCount > BUDGET.edges) {
    warn(`Large diagram: ${edgeCount} edges exceeds the ${BUDGET.edges}-edge budget; rendering may be slow.`);
  }

  return { errors, warnings };
}

/** Validates and, when clean, returns a typed Diagram. */
export function parseDiagram(input: unknown, opts: ValidateOptions = {}): ParseResult {
  const { errors, warnings } = validateDiagram(input, opts);
  return { diagram: errors.length === 0 ? (input as Diagram) : null, errors, warnings };
}

/**
 * Default color for a node, falling back to the kind default for unknown palette names.
 * Kept here so loader and renderer agree.
 */
export function resolveColor(nodeKind: string, color?: string): string {
  return color && isPaletteName(color) ? color : kindMeta(nodeKind).color;
}
