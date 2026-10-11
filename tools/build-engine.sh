#!/usr/bin/env bash
# Builds hooks/engine/doomgeneric.js from the doomgeneric sources with the
# pinned Emscripten SDK in Docker. Run from anywhere; needs docker and node.
#   tools/build-engine.sh            # clone (if needed), patch, compile, post-process
#   tools/build-engine.sh --debug    # same with -O1 -sASSERTIONS=1 (gate still applied)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MOD="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/build"
SRC="$BUILD/doomgeneric"
OUT="$BUILD/out"
IMAGE="emscripten/emsdk:6.0.12"
UPSTREAM="https://github.com/ozkl/doomgeneric.git"
COMMIT="dcb7a8d"

OPT="-O2 -sASSERTIONS=0"
if [[ "${1:-}" == "--debug" ]]; then OPT="-O1 -sASSERTIONS=1"; fi

if [[ ! -d "$SRC/.git" ]]; then
  git clone --quiet "$UPSTREAM" "$SRC"
fi
git -C "$SRC" fetch --quiet
git -C "$SRC" checkout --quiet "$COMMIT"
git -C "$SRC" checkout -- doomgeneric  # drop a previous run's patches
for p in "$HERE"/patches/*.patch; do git -C "$SRC" apply "$p"; done

# Makefile SRC_DOOM minus the X11 platform file, plus our platform file.
SOURCES=$(sed -n 's/^SRC_DOOM = //p' "$SRC/doomgeneric/Makefile" | tr ' ' '\n' | sed 's/\.o$/.c/' | grep -v '^doomgeneric_xlib\.c$' | sed 's#^#doomgeneric/#' | tr '\n' ' ')
mkdir -p "$OUT"
cp "$HERE/dg-platform.c" "$SRC/doomgeneric/dg-platform.c"
cp "$HERE/dg-library.js" "$SRC/dg-library.js"
mkdir -p "$SRC/out"

# Git Bash on Windows needs a Windows path for the volume and no path mangling.
HOST_SRC="$(cd "$SRC" && (pwd -W 2>/dev/null || pwd))"

MSYS_NO_PATHCONV=1 docker run --rm -v "$HOST_SRC:/src" -w /src "$IMAGE" bash -c "
  set -e
  emcc $SOURCES doomgeneric/dg-platform.c $OPT \
    -DNORMALUNIX -DLINUX -D_DEFAULT_SOURCE -DDOOMGENERIC_RESX=320 -DDOOMGENERIC_RESY=200 \
    -Wno-everything \
    -sWASM=0 -sMODULARIZE=1 -sEXPORT_NAME=createDoom -sEXPORT_ES6=0 -sENVIRONMENT=web \
    -sTEXTDECODER=2 -sWASM_ASYNC_COMPILATION=0 -sFORCE_FILESYSTEM=1 \
    -sALLOW_MEMORY_GROWTH=0 -sINITIAL_MEMORY=33554432 -sSTACK_SIZE=1048576 \
    -sEXPORTED_FUNCTIONS=_doomgeneric_Create,_doomgeneric_Tick,_DG_GetScreenBuffer,_DG_GetScreenWidth,_DG_GetScreenHeight,_malloc,_free \
    -sEXPORTED_RUNTIME_METHODS=FS,HEAPU8,HEAPU32,stringToNewUTF8,UTF8ToString \
    --js-library dg-library.js \
    -o out/doomgeneric.raw.js
" 
mkdir -p "$OUT"
mv "$SRC/out/doomgeneric.raw.js" "$OUT/doomgeneric.raw.js"
mkdir -p "$MOD/hooks/engine"
node "$HERE/postprocess.mjs" "$OUT/doomgeneric.raw.js" "$MOD/hooks/engine/doomgeneric.js"
echo "built $MOD/hooks/engine/doomgeneric.js from doomgeneric $COMMIT with $IMAGE ($OPT)"
