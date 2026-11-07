import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
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
  const actionsToggle = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const infoToggle = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const drawerClose = useRef<HTMLButtonElement | null>(null);

  // The topbar renders above the router, so the page's triggers are portaled
  // into a slot the topbar owns (see Topbar.tsx). A DOM lookup needs the slot
  // committed first, hence the effect plus one extra render on mount.
  const [topbarSlot, setTopbarSlot] = useState<HTMLElement | null>(null);
  // oxlint-disable-next-line react/set-state-in-effect -- synchronizing with a DOM node owned by another component
  useEffect(() => setTopbarSlot(document.getElementById('topbar-actions')), []);

  // The applied version is state (not a read-only memo) so Upload and Reset can
  // swap it without a reload. It is read once per diagram mount and merged once
  // per applied version identity, so the merged `diagram` object stays stable and
  // the layout effect below does not re-run every render. No version (or a
  // geometry-less version) keeps the original identity and the exact old path.
  const [version, setVersion] = useState<LayoutVersion | null>(() => loadVersion(loaded.id));
  const [hasSaved, setHasSaved] = useState(() => hasGeometry(loadVersion(loaded.id)));
  // Failures only: a successful save/export is silent (the user asked for the
  // status row and its reserved space to go away). The message is an overlay, so
  // it never takes layout space away from the canvas.
  const [error, setError] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
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
      setError(null);
    } else if (outcome.status === 'unavailable') {
      setError('Could not save locally: browser storage is unavailable. Use Download to export.');
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
      setError('No layout to download yet — move or resize a node first.');
      return;
    }
    setError(null);
  }, [getNodes, loaded.diagram, loaded.id]);

  const handleUpload = useCallback(
    (file: File | undefined) => {
      if (!file || !loaded.diagram) return;
      void readUploadedVersion(file).then((parsed) => {
        if (!parsed) {
          setError(`Could not read “${file.name}” as a layout version.`);
          return;
        }
        if (parsed.id !== loaded.id) {
          setError(`“${file.name}” holds the layout for “${parsed.id}”, not this diagram.`);
          return;
        }
        if (!hasGeometry(parsed)) {
          setError(`“${file.name}” carries no geometry — nothing to apply.`);
          return;
        }
        const persisted = writeVersion(parsed);
        applyVersion(parsed);
        setHasSaved(true);
        setError(
          persisted ? null : `Applied “${file.name}” for this session only — storage is unavailable.`,
        );
      });
    },
    [applyVersion, loaded.diagram, loaded.id],
  );

  const handleReset = useCallback(() => {
    const cleared = clearVersion(loaded.id);
    setConfirmingReset(false);
    setMenuOpen(false);
    setHasSaved(false);
    applyVersion(null);
    setError(
      cleared ? null : 'Auto-layout restored for this session — browser storage is unavailable.',
    );
    // The menu (and the confirm item) unmounts; keep focus on the trigger.
    requestAnimationFrame(() => actionsToggle.current?.focus());
  }, [applyVersion, loaded.id]);

  const closeMenu = useCallback((restoreFocus = false) => {
    setMenuOpen(false);
    // A stale confirmation must never greet the next open.
    setConfirmingReset(false);
    if (restoreFocus) requestAnimationFrame(() => actionsToggle.current?.focus());
  }, []);

  const closeInfo = useCallback((restoreFocus = false) => {
    setInfoOpen(false);
    if (restoreFocus) requestAnimationFrame(() => infoToggle.current?.focus());
  }, []);

  // Escape closes the topmost surface; outside pointerdown dismisses too.
  useEffect(() => {
    if (!menuOpen && !infoOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (menuOpen) closeMenu(true);
      else closeInfo(true);
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as globalThis.Node;
      if (menuOpen && !menuRef.current?.contains(target) && !actionsToggle.current?.contains(target)) {
        closeMenu(false);
      }
      if (infoOpen && !drawerRef.current?.contains(target) && !infoToggle.current?.contains(target)) {
        closeInfo(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [menuOpen, infoOpen, closeMenu, closeInfo]);

  // Focus the first menu item on open, and the drawer's close button on open.
  useEffect(() => {
    if (!menuOpen) return;
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
    first?.focus();
  }, [menuOpen]);
  useEffect(() => {
    if (!infoOpen) return;
    drawerClose.current?.focus();
  }, [infoOpen]);

  const moveMenuFocus = (e: ReactKeyboardEvent) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next === null) return;
    e.preventDefault();
    items[next].focus();
  };

  const openResetConfirm = () => {
    setConfirmingReset(true);
    requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[data-testid="reset-confirm"]')?.focus();
    });
  };

  const kinds = useMemo(() => {
    const present = new Set((diagram?.nodes ?? []).map((n) => n.kind));
    return [...present].sort();
  }, [diagram]);

  return (
    <div className="page">
      {/* Always present for the document outline; the visible title lives in the drawer. */}
      <h1 className="sr-only">{loaded.title}</h1>

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

      <div className="page__body">
        {error && (
          <p className="layout-error" role="alert" data-testid="layout-error">
            {error}
          </p>
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

        {/* Info drawer: an overlay over the diagram area, never a layout participant. */}
        <aside
          id="diagram-info"
          ref={drawerRef}
          className={`drawer${infoOpen ? ' is-open' : ''}`}
          aria-label="Diagram information"
          aria-hidden={!infoOpen}
          inert={!infoOpen}
          data-testid="info-drawer"
        >
          <div className="drawer__bar">
            <p className="drawer__diagram">{loaded.title}</p>
            <button
              ref={drawerClose}
              type="button"
              className="icon-btn"
              aria-label="Close information panel"
              onClick={() => closeInfo(true)}
              data-testid="info-close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          {loaded.description && <p className="drawer__description">{loaded.description}</p>}
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
          {!loaded.description && kinds.length === 0 && (
            <p className="drawer__empty">No additional information for this diagram.</p>
          )}
        </aside>
      </div>

      {/* Mounted at page level so closing the menu cannot cancel a pending pick. */}
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        data-testid="upload-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          handleUpload(file);
        }}
      />

      {topbarSlot &&
        createPortal(
          <div className="topbar__action-group">
            <button
              ref={infoToggle}
              type="button"
              className="icon-btn icon-btn--label"
              aria-haspopup="dialog"
              aria-expanded={infoOpen}
              aria-controls="diagram-info"
              title="Diagram information"
              onClick={() => (infoOpen ? closeInfo() : setInfoOpen(true))}
              data-testid="info-toggle"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 11v6M12 7.5h.01" />
              </svg>
              <span>Info</span>
            </button>

            {diagram && (
              <div className="menu-wrap">
                <button
                  ref={actionsToggle}
                  type="button"
                  className="icon-btn"
                  aria-label="Diagram actions"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-controls="diagram-actions-menu"
                  title="Diagram actions"
                  onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' && !menuOpen) {
                      e.preventDefault();
                      setMenuOpen(true);
                    }
                  }}
                  data-testid="actions-toggle"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M4 7h16M4 12h16M4 17h16" />
                  </svg>
                </button>

                {menuOpen && (
                  <div
                    id="diagram-actions-menu"
                    className="menu"
                    role="menu"
                    aria-label="Diagram actions"
                    ref={menuRef}
                    onKeyDown={moveMenuFocus}
                    data-testid="actions-menu"
                  >
                    {confirmingReset ? (
                      <>
                        <p className="menu__prompt">Clear saved layout?</p>
                        <button
                          type="button"
                          role="menuitem"
                          className="menu__item menu__item--danger"
                          onClick={handleReset}
                          data-testid="reset-confirm"
                        >
                          Reset
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="menu__item"
                          onClick={() => {
                            setConfirmingReset(false);
                            requestAnimationFrame(() => {
                              menuRef.current?.querySelector<HTMLElement>('[data-testid="reset"]')?.focus();
                            });
                          }}
                          data-testid="reset-cancel"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          className="menu__item"
                          disabled={!ready}
                          onClick={() => {
                            closeMenu();
                            handleDownload();
                          }}
                          data-testid="download"
                        >
                          Download
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="menu__item"
                          disabled={!ready}
                          onClick={() => {
                            closeMenu();
                            fileInput.current?.click();
                          }}
                          data-testid="upload"
                        >
                          Upload
                        </button>
                        <div className="menu__sep" role="separator" />
                        {hasSaved ? (
                          <button
                            type="button"
                            role="menuitem"
                            className="menu__item menu__item--danger"
                            disabled={!ready}
                            onClick={openResetConfirm}
                            data-testid="reset"
                          >
                            Reset layout
                          </button>
                        ) : (
                          <button
                            type="button"
                            role="menuitem"
                            className="menu__item"
                            disabled={!ready}
                            onClick={() => {
                              closeMenu();
                              relayout();
                            }}
                          >
                            Re-layout
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>,
          topbarSlot,
        )}
    </div>
  );
}
