## Repository rules

- The PRD is the product-level source of truth. Do not invent requirements; mark unresolved decisions `TBD` and do not silently expand scope.
- Preserve the monorepo boundaries: `frontend`, `backend`, `ai-service`, `database`, `tests`, `docs`, `docker`, `scripts`, and `monitoring`. Add deeper directories only with real implementation.
- Organize business code by feature/domain, keep related code close, and avoid giant files, duplicate utilities/types, circular dependencies, speculative abstractions, and repeated restructuring.
- Prefer existing patterns and the smallest justified dependency. A planned technology in documentation is not authorization to install it.
- Keep implementation, contracts, tests, and documentation synchronized. Validate relevant behavior before claiming it works.
- Security-sensitive changes require explicit threat/authorization/data reasoning and negative tests. Do not alter infrastructure or backend policy without a traced requirement.
- UI work must follow `docs/design/DESIGN_SYSTEM.md`; avoid generic AI-dashboard styling, unnecessary decoration, and accessibility regressions.
- Use context efficiently. Use Graphify when repository understanding benefits from it; do not run broad or redundant tools without a concrete need.

## graphify

Graphify is installed for this project in `.tools/graphify` and pinned to version 0.9.72. No knowledge graph has been built yet.

On Windows PowerShell, invoke it through the project environment and keep local query logging and cross-platform skill auto-refresh disabled:

```powershell
$env:GRAPHIFY_NO_AUTO_REFRESH = '1'
$env:GRAPHIFY_QUERY_LOG_DISABLE = '1'
& '.\.tools\graphify\Scripts\graphify.exe' <command>
```

Treat every bare `graphify` example in the installed skill as the project-local command above. Do not install or upgrade Graphify globally. For the initial graph, index code only with `extract . --code-only`; do not ingest documents, images, URLs, or external services unless the user explicitly asks.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run the project-local `graphify query "<question>"` when graphify-out/graph.json exists. Use its `path "<A>" "<B>"` command for relationships and `explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run the project-local `graphify update .` to keep an existing graph current (AST-only, no API cost).
