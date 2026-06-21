#!/usr/bin/env bash
# make-book.sh — build a book in one or more formats from a chapters directory.
#
# Usage:
#   make-book.sh --content <chaptersDir> [--config <book.json>] [--out <buildDir>]
#                [--formats pdf,epub,html] [--open]
#
# Steps: npm install (once) -> build-html.js -> render Mermaid to SVG (headless Chrome)
#        -> emit chosen formats. EPUB and the self-contained HTML use the SVG-rendered DOM;
#        PDF prints from the rendered HTML (falls back to live-render if needed).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CONTENT="" ; CONFIG="" ; OUT="" ; FORMATS="pdf,epub,html" ; OPEN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --content) CONTENT="$2"; shift 2;;
    --config)  CONFIG="$2";  shift 2;;
    --out)     OUT="$2";     shift 2;;
    --formats) FORMATS="$2"; shift 2;;
    --open)    OPEN=1;       shift;;
    *) echo "unknown arg: $1" >&2; exit 1;;
  esac
done

[ -n "$CONTENT" ] || { echo "ERROR: --content <dir> required" >&2; exit 1; }
CONTENT="$(cd "$CONTENT" && pwd)"
[ -n "$OUT" ] || OUT="$CONTENT/build"
mkdir -p "$OUT"
[ -n "$CONFIG" ] && CONFIG_ARG="--config $CONFIG" || CONFIG_ARG=""
# Default config = <content>/book.json if present
if [ -z "$CONFIG" ] && [ -f "$CONTENT/book.json" ]; then CONFIG_ARG="--config $CONTENT/book.json"; fi

# Title for output filenames
TITLE="$(node -e "try{const c=require('${CONFIG:-$CONTENT/book.json}');process.stdout.write((c.title||'book'))}catch(e){process.stdout.write('book')}" 2>/dev/null || echo book)"
SLUG="$(echo "$TITLE" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-' | sed 's/--*/-/g;s/^-//;s/-$//')"
[ -n "$SLUG" ] || SLUG="book"

# ---- find Chrome ----
find_chrome() {
  for c in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
    "$(command -v google-chrome 2>/dev/null)" \
    "$(command -v chromium 2>/dev/null)" \
    "$(command -v chromium-browser 2>/dev/null)" ; do
    [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; return 0; }
  done
  return 1
}
CHROME="$(find_chrome || true)"

# ---- deps ----
if [ ! -d "$SCRIPT_DIR/node_modules/mermaid" ]; then
  echo ">> installing build deps (marked, mermaid)…"
  ( cd "$SCRIPT_DIR" && npm install --silent )
fi

# ---- 1. assemble HTML ----
echo ">> assembling HTML…"
node "$SCRIPT_DIR/build-html.js" $CONFIG_ARG --content "$CONTENT" --out "$OUT"
RAW="$OUT/book.raw.html"
RENDERED="$OUT/book.rendered.html"

# ---- 2. render Mermaid -> inline SVG via headless Chrome (dump-dom) ----
render_ok=0
if [ -n "$CHROME" ]; then
  echo ">> rendering Mermaid diagrams to SVG…"
  "$CHROME" --headless --disable-gpu --no-sandbox \
    --virtual-time-budget=60000 --run-all-compositor-stages-before-draw \
    --dump-dom "file://$RAW" > "$RENDERED" 2>/dev/null || true
  # Success heuristic: rendered DOM has <svg and no leftover raw mermaid source
  if grep -q "<svg" "$RENDERED" 2>/dev/null && ! grep -qE "class=\"mermaid\">(flowchart|sequenceDiagram|classDiagram|erDiagram|graph )" "$RENDERED" 2>/dev/null; then
    render_ok=1
  fi
fi
if [ "$render_ok" != "1" ]; then
  echo "   (Mermaid pre-render unavailable; using raw HTML — PDF will live-render, EPUB diagrams may be text)"
  cp "$RAW" "$RENDERED"
fi

# Self-contained HTML output = rendered (works offline, no JS needed)
SELF_HTML="$OUT/$SLUG.html"
cp "$RENDERED" "$SELF_HTML"

OUTPUTS=()
IFS=',' read -ra FMTS <<< "$FORMATS"
for fmt in "${FMTS[@]}"; do
  case "$fmt" in
    html)
      OUTPUTS+=("$SELF_HTML")
      ;;
    pdf)
      if [ -z "$CHROME" ]; then echo "   !! PDF needs Chrome; skipping"; continue; fi
      echo ">> printing PDF…"
      PDF="$OUT/$SLUG.pdf"
      SRC="$RENDERED"; [ "$render_ok" = "1" ] || SRC="$RAW"
      "$CHROME" --headless --disable-gpu --no-sandbox --no-pdf-header-footer \
        --virtual-time-budget=60000 --run-all-compositor-stages-before-draw \
        --print-to-pdf="$PDF" "file://$SRC" 2>/dev/null || true
      [ -f "$PDF" ] && OUTPUTS+=("$PDF")
      ;;
    epub)
      echo ">> packaging EPUB…"
      EPUB="$OUT/$SLUG.epub"
      node "$SCRIPT_DIR/to-epub.js" --in "$RENDERED" $CONFIG_ARG --out "$EPUB" || echo "   !! EPUB build failed"
      [ -f "$EPUB" ] && OUTPUTS+=("$EPUB")
      ;;
    *) echo "   ?? unknown format: $fmt";;
  esac
done

echo ""
echo "=== Done. Outputs: ==="
for o in "${OUTPUTS[@]}"; do
  printf "  %s  (%s)\n" "$o" "$(du -h "$o" | cut -f1)"
done

if [ "$OPEN" = "1" ]; then
  for o in "${OUTPUTS[@]}"; do
    case "$o" in *.pdf) open "$o" 2>/dev/null || true;; esac
  done
fi
