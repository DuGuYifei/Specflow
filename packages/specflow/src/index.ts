import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface SpecflowKnowledge {
  files: SpecflowKnowledgeFile[];
}

export interface SpecflowKnowledgeFile {
  path: string;
  content: string;
}

export async function readSpecflowFile(
  root: string,
  relativePath: string
): Promise<string> {
  return readFile(join(root, ".specflow", relativePath), "utf8");
}

async function listMarkdownFiles(
  root: string,
  relativeDirectory = ""
): Promise<string[]> {
  const absoluteDirectory = join(root, ".specflow", relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = join(relativeDirectory, entry.name);

      if (entry.isDirectory()) {
        return listMarkdownFiles(root, relativePath);
      }

      if (entry.isFile() && entry.name.endsWith(".md")) {
        return [relativePath.replaceAll("\\", "/")];
      }

      return [];
    })
  );

  return files.flat().sort();
}

export async function readSpecflowKnowledge(root: string): Promise<SpecflowKnowledge> {
  const paths = await listMarkdownFiles(root);
  const files = await Promise.all(
    paths.map(async (path) => ({
      path,
      content: await readSpecflowFile(root, path)
    }))
  );

  return { files };
}

export async function updateSpecflowKnowledgePlaceholder(): Promise<never> {
  throw new Error("Writing .specflow knowledge is reserved for future phases.");
}
