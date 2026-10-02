import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './App.css';
import { loadDiagrams, type LoadedDiagram } from './loader';
import { Topbar } from './Topbar';
import { DiagramPage } from './DiagramPage';

export default function App() {
  const [diagrams, setDiagrams] = useState<LoadedDiagram[] | null>(null);

  useEffect(() => {
    loadDiagrams().then(setDiagrams).catch(console.error);
  }, []);

  if (!diagrams) return <div className="panel">Loading diagrams…</div>;

  const first = diagrams[0];

  return (
    <BrowserRouter>
      <div className="app">
        <Topbar diagrams={diagrams} />
        <main className="app__main">
          <Routes>
            <Route
              path="/"
              element={
                first ? (
                  <Navigate to={`/d/${first.id}`} replace />
                ) : (
                  <div className="panel">No diagrams yet. Add a JSON file to src/diagrams/.</div>
                )
              }
            />
            <Route path="/d/:id" element={<DiagramPage diagrams={diagrams} />} />
            <Route path="*" element={<div className="panel">Page not found.</div>} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
