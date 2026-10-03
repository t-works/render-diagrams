import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
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

const portLabel = (p: Port) => p.label ?? p.id;

/**
 * One port. The <Handle> lives inside its own label chip, so a connector always
 * lands exactly on the label that names it — no separate slot maths to drift
 * out of sync (§5.5).
 */
function PortChip({ port, side, direction }: { port: Port; side: 'in' | 'out'; direction: Direction }) {
  return (
    <span className="kn__port">
      <Handle
        id={port.id}
        type={side === 'in' ? 'target' : 'source'}
        position={CARDINAL[direction][side]}
        isConnectable={false}
      />
      {portLabel(port)}
    </span>
  );
}

const chips = (ports: Port[], side: 'in' | 'out', direction: Direction) =>
  ports.map((p) => <PortChip key={p.id} port={p} side={side} direction={direction} />);

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
export function KindNode({ data, selected }: NodeProps) {
  const { spec, direction, fixed } = data as unknown as NodeData;
  const inputs = spec.inputs ?? [];
  const outputs = spec.outputs ?? [];
  const tb = direction === 'TB';

  return (
    <>
      <NodeResizer isVisible={selected} minWidth={80} minHeight={40} />
      <div className={`kn kn--${resolveColor(spec.kind, spec.color)} kn--${direction}${fixed ? ' kn--fixed' : ''}`}>
        {tb && inputs.length > 0 && <div className="kn__row kn__row--in">{chips(inputs, 'in', direction)}</div>}

        <div className="kn__title">{spec.label}</div>

        {!tb && (inputs.length > 0 || outputs.length > 0) && (
          <div className="kn__ports">
            <div className="kn__col kn__col--in">{chips(inputs, 'in', direction)}</div>
            <div className="kn__col kn__col--out">{chips(outputs, 'out', direction)}</div>
          </div>
        )}

        <Sections sections={spec.sections ?? []} />

        {tb && outputs.length > 0 && <div className="kn__row kn__row--out">{chips(outputs, 'out', direction)}</div>}
      </div>
    </>
  );
}

/** Container/lane. ELK gives it its size; children render on top. Resizable. */
export function GroupNode({ data, selected }: NodeProps) {
  const { spec } = data as unknown as NodeData;
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={80} minHeight={60} />
      <div className={`gn kn--${resolveColor(spec.kind, spec.color)}`}>
        <div className="gn__title">{spec.label}</div>
        <Sections sections={spec.sections ?? []} />
      </div>
    </>
  );
}
