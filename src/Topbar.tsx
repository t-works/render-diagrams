import { NavLink } from 'react-router-dom';
import type { LoadedDiagram } from './loader';

/** Derived from diagram metas, sorted by order then title (§5.2). No hand-maintained nav. */
export function Topbar({ diagrams }: { diagrams: LoadedDiagram[] }) {
  return (
    <header className="topbar">
      <span className="topbar__brand">Diagrams</span>
      <nav className="topbar__nav">
        {diagrams.map((d) => (
          <NavLink
            key={d.source}
            to={`/d/${d.id}`}
            className={({ isActive }) => `topbar__link${isActive ? ' is-active' : ''}`}
            title={d.errors.length > 0 ? 'This diagram has validation errors' : d.title}
          >
            {d.title}
            {d.errors.length > 0 && <span className="topbar__badge">!</span>}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
