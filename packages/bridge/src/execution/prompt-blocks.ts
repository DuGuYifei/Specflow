import { readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentCommandRequest } from "@specflow/agent-proxy";
import type { AgentNode, WorkflowResourceRef } from "@specflow/workflow";

type PromptBlocks = NonNullable<AgentCommandRequest["promptBlocks"]>;
type PromptBlock = PromptBlocks[number];

export interface BuildPromptBlocksInput {
  node: AgentNode;
  prompt: string;
  cwd: string;
}

export async function buildPromptBlocksForNode(input: BuildPromptBlocksInput): Promise<PromptBlocks | undefined> {
  const refs = [...input.node.images, ...input.node.relatedResources];
  if (refs.length === 0) return undefined;

  const blocks: PromptBlocks = [{ type: "text", text: input.prompt }];
  for (const ref of refs) {
    blocks.push(await contentBlockForResource(input.cwd, ref));
  }
  return blocks;
}

async function contentBlockForResource(cwd: string, ref: WorkflowResourceRef): Promise<PromptBlock> {
  const resolvedPath = resolveResourcePath(cwd, ref.path);
  const uri = pathToFileURL(resolvedPath).href;
  const name = ref.label ?? (basename(ref.path) || ref.path);
  const mimeType = ref.mimeType ?? mimeTypeForPath(ref.path);

  try {
    const fileStat = await stat(resolvedPath);
    if (fileStat.isDirectory()) {
      return resourceLink({ name, uri, mimeType, size: null });
    }

    const buffer = await readFile(resolvedPath);
    if (mimeType?.startsWith("image/")) {
      return {
        type: "image",
        data: buffer.toString("base64"),
        mimeType,
        uri,
      };
    }

    if (mimeType?.startsWith("audio/")) {
      return {
        type: "audio",
        data: buffer.toString("base64"),
        mimeType,
        _meta: { specflowUri: uri, specflowName: name },
      };
    }

    if (isTextMime(mimeType)) {
      return {
        type: "resource",
        resource: {
          uri,
          text: buffer.toString("utf8"),
          mimeType,
        },
      };
    }

    return {
      type: "resource",
        resource: {
          uri,
          blob: buffer.toString("base64"),
          mimeType,
        },
      };
  } catch {
    return resourceLink({ name, uri, mimeType, size: null });
  }
}

function resourceLink(input: {
  name: string;
  uri: string;
  mimeType?: string | null;
  size?: number | null;
}): PromptBlock {
  return {
    type: "resource_link",
    name: input.name,
    uri: input.uri,
    mimeType: input.mimeType ?? null,
    size: input.size ?? null,
  };
}

function resolveResourcePath(cwd: string, resourcePath: string): string {
  return isAbsolute(resourcePath) ? resolve(resourcePath) : resolve(cwd, resourcePath);
}

function isTextMime(mimeType: string | undefined): boolean {
  return Boolean(
    mimeType && (
      mimeType.startsWith("text/")
      || mimeType === "application/json"
      || mimeType === "application/xml"
      || mimeType === "application/yaml"
      || mimeType === "application/x-yaml"
    ),
  );
}

function mimeTypeForPath(path: string): string | undefined {
  switch (extname(path).toLowerCase()) {
    case ".apng":
      return "image/apng";
    case ".avif":
      return "image/avif";
    case ".bmp":
      return "image/bmp";
    case ".gif":
      return "image/gif";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    case ".aac":
      return "audio/aac";
    case ".flac":
      return "audio/flac";
    case ".m4a":
      return "audio/mp4";
    case ".mp3":
      return "audio/mpeg";
    case ".oga":
    case ".ogg":
      return "audio/ogg";
    case ".wav":
      return "audio/wav";
    case ".weba":
      return "audio/webm";
    case ".css":
      return "text/css";
    case ".csv":
      return "text/csv";
    case ".html":
    case ".htm":
      return "text/html";
    case ".md":
      return "text/markdown";
    case ".txt":
      return "text/plain";
    case ".xml":
      return "application/xml";
    case ".json":
      return "application/json";
    case ".yaml":
    case ".yml":
      return "application/yaml";
    case ".pdf":
      return "application/pdf";
    case ".zip":
      return "application/zip";
    default:
      return undefined;
  }
}
