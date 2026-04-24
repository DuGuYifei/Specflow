# Product Vision

## Specflow and Continuous Coding

**Specflow** is the product. **Continuous Coding** is the category narrative.

Specflow structures the path from ticket intent to implementation-ready patch set before CI. The long-term direction is a verified implementation graph that runs in a controlled pre-CI boundary.

## CC → CI → CD

Specflow sits in front of CI/CD:

1. **CC (Continuous Coding):** decompose and verify implementation intent.
2. **CI:** compile, test, and enforce repository policies.
3. **CD:** release validated changes.

## Phase 0 goal

Phase 0 establishes repository foundation:

- deterministic tooling
- explicit package boundaries
- AI-readable documentation
- placeholder runtime surfaces across CLI/server/web

## Why node-based workflow visualization matters

Specflow models implementation as a graph of nodes and edges. Visualizing this graph is central because it makes intent, dependencies, and review loops explicit.

## Why reviewer/verifier loops matter

Continuous Coding requires iterative validation. Reviewer and verifier nodes provide repeatable repair loops before code reaches CI, reducing downstream churn and improving patch confidence.
