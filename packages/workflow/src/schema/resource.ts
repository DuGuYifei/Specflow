export type WorkflowResourceKind = "image" | "file" | "folder";

export interface WorkflowResourceRef {
  id: string;
  kind: WorkflowResourceKind;
  path: string;
  label?: string;
  mimeType?: string;
}
