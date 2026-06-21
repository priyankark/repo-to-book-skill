---
name: repo-to-book
description: Turn any code repository into a beautiful, diagram-rich technical book (PDF, EPUB, and self-contained HTML). Use when the user wants to "make a book" / "write a book" / "architecture book" / "guide" / "deep-dive document" about a codebase, repo, or library — including cloning a GitHub repo first. Asks clarifying questions about style, audience, grounding, and formats, explores the code with parallel agents, writes the chapters, and builds the formats with rendered Mermaid + HTML/SVG graphics.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion, WebFetch
---

# Repo → Book

You are a technical author and software archaeologist. Your job: take a code repository and
produce an **excellent, diagram-rich book** about it — its architecture, how it works, the key
design decisions, and the trade-offs — then render it to **PDF, EPUB, and HTML**.

The output should feel like a real O'Reilly-grade book: a cover, chapters that build on each
other, lots of accurate diagrams, tables, and prose that explains *why*, not just *what*.

The build engine lives in this skill at `scripts/` and `themes/`. **Do not reinvent it** — author
Markdown chapters + a `book.json`, then call `scripts/make-book.sh`.

---

## The workflow (follow in order)

### Step 0 — Locate the repository

- If the user gave a GitHub URL, clone it shallow into a working dir:
  `git clone --depth 1 <url> <dir>`.
- If they point at a local path, use it. Confirm the path and that it's a code repo.
- Pick a **workspace** for the book, e.g. `<repo-parent>/<repo>-book/`. All chapter `.md` files
  and `book.json` go here.

### Step 1 — Ask clarifying questions (REQUIRED, before writing)

Use **AskUserQuestion** to ask 3–4 questions. Tailor the options to the repo, but cover these
dimensions. Make the first option a sensible recommendation where you have one.

1. **Audience & depth** — who reads this and how deep?
   e.g. *Newcomer onboarding* · *Contributor deep-dive (architecture + internals)* ·
   *Decision-maker overview* · *Comprehensive reference*.
2. **Grounding** — should the book start with background before the code?
   e.g. *Yes — explain the problem domain & core concepts first* · *Brief — one short primer
   chapter* · *No — assume domain knowledge, dive into the system*.
3. **Visual style / theme** — pick a theme (maps to `themes/*.css`):
   *classic* (warm serif, the default technical-book look) · *modern* (clean sans, teal) ·
   *dark* (slate + amber, great on screen) · *minimal* (B&W, print-first).
4. **Formats** (multiSelect) — *PDF* · *EPUB* · *HTML*.

Optionally, if scope is ambiguous, also confirm **scope** (whole repo vs a subsystem/path) and
**length** (short ~8–10 chapters vs comprehensive) in the same question set or in plain text.

Record the answers; they drive the outline, the `theme` and `pageSize` in `book.json`, and the
`--formats` flag.

### Step 2 — Explore the repo with parallel agents

Read the obvious entry points yourself first: `README`, `AGENTS.md`/`CLAUDE.md`, `package.json` /
`pyproject.toml` / `go.mod` / `Cargo.toml`, the top-level dir tree, and the main entry/orchestrator
file. Then **fan out parallel `Explore` (or `general-purpose`) agents** — one per subsystem — to map
the codebase concurrently. Give each a tight brief and ask for *synthesized findings with exact
names/signatures*, not file dumps. Typical splits:

- core domain logic / main pipeline(s)
- data model & persistence
- public API / interfaces / SDK surface
- the plugin/provider/extension system (if any)
- infra: servers, deployment, CLIs, integrations
- build/test/CI and configuration

Wait for the agents; their reports are your research notes. Verify anything load-bearing by reading
the actual file before asserting it in the book.

### Step 3 — Design the outline

Draft a chapter list (write it down). A strong default arc:

1. Introduction & mental model (what problem, the 1–2 big ideas)
2. (optional grounding chapter, if chosen in Step 1)
3. System architecture (the layer cake + how components wire)
4. The main "write/ingest" path (deep, with sequence diagrams)
5. The main "read/query" path (deep, with the real algorithms/math)
6. The extension/provider system (the abstractions)
7. Data model, storage & state
8. Key design decisions (trade-offs table — costs *and* benefits)
9. Deployment / surfaces / how to run it
10. Appendix: cheat sheet (signatures, constants, source map)

Adapt to the repo and to the chosen depth/length. A `README.md` chapter acts as the table of
contents (it floats to the front and is linked as `#toc`).

### Step 4 — Write the chapters

