# repo-to-book

Turn any code repository into a beautiful, diagram-rich technical book — **PDF, EPUB, and
self-contained HTML** — with rendered Mermaid diagrams and custom HTML/SVG graphics.

Point it at a local path or a GitHub URL. It explores the code with parallel agents, writes
chapters that explain the *why* (not just the *what*), and builds the formats.

> **Want to see what it produces?** Open
> [`samples/inside-codex.pdf`](samples/inside-codex.pdf) — a book reverse-engineered from
> [`openai/codex`](https://github.com/openai/codex).

## What's here

```
repo-to-book/
├── README.md              ← you are here
├── skills/
│   └── repo-to-book/      ← the Claude Code skill
│       ├── SKILL.md       ← skill definition & authoring workflow
│       ├── scripts/       ← the build engine (make-book.sh, build-html.js, to-epub.js)
│       ├── themes/        ← CSS themes: classic, modern, dark, minimal
│       └── references/    ← the diagram & graphics cookbook
└── samples/
    └── inside-codex.pdf   ← example output (built from openai/codex)
```

## How to use it

This is a Claude Code skill. Install it by copying `skills/repo-to-book/` into your skills
directory (`~/.claude/skills/repo-to-book/`), then invoke it from a Claude Code session:

```
/repo-to-book https://github.com/openai/codex.git
```

…or just ask in natural language: *"make an architecture book about this repo."* The skill
asks a few questions (audience & depth, how much background, visual theme, and which
formats), explores the codebase, writes the chapters, and builds the output.

## The build engine

Authoring produces a **workspace** of Markdown chapters plus a `book.json`. The engine turns
that into rendered formats:

```bash
bash skills/repo-to-book/scripts/make-book.sh --content <workspace> --formats pdf,epub,html
```

Pipeline:

```
build-html.js   chapters + book.json  ->  build/book.raw.html
                (```mermaid -> <div class=mermaid>, ```graphic -> <figure>, theme CSS inlined)
make-book.sh    npm install -> build-html -> Chrome --dump-dom (Mermaid -> inline SVG)
                -> book.rendered.html -> PDF (Chrome print) + HTML (copy) + EPUB
to-epub.js      book.rendered.html -> valid EPUB 3
```

Outputs land in `<workspace>/build/<slug>.{pdf,epub,html}`.

### Requirements

- **Node/npm** — the engine installs its own deps (`marked`, `mermaid`) on first run.
- **Chrome/Chromium** — renders Mermaid to inline SVG and prints the PDF. Auto-detected on
  macOS/Linux. Without it, HTML/EPUB still build but diagrams stay as text and PDF is skipped.

## Themes

Set `"theme"` in the workspace's `book.json` to one of `classic`, `modern`, `dark`,
`minimal`. To re-theme an existing book, change that field and re-run `make-book.sh` — no
need to touch the chapters.

## Authoring notes

Chapters are plain Markdown. Diagrams come in two flavors:

- ```` ```mermaid ```` blocks — flowcharts, sequence, class, ER, and state diagrams.
- ```` ```graphic ```` blocks — raw HTML/SVG for things Mermaid can't do (annotated
  "anatomy of" figures, comparison panels, callout cards, custom SVG).

See [`skills/repo-to-book/references/diagram-cookbook.md`](skills/repo-to-book/references/diagram-cookbook.md)
for patterns. Aim for 2–5 diagrams per chapter, cross-link chapters with relative links
(rewritten to anchors at build time), and use tables for comparisons and cheat sheets.
