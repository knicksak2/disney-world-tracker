# AGENTS.md

Entry point for any AI agent working in this repository (Antigravity, Gemini CLI, Cursor, Claude Code, etc.). This file is a **pointer**, not a duplicate — the canonical guidance lives in the files it references, so there is one source of truth and nothing drifts.

## Always follow the steering

Treat every Markdown file in **`.kiro/steering/`** as authoritative, always-on rules for all work in this repo — repo structure, backend/service/migration patterns, which existing services to reuse (e.g. `Live_Service`, `wdwClock`, `permissions`, `themeParksDirectory`), the test stack and conventions, free-tier hosting constraints, mobile conventions, and modeling rules. Read that directory before writing code and honor it throughout. New steering files added there later are in scope automatically.

Start with `.kiro/steering/tech-conventions.md`.

## How to work from a spec

Feature specs live in **`.kiro/specs/<feature>/`**, each self-contained with three files:

- `requirements.md` — EARS acceptance criteria (the "what").
- `design.md` — architecture, components, data models, **Correctness Properties**, error handling, testing strategy, and (where present) **Configuration & Constants** and **External Interfaces** sections. These sections are authoritative — use their concrete defaults, env var names, endpoint shapes, id-mappings, and formulas exactly; do not invent alternatives.
- `tasks.md` — an ordered implementation plan with a **Task Dependency Graph** and checkpoints.

When implementing a spec:

1. Read the referenced steering, then all three spec files, before coding.
2. Work **task-by-task in dependency-graph order**, not all at once.
3. Stop at each **checkpoint** task, run the tests/diagnostics it names, and surface results for review before continuing.
4. Write the property tests the design specifies (fast-check, tagged as the steering describes).
5. Respect stated **cross-spec dependencies** — a spec that says it depends on another must be built after it.
6. If a spec is genuinely ambiguous or missing a value, ask rather than guess.

Some specs also include a `mockup.html` — a visual reference for the intended UI, not a literal implementation target.

## Scope of a change

Implement what the current spec/task defines. Do not expand scope, refactor unrelated code, or add features beyond the task without being asked.
