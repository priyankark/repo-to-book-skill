#!/usr/bin/env node
/*
 * build-html.js — assemble Markdown chapters into one self-contained HTML "book".
 *
 * Usage:
 *   node build-html.js --config <book.json> --content <chaptersDir> --out <buildDir>
 *
 * Produces <buildDir>/book.raw.html  (Mermaid still as <div class="mermaid"> + mermaid.js)
 * The render step (render.sh) turns Mermaid into inline SVG via headless Chrome.
 *
 * book.json shape (all fields optional except title):
 * {
 *   "title":     "Inside Mem0",
 *   "subtitle":  "The Architecture of a Memory Layer for AI",
 *   "author":    "Generated with Claude Code",
 *   "theme":     "classic" | "modern" | "dark" | "minimal",
 *   "meta":      "Based on mem0ai 2.0.7 · 9 chapters · 32 diagrams",
 *   "coverNote": "A short technical book, reverse-engineered from the source",
 *   "pageSize":  "A4" | "Letter",
 *   "files":     ["README.md","01-intro.md", ...]   // explicit order; omit to auto-sort *.md
 * }
 */
const fs = require("fs");
const path = require("path");
const { marked } = require("marked");

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const SKILL_DIR = path.resolve(__dirname, "..");
const configPath = arg("config");
const contentDir = path.resolve(arg("content", "."));
const outDir = path.resolve(arg("out", path.join(contentDir, "build")));
fs.mkdirSync(outDir, { recursive: true });

const cfg = configPath && fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, "utf8"))
  : {};

const title = cfg.title || "Untitled Book";
const subtitle = cfg.subtitle || "";
const author = cfg.author || "Generated with Claude Code";
const theme = cfg.theme || "classic";
const meta = cfg.meta || "";
const coverNote = cfg.coverNote || "";
const pageSize = cfg.pageSize || "A4";

// Resolve chapter files
let files = cfg.files;
if (!files || !files.length) {
  files = fs.readdirSync(contentDir)
    .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "book.json")
    .sort();
  // Float README/index to front as TOC
  files.sort((a, b) => {
    const fa = /readme|index/i.test(a) ? 0 : 1;
    const fb = /readme|index/i.test(b) ? 0 : 1;
    return fa - fb || a.localeCompare(b);
  });
}

// ---- Markdown renderer: route ```mermaid to <div class="mermaid">, pass HTML through ----
const renderer = new marked.Renderer();
const baseCode = renderer.code.bind(renderer);
renderer.code = function (token) {
  // marked v9+ passes a token object {text, lang, ...}
  const text = token && typeof token === "object" ? token.text : token;
  const lang = ((token && token.lang) || "").trim().split(/\s+/)[0];
  if (lang === "mermaid") return `\n<div class="mermaid">${text}</div>\n`;
  if (lang === "graphic" || lang === "html-graphic") {
    // Raw HTML/SVG graphic block, wrapped in a styled figure
    return `\n<figure class="graphic">${text}</figure>\n`;
  }
  return baseCode(token);
};
marked.setOptions({ renderer, gfm: true, breaks: false });

function anchorFor(file) {
  if (/readme|index/i.test(file)) return "toc";
  return file.replace(/\.md$/i, "");
}

// Build chapter sections
const sections = [];
for (const f of files) {
  const fp = path.join(contentDir, f);
  if (!fs.existsSync(fp)) {
    console.warn("skip missing chapter:", f);
    continue;
  }
  let md = fs.readFileSync(fp, "utf8");
  // Rewrite inter-chapter links: foo.md -> #foo ; README.md -> #toc
  md = md.replace(/\]\(([\w./-]+?)\.md(#[\w-]+)?\)/g, (m, base, hash) => {
    const fn = base.split("/").pop();
    return `](#${anchorFor(fn + ".md")}${hash || ""})`;
  });
  const html = marked.parse(md);
  sections.push(`<section id="${anchorFor(f)}" class="chapter">\n${html}\n</section>`);
}

// ---- CSS: shared base + selected theme ----
const baseCss = fs.readFileSync(path.join(SKILL_DIR, "themes", "base.css"), "utf8");
const themeFile = path.join(SKILL_DIR, "themes", theme + ".css");
const themeCss = fs.existsSync(themeFile)
  ? fs.readFileSync(themeFile, "utf8")
  : fs.readFileSync(path.join(SKILL_DIR, "themes", "classic.css"), "utf8");
const pageCss = `@page { size: ${pageSize}; margin: 16mm 13mm 18mm; }`;

// ---- Mermaid runtime (inlined) ----
const mermaidJs = fs.readFileSync(
  path.join(__dirname, "node_modules/mermaid/dist/mermaid.min.js"),
  "utf8"
);
// Theme -> mermaid theme mapping
const mermaidTheme = theme === "dark" ? "dark" : "neutral";

const cover = `
<section id="cover" class="cover">
  <div class="cover-inner">
    <h1 class="cover-title">${escapeHtml(title)}</h1>
    ${subtitle ? `<div class="cover-subtitle">${escapeHtml(subtitle)}</div>` : ""}
    <div class="cover-rule"></div>
    ${coverNote ? `<div class="cover-note">${escapeHtml(coverNote)}</div>` : ""}
    ${meta ? `<div class="cover-meta">${meta}</div>` : ""}
    <div class="cover-author">${escapeHtml(author)}</div>
  </div>
</section>`;

const doc = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
${baseCss}
${themeCss}
${pageCss}
</style>
</head>
<body>
${cover}
${sections.join("\n")}
<script>${mermaidJs}</script>
<script>
  mermaid.initialize({
    startOnLoad: false, theme: "${mermaidTheme}", securityLevel: "loose",
    flowchart: { useMaxWidth: true, htmlLabels: true, curve: "basis" },
    sequence: { useMaxWidth: true }, er: { useMaxWidth: true },
    fontFamily: "var(--font-sans, Helvetica Neue, Arial, sans-serif)"
  });
  (async () => {
    try { await mermaid.run({ querySelector: ".mermaid" }); }
    catch (e) { console.error("mermaid error", e); }
    window.__BOOK_RENDER_DONE__ = true;
    document.documentElement.setAttribute("data-render", "done");
  })();
</script>
</body></html>`;

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

const outFile = path.join(outDir, "book.raw.html");
fs.writeFileSync(outFile, doc);
const nDiagrams = (doc.match(/class="mermaid"/g) || []).length;
const nGraphics = (doc.match(/class="graphic"/g) || []).length;
console.log(
  `Wrote ${path.relative(process.cwd(), outFile)} — ${sections.length} chapters, ` +
  `${nDiagrams} mermaid diagrams, ${nGraphics} html/svg graphics, theme=${theme}`
);
