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
  type OnNodesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { layoutDiagram } from './lib/layout';
import { buildFlow } from './lib/flow';
import {
  clearVersion,
  downloadVersion,
  hasGeometry,
  loadVersion,
  mergeGeometry,
  readUploadedVersion,
  saveVersion,
  serializeVersion,
  writeVersion,
  type LayoutVersion,
} from './lib/versions';
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const primaryAction = useRef<HTMLButtonElement | null>(null);

  // The applied version is state (not a read-only memo) so Upload and Reset can
  // swap it without a reload. It is read once per diagram mount and merged once
  // per applied version identity, so the merged `diagram` object stays stable and
  // the layout effect below does not re-run every render. No version (or a
  // geometry-less version) keeps the original identity and the exact old path.
  const [version, setVersion] = useState<LayoutVersion | null>(() => loadVersion(loaded.id));
  const [hasSaved, setHasSaved] = useState(() => hasGeometry(loadVersion(loaded.id)));
  const [status, setStatus] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  // A Reset/Upload must replay the pipeline even when the applied version was
  // already null (autosave-only session), where the `diagram` identity does not
  // change on its own. The epoch is the explicit "lay out again" trigger.
  const [layoutEpoch, setLayoutEpoch] = useState(0);

  const diagram = useMemo(() => {
    if (!loaded.diagram || !version || !hasGeometry(version)) return loaded.diagram;
    return mergeGeometry(loaded.diagram, version);
  }, [loaded.diagram, version]);

  // Run 1 surfaces partial coverage / stale ids as a log; Run 3 promotes this to
  // a non-blocking aria-live notice (AC8).
  useEffect(() => {
    if (!version || !loaded.diagram) return;
    const knownIds = new Set(loaded.diagram.nodes.map((n) => n.id));
    const recordedIds = new Set(version.nodes.map((n) => n.id));
    const unknown = version.nodes.filter((n) => !knownIds.has(n.id)).length;
    const uncovered = loaded.diagram.nodes.filter((n) => !recordedIds.has(n.id)).length;
    if (unknown > 0) console.info(`Layout version “${loaded.id}”: ignored ${unknown} unknown node id(s).`);
    if (uncovered > 0) console.info(`Layout version “${loaded.id}”: ${uncovered} node(s) keep auto-layout (partial coverage).`);
  }, [version, loaded.id, loaded.diagram]);

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
  }, [diagram, layoutEpoch, setNodes, setEdges]);

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

  /** Swap the applied version and replay the normal two-pass pipeline from scratch. */
  const applyVersion = useCallback((next: LayoutVersion | null) => {
    // A pending autosave from a gesture just before Upload/Reset must not resurrect
    // the version these actions are removing.
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    settled.current = false;
    setVersion(next);
    setReady(false);
    setLayoutEpoch((n) => n + 1);
  }, []);

  const doSave = useCallback(() => {
    if (!loaded.diagram || !ready) return;
    const outcome = saveVersion(loaded.id, loaded.diagram, getNodes());
    if (outcome.status === 'saved') {
      setHasSaved(true);
      setStatus(`Layout saved (${outcome.version.nodes.length} nodes).`);
      setStatusError(false);
    } else if (outcome.status === 'empty') {
      setStatus('Nothing to save yet — move or resize a node first.');
      setStatusError(true);
    } else {
      setStatus('Could not save locally: browser storage is unavailable. Use Download to export.');
      setStatusError(true);
    }
  }, [getNodes, loaded.diagram, loaded.id, ready]);

  /** Debounced so one drag or resize gesture persists once, after it ends. */
  const scheduleSave = useCallback(() => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      doSave();
    }, 400);
  }, [doSave]);

  useEffect(
    () => () => {
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    },
    [],
  );

  // Resize end is the only `dimensions` change that is user intent; all the rest
  // are React Flow measurements and must not be treated as an adjustment (AC2).
  const handleNodesChange = useCallback<OnNodesChange<Node>>(
    (changes) => {
      onNodesChange(changes);
      if (changes.some((c) => c.type === 'dimensions' && c.resizing === false)) scheduleSave();
    },
    [onNodesChange, scheduleSave],
  );

  const handleDragStop = useCallback(() => scheduleSave(), [scheduleSave]);

  const handleDownload = useCallback(() => {
    if (!loaded.diagram) return;
    const live = serializeVersion(loaded.diagram, getNodes());
    if (!downloadVersion(loaded.id, live)) {
      setStatus('No layout to download yet — move or resize a node first.');
      setStatusError(true);
      return;
    }
    setStatus(`Downloaded ${loaded.id}.json.`);
    setStatusError(false);
  }, [getNodes, loaded.diagram, loaded.id]);

  const handleUpload = useCallback(
    (file: File | undefined) => {
      if (!file || !loaded.diagram) return;
      void readUploadedVersion(file).then((parsed) => {
        if (!parsed) {
          setStatus(`Could not read “${file.name}” as a layout version.`);
          setStatusError(true);
          return;
        }
        if (parsed.id !== loaded.id) {
          setStatus(`“${file.name}” holds the layout for “${parsed.id}”, not this diagram.`);
          setStatusError(true);
          return;
        }
        if (!hasGeometry(parsed)) {
          setStatus(`“${file.name}” carries no geometry — nothing to apply.`);
          setStatusError(true);
          return;
        }
        const persisted = writeVersion(parsed);
        applyVersion(parsed);
        setHasSaved(true);
        setStatus(
          persisted
            ? `Applied layout from “${file.name}”.`
            : `Applied layout from “${file.name}” for this session only — storage is unavailable.`,
        );
        setStatusError(!persisted);
      });
    },
    [applyVersion, loaded.diagram, loaded.id],
  );

  const handleReset = useCallback(() => {
    const cleared = clearVersion(loaded.id);
    setConfirmingReset(false);
    setHasSaved(false);
    applyVersion(null);
    setStatus(
      cleared
        ? 'Saved layout cleared — back to auto-layout.'
        : 'Auto-layout restored for this session — browser storage is unavailable.',
    );
    setStatusError(!cleared);
    // The confirm button unmounts with the confirmation; keep focus in the toolbar.
    requestAnimationFrame(() => primaryAction.current?.focus());
  }, [applyVersion, loaded.id]);

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
            <div className="layout-tools" role="group" aria-label="Layout">
              {hasSaved ? (
                confirmingReset ? (
                  <span className="layout-tools__confirm" role="group" aria-label="Confirm reset">
                    <span className="layout-tools__prompt">Clear saved layout?</span>
                    <button
                      type="button"
                      className="btn btn--danger"
                      onClick={handleReset}
                      autoFocus
                      data-testid="reset-confirm"
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setConfirmingReset(false);
                        requestAnimationFrame(() => primaryAction.current?.focus());
                      }}
                      data-testid="reset-cancel"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    ref={primaryAction}
                    type="button"
                    className="btn"
                    onClick={() => setConfirmingReset(true)}
                    data-testid="reset"
                  >
                    Reset layout
                  </button>
                )
              ) : (
                <button ref={primaryAction} type="button" className="btn" onClick={relayout} disabled={!ready}>
                  Re-layout
                </button>
              )}
              <button type="button" className="btn" onClick={handleDownload} disabled={!ready} data-testid="download">
                Download
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => fileInput.current?.click()}
                disabled={!ready}
                data-testid="upload"
              >
                Upload
              </button>
              <input
                ref={fileInput}
                className="layout-tools__file"
                type="file"
                accept="application/json,.json"
                tabIndex={-1}
                aria-hidden="true"
                data-testid="upload-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  handleUpload(file);
                }}
              />
            </div>
          )}
        </div>
      </div>

      <p
        className={`layout-status${statusError ? ' layout-status--error' : ''}`}
        role="status"
        aria-live="polite"
        data-testid="layout-status"
      >
        {status}
      </p>

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
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={handleDragStop}
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
