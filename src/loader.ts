/**
 * Diagram discovery (§5.1): lazy Vite glob, so a new file appears on reload in dev
 * with no rebuild. Each file is parsed and validated on load (§5.7) — a malformed
 * diagram still appears in the topbar and routes to a page showing its errors.
 */
import { parseDiagram } from './lib/validate';
import type { Diagram } from './lib/schema';

const modules = import.meta.glob('./diagrams/*.json');

export interface LoadedDiagram {
  /** meta.id when present, else the file name. Always routable and unique-ish. */
  id: string;
  title: string;
  order: number;
  description?: string;
  source: string;
  diagram: Diagram | null;
  errors: string[];
  warnings: string[];
}

const fileName = (path: string) => path.replace(/^.*\//, '').replace(/\.json$/, '');
const metaId = (data: unknown): string | null =>
  typeof data === 'object' && data !== null && typeof (data as { meta?: { id?: unknown } }).meta?.id === 'string'
    ? (data as { meta: { id: string } }).meta.id
    : null;
const metaTitle = (data: unknown): string | null =>
  typeof data === 'object' && data !== null && typeof (data as { meta?: { title?: unknown } }).meta?.title === 'string'
    ? (data as { meta: { title: string } }).meta.title
    : null;

export async function loadDiagrams(): Promise<LoadedDiagram[]> {
  const entries = Object.entries(modules);
  const raw = await Promise.all(
    entries.map(async ([path, load]) => {
      try {
        const mod = (await load()) as { default: unknown };
        return { path, data: mod.default, parseError: null as string | null };
      } catch (e) {
        return { path, data: null, parseError: e instanceof Error ? e.message : String(e) };
      }
    }),
  );

  const ids = raw.map(({ path, data }) => metaId(data) ?? fileName(path));

  const loaded: LoadedDiagram[] = raw.map(({ path, data, parseError }, i) => {
    const id = ids[i];
    if (parseError) {
      return {
        id,
        title: fileName(path),
        order: 0,
        source: path,
        diagram: null,
        errors: [`Failed to parse JSON: ${parseError}`],
        warnings: [],
      };
    }
    // Cross-file id uniqueness: every *other* file's id is "known".
    const knownIds = new Set(ids.filter((_, j) => j !== i));
    const { diagram, errors, warnings } = parseDiagram(data, { knownIds });
    return {
      id,
      title: metaTitle(data) ?? fileName(path),
      order:
        typeof data === 'object' && data !== null && typeof (data as { meta?: { order?: unknown } }).meta?.order === 'number'
          ? (data as { meta: { order: number } }).meta.order
          : 0,
      description:
        typeof data === 'object' && data !== null ? (data as { meta?: { description?: string } }).meta?.description : undefined,
      source: path,
      diagram,
      errors,
      warnings,
    };
  });

  return loaded.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}
