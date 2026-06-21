#!/usr/bin/env node
/*
 * to-epub.js — package an SVG-rendered book HTML into a valid EPUB 3.
 *
 * Usage: node to-epub.js --in book.rendered.html [--config book.json] --out book.epub
 *
 * Splits on <section class="chapter|cover"> ... </section>, wraps each as XHTML,
 * inlines the book CSS, keeps Mermaid's inline <svg>, and zips an EPUB 3 container
 * (mimetype stored first, uncompressed). Uses the system `zip` CLI.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const inFile = arg("in");
const outFile = path.resolve(arg("out", "book.epub"));
const configPath = arg("config");
if (!inFile || !fs.existsSync(inFile)) {
  console.error("to-epub: --in <rendered.html> required"); process.exit(1);
}
const cfg = configPath && fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};

const html = fs.readFileSync(inFile, "utf8");
const title = cfg.title || extract(html, /<title>([^<]*)<\/title>/) || "Untitled";
const author = cfg.author || "Generated with Claude Code";
const lang = cfg.lang || "en";
const bookId = "urn:uuid:" + pseudoUuid(title + author);

// Pull the inlined <style> (the book theme) to reuse in every chapter file.
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ""])[1];

// Extract <section ...>…</section> blocks (cover + chapters).
const sectionRe = /<section\b([^>]*)>([\s\S]*?)<\/section>/g;
const chapters = [];
let m, idx = 0;
while ((m = sectionRe.exec(html))) {
  const attrs = m[1];
  const inner = m[2];
  const id = (attrs.match(/id="([^"]+)"/) || [, "ch" + idx])[1];
  const cls = (attrs.match(/class="([^"]+)"/) || [, ""])[1];
  // Title = first heading text, else the id
  const h = inner.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
  const navTitle = h ? stripTags(h[1]) : (cls.includes("cover") ? title : id);
  chapters.push({ id, cls, inner, navTitle, file: `chap-${String(idx).padStart(2, "0")}-${safe(id)}.xhtml` });
  idx++;
}
if (!chapters.length) {
  // Fallback: whole body as one chapter
  const body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/) || [, html])[1]
    .replace(/<script[\s\S]*?<\/script>/g, "");
  chapters.push({ id: "book", cls: "chapter", inner: body, navTitle: title, file: "chap-00-book.xhtml" });
}

// ---- staging dir ----
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "epub-"));
const oebps = path.join(stage, "OEBPS");
const metaInf = path.join(stage, "META-INF");
fs.mkdirSync(oebps, { recursive: true });
fs.mkdirSync(metaInf, { recursive: true });

// mimetype (MUST be first & stored)
fs.writeFileSync(path.join(stage, "mimetype"), "application/epub+zip");

// container.xml
fs.writeFileSync(path.join(metaInf, "container.xml"),
`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);

// shared stylesheet
fs.writeFileSync(path.join(oebps, "style.css"), css + "\n.cover,.chapter{page-break-before:auto;}\n");

// chapter XHTML files
for (const ch of chapters) {
  const xhtml = toXhtml(ch.inner);
  fs.writeFileSync(path.join(oebps, ch.file),
`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}">
<head><meta charset="utf-8"/><title>${esc(ch.navTitle)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><section class="${ch.cls || "chapter"}" id="${ch.id}">
${xhtml}
</section></body></html>`);
}

// nav.xhtml (EPUB3 TOC)
const navItems = chapters
  .filter((c) => !c.cls.includes("cover"))
  .map((c) => `      <li><a href="${c.file}">${esc(c.navTitle)}</a></li>`).join("\n");
fs.writeFileSync(path.join(oebps, "nav.xhtml"),
`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}">
<head><meta charset="utf-8"/><title>Contents</title></head>
<body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${navItems}
</ol></nav></body></html>`);

// toc.ncx (EPUB2 fallback for old readers)
const navPoints = chapters
  .filter((c) => !c.cls.includes("cover"))
  .map((c, i) => `    <navPoint id="np${i}" playOrder="${i + 1}"><navLabel><text>${esc(c.navTitle)}</text></navLabel><content src="${c.file}"/></navPoint>`).join("\n");
fs.writeFileSync(path.join(oebps, "toc.ncx"),
`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${bookId}"/></head>
  <docTitle><text>${esc(title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap></ncx>`);

// content.opf
const manifestItems = chapters.map((c) =>
  `    <item id="${safe(c.id)}" href="${c.file}" media-type="application/xhtml+xml"/>`).join("\n");
const spineItems = chapters.map((c) => `    <itemref idref="${safe(c.id)}"/>`).join("\n");
const dateStr = (cfg.date || "2024-01-01T00:00:00Z");
fs.writeFileSync(path.join(oebps, "content.opf"),
`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:title>${esc(title)}</dc:title>
    <dc:creator>${esc(author)}</dc:creator>
    <dc:language>${lang}</dc:language>
    <meta property="dcterms:modified">${dateStr}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
${manifestItems}
  </manifest>
  <spine toc="ncx">
${spineItems}
  </spine>
</package>`);

// ---- zip into epub (mimetype first, stored) ----
if (fs.existsSync(outFile)) fs.rmSync(outFile);
execFileSync("zip", ["-X", "-0", outFile, "mimetype"], { cwd: stage, stdio: "ignore" });
execFileSync("zip", ["-X", "-9", "-r", outFile, "META-INF", "OEBPS"], { cwd: stage, stdio: "ignore" });
fs.rmSync(stage, { recursive: true, force: true });

console.log(`Wrote ${outFile} — ${chapters.length} sections, EPUB 3`);

// ---------- helpers ----------
function extract(s, re) { const m = s.match(re); return m ? m[1].trim() : ""; }
function stripTags(s) { return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); }
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
function safe(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, "_"); }
function pseudoUuid(seed) {
  let h = 0; for (let i = 0; i < seed.length; i++) { h = (h * 31 + seed.charCodeAt(i)) >>> 0; }
  const hex = (h.toString(16) + "0000000").slice(0, 8);
  return `${hex}-0000-4000-8000-000000000000`;
}
/* Make HTML well-formed enough for XHTML: self-close void elements, fix bare attrs & entities.
   Mermaid SVG is already namespaced & well-formed. */
function toXhtml(s) {
  // drop any script tags that slipped in
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  // self-close void elements
  s = s.replace(/<(br|hr|img|meta|input|link|col|area|base|source|wbr)\b([^>]*?)\s*\/?>/gi,
    (mm, tag, attrs) => `<${tag}${attrs}/>`);
  // bare boolean attrs -> none expected from marked; normalize &nbsp; etc to numeric
  s = s.replace(/&nbsp;/g, "&#160;").replace(/&mdash;/g, "&#8212;").replace(/&ndash;/g, "&#8211;")
       .replace(/&hellip;/g, "&#8230;").replace(/&amp;(?![a-zA-Z]+;|#\d+;)/g, "&amp;");
  return s;
}
