import type { CSSProperties } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Direction, NodeSpec, Port, Section } from '../lib/schema';
import { resolveColor } from '../lib/validate';

export interface NodeData extends Record<string, unknown> {
  spec: NodeSpec;
  direction: Direction;
  /** True when the node has an explicit `size` (fixed: content scrolls, does not grow). */
  fixed: boolean;
}

const CARDINAL = {
  LR: { in: Position.Left, out: Position.Right },
  TB: { in: Position.Top, out: Position.Bottom },
} as const;

/** Spread n handles evenly along the node edge. */
function slot(index: number, count: number, dir: Direction): CSSProperties {
  const pct = count <= 1 ? 50 : ((index + 1) / (count + 1)) * 100;
  return dir === 'LR' ? { top: `${pct}%` } : { left: `${pct}%` };
}

const portLabel = (p: Port) => p.label ?? p.id;

/** Native <details>/<summary>: expand/collapse, keyboard and focus come free (§5.5). */
function Sections({ sections }: { sections: Section[] }) {
  if (sections.length === 0) return null;
  return (
    <div className="kn__sections">
      {sections.map((s) => (
        <details key={s.id} className="kn__section" {...(s.open ? { open: true } : {})}>
          <summary>{s.label}</summary>
          <ul>
            {(s.items ?? []).map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

/** Generic node body shared by every non-group kind (§5.4). */
export function KindNode({ data }: NodeProps) {
  const { spec, direction, fixed } = data as unknown as NodeData;
  const inputs = spec.inputs ?? [];
  const outputs = spec.outputs ?? [];
  const hasPorts = inputs.length > 0 || outputs.length > 0;

  return (
    <div className={`kn kn--${resolveColor(spec.kind, spec.color)}${fixed ? ' kn--fixed' : ''}`}>
      {inputs.map((p, i) => (
        <Handle
          key={`in-${p.id}`}
          id={p.id}
          type="target"
          position={CARDINAL[direction].in}
          isConnectable={false}
          style={slot(i, inputs.length, direction)}
        />
      ))}
      {outputs.map((p, i) => (
        <Handle
          key={`out-${p.id}`}
          id={p.id}
          type="source"
          position={CARDINAL[direction].out}
          isConnectable={false}
          style={slot(i, outputs.length, direction)}
        />
      ))}

      <div className="kn__title">{spec.label}</div>

      {hasPorts && (
        <div className="kn__ports">
          <div className="kn__col kn__col--in">
            {inputs.map((p) => (
              <span key={p.id} className="kn__port">
                {portLabel(p)}
              </span>
            ))}
          </div>
          <div className="kn__col kn__col--out">
            {outputs.map((p) => (
              <span key={p.id} className="kn__port">
                {portLabel(p)}
              </span>
            ))}
          </div>
        </div>
      )}

      <Sections sections={spec.sections ?? []} />
    </div>
  );
}

/** Container/lane. ELK gives it its size; children render on top. */
export function GroupNode({ data }: NodeProps) {
  const { spec } = data as unknown as NodeData;
  return (
    <div className={`gn kn--${resolveColor(spec.kind, spec.color)}`}>
      <div className="gn__title">{spec.label}</div>
      <Sections sections={spec.sections ?? []} />
    </div>
  );
}
