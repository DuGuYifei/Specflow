import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface SpecflowKnowledge {
  project: string;
  architecture: string;
  conventions: string;
  glossary: string;
  phaseZeroWorkflow: string;
}

async function readSpecflowFile(root: string, relativePath: string): Promise<string> {
  return readFile(join(root, ".specflow", relativePath), "utf8");
}

export async function readProjectSpec(root: string): Promise<string> {
  return readSpecflowFile(root, "project.md");
}

export async function readArchitectureDoc(root: string): Promise<string> {
  return readSpecflowFile(root, "architecture.md");
}

export async function readConventions(root: string): Promise<string> {
  return readSpecflowFile(root, "conventions.md");
}

export async function readGlossary(root: string): Promise<string> {
  return readSpecflowFile(root, "glossary.md");
}

export async function readPhaseZeroWorkflowIntent(root: string): Promise<string> {
  return readSpecflowFile(root, "workflows/phase-0.md");
}

export async function readSpecflowKnowledge(root: string): Promise<SpecflowKnowledge> {
  const [project, architecture, conventions, glossary, phaseZeroWorkflow] =
    await Promise.all([
      readProjectSpec(root),
      readArchitectureDoc(root),
      readConventions(root),
      readGlossary(root),
      readPhaseZeroWorkflowIntent(root)
    ]);

  return {
    project,
    architecture,
    conventions,
    glossary,
    phaseZeroWorkflow
  };
}

export async function updateSpecflowKnowledgePlaceholder(): Promise<never> {
  throw new Error("Writing .specflow knowledge is reserved for future phases.");
}
