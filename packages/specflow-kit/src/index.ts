import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface SpecflowDocs {
  project: string;
  architecture: string;
  conventions: string;
  glossary: string;
  phase0Workflow: string;
}

export async function readSpecflowDocs(rootDir: string): Promise<SpecflowDocs> {
  const specflowPath = join(rootDir, '.specflow');

  const [project, architecture, conventions, glossary, phase0Workflow] = await Promise.all([
    readFile(join(specflowPath, 'project.md'), 'utf8'),
    readFile(join(specflowPath, 'architecture.md'), 'utf8'),
    readFile(join(specflowPath, 'conventions.md'), 'utf8'),
    readFile(join(specflowPath, 'glossary.md'), 'utf8'),
    readFile(join(specflowPath, 'workflows', 'phase-0.md'), 'utf8')
  ]);

  return { project, architecture, conventions, glossary, phase0Workflow };
}

export async function writeSpecflowDoc(
  rootDir: string,
  relativePath: string,
  content: string
): Promise<void> {
  const fullPath = join(rootDir, '.specflow', relativePath);

  // TODO(phase-1): add validation, schema, and conflict-safe writes.
  await writeFile(fullPath, content, 'utf8');
}
