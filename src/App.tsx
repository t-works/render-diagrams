import { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type NodeProps,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './App.css';

/** A group node: just a titled container. React Flow renders its children on top. */
function GroupNode({ data }: NodeProps) {
  return (
    <div className="group-node">
      <div className="group-node__title">{String(data.label)}</div>
    </div>
  );
}

/** A normal node with custom appearance and several named slots. */
function TaskNode({ data }: NodeProps) {
  return (
    <div className="task-node">
      <Handle type="target" position={Position.Left} id="in" />
      <div className="task-node__title">{String(data.label)}</div>
      <div className="task-node__slots">
        <span className="slot">arg&nbsp;a</span>
        <span className="slot">arg&nbsp;b</span>
      </div>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}

const nodeTypes = { group: GroupNode, task: TaskNode };

// Children positions are relative to their parent. Parents must come first.
const initialNodes: Node[] = [
  // ---- Group 1 ----
  {
    id: 'g1',
    type: 'group',
    position: { x: 40, y: 80 },
    style: { width: 320, height: 210 },
    data: { label: 'Preprocess' },
  },
  {
    id: 'a1',
    type: 'task',
    parentId: 'g1',
    extent: 'parent',
    position: { x: 20, y: 50 },
    data: { label: 'Load' },
  },
  {
    id: 'a2',
    type: 'task',
    parentId: 'g1',
    extent: 'parent',
    position: { x: 180, y: 120 },
    data: { label: 'Normalize' },
  },

  // ---- Group 2 ----
  {
    id: 'g2',
    type: 'group',
    position: { x: 460, y: 40 },
    style: { width: 320, height: 210 },
    data: { label: 'Model' },
  },
  {
    id: 'b1',
    type: 'task',
    parentId: 'g2',
    extent: 'parent',
    position: { x: 20, y: 50 },
    data: { label: 'Encode' },
  },
  {
    id: 'b2',
    type: 'task',
    parentId: 'g2',
    extent: 'parent',
    position: { x: 180, y: 120 },
    data: { label: 'Decode' },
  },
];

const initialEdges: Edge[] = [
  { id: 'a1-a2', source: 'a1', target: 'a2' },
  { id: 'a2-b1', source: 'a2', target: 'b1', animated: true },
  { id: 'b1-b2', source: 'b1', target: 'b2' },
];

export default function App() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  return (
    <div className="flow-root">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
