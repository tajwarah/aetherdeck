# Sourced by the other scripts.
# SRC is this folder's parent (in git): branding, the Room, configs. WORK holds the Firefox source, its build and Mozilla's
# toolchains, about 40 GB, so it can live on another drive: set AETHERDECK_WORK (default: browser/work, ignored by git).
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${AETHERDECK_WORK:-$SRC/work}"
ENGINE="$WORK/engine"
export MOZBUILD_STATE_PATH="$WORK/mozbuild"
export MOZCONFIG="${MOZCONFIG:-$SRC/configs/mozconfig.full}"
# Mach needs Python 3.10 or newer; the system Python on macOS is 3.9. Install one with: uv python install 3.13
PY="$(uv python find 3.13)"
VERSION="$(cat "$SRC/firefox.version")"
# Rust from Homebrew's rustup (keg-only, so its shims are not on PATH by default); Firefox 159 wants Rust 1.90 or newer.
[ -d /opt/homebrew/opt/rustup/bin ] && export PATH="/opt/homebrew/opt/rustup/bin:$PATH"
