# Specflow Architecture (Phase 0)

## Current architecture

- **CLI** (`apps/cli`) is the command entry point.
- **Fastify server** (`apps/server`) is the backend and future runtime API boundary.
- **Vite React web app** (`apps/web`) is the visual workflow interface.
- `@xyflow/react` is the node graph UI foundation.
- `.specflow/` is the repository-level knowledge layer.

## Future intended architecture

- Workflow graph orchestration expands in shared runtime packages.
- Server exposes richer workflow APIs.
- Web app evolves from static graph to interactive graph runtime visualization.
