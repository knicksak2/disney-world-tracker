# AGENTS.md

Entry point for any AI agent working in this repository (Antigravity, Gemini CLI, Cursor, Claude Code, etc.). This file is a **pointer**, not a duplicate — the canonical guidance lives in the files it references, so there is one source of truth and nothing drifts.

## Always follow the steering — Mandatory Initial Tool Call

Treat every Markdown file in **`.kiro/steering/`** as authoritative, always-on rules for all work in this repo — repo structure, backend/service/migration patterns, test stack, verification gates, mobile conventions, and output deliverables.

**MANDATORY INITIAL EXECUTION SEQUENCE (REQUIRED BEFORE ANY OTHER WORK):**

1. **Tool Call #1**: At the start of EVERY task, your VERY FIRST tool call MUST be `list_dir` on `.kiro/steering/`.
2. **Tool Call #2+**: You MUST use `view_file` to read **EVERY `.md` file** in `.kiro/steering/` before inspecting source code, running searches, drafting plans, or writing code.
3. **Future-Proof Scope**: Any existing or newly added Markdown files in `.kiro/steering/` are automatically in scope and MUST be read and strictly honored throughout the task.


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

## Communication style

How to talk to the user while working — this applies to every response, not just code.

- **Narrate as you work; don't go silent.** Before each action, write one short line on what you're about to do and why ("reading `optimizer.ts` to check the LL branch", "running the settings test"). Surface findings the moment you hit them rather than saving everything for a final summary. If something fails, say what failed and what you're trying next. The user wants to follow your reasoning live, not receive only an end-of-task report.
- **Report with reasoning, not just results.** When you finish, explain the tradeoffs you weighed — not only what you changed. Proactively flag anything you're unsure about, any risk, or anything weak about the request itself, even when unasked.
- **Be honest about certainty.** Clearly distinguish what you actually verified from what you're assuming. When a check passes, say what it does and doesn't prove (e.g. "green means nothing is broken, not that the new behavior is covered").
- **Be a partner, not a status printer.** Direct, technical, and concise. Correct the user when they're wrong instead of agreeing by default, and point out when a simpler or safer approach exists.

## Mandatory Pre-Response Operational Enforcement Rules

1. **Pre-Response Source Diff Audit (Anti-Hallucination Gate)**:
   - Before declaring ANY task or checkpoint complete, perform a line-by-line inspect of `git diff` / modified files against the user request.
   - Explicitly verify that every user-facing UI component, control, thumbnail, icon, toggle, modal, and route payload actually exists in source code before outputting a completion response.
2. **Mandatory Behavior → Test Map**:
   - Every completion response MUST include a table mapping each added/changed behavior, UI control, or engine branch to its specific test file and assertion.
3. **Mandatory Literal Output of `npm run verify`**:
   - Every completion response MUST paste the literal tail output of `npm run verify`, showing per-workspace test counts and exit code `0`.