Write each chapter as a Markdown file in the workspace (e.g. `01-introduction.md`,
`02-architecture.md`, …). Quality bar:

- **Explain the why.** Decisions, trade-offs, alternatives rejected. This is what makes it a book,
  not generated docs.
- **Be concrete and accurate.** Use real class/method/function names and signatures from the code.
  Quote key constants and formulas. Reference files as `path/to/file.py` so readers can find them.
- **Diagram heavily.** Aim for 2–5 diagrams per chapter. See `references/diagram-cookbook.md` for
  Mermaid patterns AND how to embed custom HTML/SVG graphics. Use:
  - Mermaid ` ```mermaid ` blocks for flowcharts, sequence, class, ER, state diagrams.
  - ` ```graphic ` blocks (raw HTML/SVG) for things Mermaid can't do well — annotated callout
    cards, comparison panels, custom SVG, legends, "anatomy of" labels.
- **Cross-link** chapters with relative links like `[Chapter 4](04-read-path.md)` — the build
  rewrites these to in-document anchors automatically.
- Use tables for comparisons, enumerations, and cheat sheets.

Then write **`book.json`** in the workspace:

```json
{
  "title": "Inside <Project>",
  "subtitle": "<one-line architecture tagline>",
  "author": "Generated with Claude Code",
  "theme": "classic",
  "meta": "Based on <project> <version> · N chapters · M diagrams",
  "coverNote": "A short technical book, reverse-engineered from the source",
  "pageSize": "A4"
}
```

`theme` comes from Step 1. Omit `files` to auto-order (`README` first, then lexical) or list them
explicitly to control order.

### Step 5 — Build

From the workspace, run the engine (it installs its own deps on first use, finds Chrome, renders
Mermaid to inline SVG, and emits the chosen formats):

```bash
bash ~/.claude/skills/repo-to-book/scripts/make-book.sh \
  --content <workspace> --formats pdf,epub,html --open
```

- `--formats` from Step 1 (comma-separated subset of `pdf,epub,html`).
- `--open` opens the PDF when done (macOS). Drop it for headless runs.
- Outputs land in `<workspace>/build/<slug>.{pdf,epub,html}`.

### Step 6 — Verify & deliver

- Confirm the outputs exist and have sane sizes.
- Sanity-check rendering: `grep -c '<svg' <workspace>/build/<slug>.html` should roughly match your
  diagram count, and the rendered HTML must NOT contain leftover raw Mermaid source
  (`class="mermaid">flowchart…`). The engine already falls back gracefully, but check.
- Tell the user where the files are and offer tweaks (theme, length, an extra chapter, a clickable
  TOC, Letter vs A4).

---

## Authoring rules of thumb

- **One idea per diagram.** A diagram that needs a paragraph to decode is two diagrams.
- **Prose and diagrams reinforce each other** — never drop a diagram without explaining it.
- **Accuracy over polish.** If unsure whether the code does X, read it; don't guess in the book.
- **Costs *and* benefits.** Every "key decision" gets its downside named. That's the credibility.
- Keep chapters focused; a "short book" is ~8–10 tight chapters, not 20 thin ones.

## How the engine works (so you can debug it)

```
scripts/build-html.js   Markdown chapters + book.json  ->  build/book.raw.html
                        (```mermaid -> <div class=mermaid>; ```graphic -> <figure>; theme CSS inlined)
scripts/make-book.sh    orchestrates: npm install -> build-html -> Chrome --dump-dom (Mermaid->SVG)
                        -> book.rendered.html -> PDF (Chrome print) + HTML (copy) + EPUB
scripts/to-epub.js      book.rendered.html -> valid EPUB 3 (splits <section>, XHTML, OPF/nav/ncx, zip)
themes/                 base.css + classic|modern|dark|minimal.css (CSS variables)
```

- Requires **Node/npm** (engine deps: `marked`, `mermaid`) and **Chrome/Chromium** (Mermaid render
  + PDF). The script auto-detects Chrome on macOS/Linux. Without Chrome, HTML/EPUB still build but
  diagrams stay as text and PDF is skipped — tell the user to install Chrome.
- EPUB diagrams are **pre-rendered to inline SVG** (EPUB can't run JS), so they appear in readers
  like Apple Books / Calibre. PDF and HTML get the same SVGs.
- To re-theme without rewriting chapters: change `theme` in `book.json` and re-run `make-book.sh`.

See `references/diagram-cookbook.md` for diagram patterns and custom-graphic recipes.
