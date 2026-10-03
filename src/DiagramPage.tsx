import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { layoutDiagram } from './lib/layout';
import { buildFlow } from './lib/flow';
import { nodeTypes } from './nodes/registry';
import { BUDGET, type Size } from './lib/schema';
import { kindMeta } from './lib/kinds';
import type { LoadedDiagram } from './loader';

export function DiagramPage({ diagrams }: { diagrams: LoadedDiagram[] }) {
  const { id } = useParams();
  const loaded = diagrams.find((d) => d.id === id);

  if (!loaded) {
    return <div className="panel">No diagram named “{id}”.</div>;
  }
  return (
    <ReactFlowProvider>
      <DiagramView key={loaded.source} loaded={loaded} />
    </ReactFlowProvider>
  );
}

function DiagramView({ loaded }: { loaded: LoadedDiagram }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [ready, setReady] = useState(false);
  const { fitView, getNodes } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const settled = useRef(false);

  const diagram = loaded.diagram;

  useEffect(() => {
    if (!diagram) return;
    let cancelled = false;
    layoutDiagram(diagram)
      .then((placements) => {
        if (cancelled) return;
        const graph = buildFlow(diagram, placements);
        setNodes(graph.nodes);
        setEdges(graph.edges);
        setReady(true);
      })
      .catch((e: unknown) => {
        console.error('Layout failed', e);
      });
    return () => {
      cancelled = true;
    };
  }, [diagram, setNodes, setEdges]);

  /**
   * Re-run ELK against measured (wrapped labels, expanded sections) heights so no
   * node is clipped and each group is sized to its real children (§5.5).
   * Containers are omitted: ELK derives their size from the children it places.
   */
  const relayout = useCallback(() => {
    if (!diagram) return;
    const overrides = new Map<string, Size>();
    for (const n of getNodes()) {
      if (n.type === 'group') continue;
      const width = n.measured?.width ?? n.width;
      const height = n.measured?.height ?? n.height;
      if (width && height) overrides.set(n.id, { width, height });
    }
    layoutDiagram(diagram, overrides)
      .then((placements) => {
        const graph = buildFlow(diagram, placements);
        setNodes(graph.nodes);
        setEdges(graph.edges);
        requestAnimationFrame(() => fitView({ padding: 0.15 }));
      })
      .catch((e: unknown) => console.error('Layout failed', e));
  }, [diagram, getNodes, setNodes, setEdges, fitView]);

  // First pass lays out collapsed sizes; once measured, lay out again for real ones.
  useEffect(() => {
    if (!ready || !nodesInitialized || settled.current) return;
    settled.current = true;
    relayout();
  }, [ready, nodesInitialized, relayout]);

  const kinds = useMemo(() => {
    const present = new Set((diagram?.nodes ?? []).map((n) => n.kind));
    return [...present].sort();
  }, [diagram]);

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1>{loaded.title}</h1>
          {loaded.description && <p className="page__description">{loaded.description}</p>}
        </div>
        <div className="page__actions">
          {kinds.length > 0 && (
            <ul className="legend">
              {kinds.map((kind) => {
                const meta = kindMeta(kind);
                return (
                  <li key={kind} className="legend__item">
                    <span className={`legend__swatch kn-swatch--${meta.color}`} />
                    <span className="legend__label">{meta.label}</span>
                    <span className="legend__desc">{meta.description}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {diagram && (
            <button type="button" className="btn" onClick={relayout} disabled={!ready}>
              Re-layout
            </button>
          )}
        </div>
      </div>

      {loaded.errors.length > 0 && (
        <div className="panel panel--error">
          <h2>Invalid diagram</h2>
          <ul>
            {loaded.errors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {loaded.errors.length === 0 && loaded.warnings.length > 0 && (
        <div className="panel panel--warn">
          <ul>
            {loaded.warnings.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {diagram && !ready && <div className="panel">Laying out…</div>}

      {diagram && ready && (
        <div className="canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodesConnectable={false}
            deleteKeyCode={null}
            colorMode="system"
            onlyRenderVisibleElements={nodes.length > BUDGET.nodes}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.05}
          >
            <Background />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      )}
    </div>
  );
}
