#!/bin/bash
#
# Linux launcher for Screenshot Maker.  Run with:  ./launch.sh
# (macOS users can double-click "Launch Screenshot Maker.command" instead.)

cd "$(dirname "$0")" || exit 1

PORT=5173
URL="http://localhost:$PORT"

printf '\n'
printf '  Screenshot Maker\n'
printf '  ────────────────────────────────────────────\n'
printf '  Starting the local dev server…\n'
printf '\n'

fail() {
  printf '\n  %s\n\n' "$1"
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  printf '  Node.js is not installed.\n'
  printf '  Install it from https://nodejs.org/en/download or your package manager\n'
  printf '  (e.g. sudo apt install nodejs npm), then run this script again.\n'
  fail 'Nothing was started.'
fi

if ! command -v npm >/dev/null 2>&1; then
  fail 'Node.js is installed but npm is missing. Install npm and try again.'
fi

printf '  Node %s\n' "$(node --version)"

if [ ! -d node_modules ]; then
  printf '  First run — installing dependencies. This takes a minute…\n\n'
  npm install || fail 'npm install failed. Scroll up for the reason.'
  printf '\n'
fi

npm run dev &
SERVER_PID=$!

cleanup() {
  printf '\n  Stopping the server…\n'
  kill "$SERVER_PID" 2>/dev/null
  wait "$SERVER_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# Poll for a real response instead of sleeping a fixed amount — startup time varies.
printf '\n  Waiting for %s …\n' "$URL"
ATTEMPTS=0
MAX_ATTEMPTS=60   # 60 × 0.5s = 30 seconds
until curl --silent --output /dev/null --max-time 2 "$URL"; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    fail 'The dev server stopped before it finished starting. Scroll up for the error.'
  fi
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
    kill "$SERVER_PID" 2>/dev/null
    printf '  The server did not answer on port %s within 30 seconds.\n' "$PORT"
    printf '  Something else may already be using that port.\n'
    fail 'Giving up.'
  fi
  sleep 0.5
done

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
else
  printf '  Could not find xdg-open — open %s manually.\n' "$URL"
fi

printf '\n'
printf '  ────────────────────────────────────────────\n'
printf '  Screenshot Maker is running at %s\n' "$URL"
printf '\n'
printf '  Projects you save land in the "projects" folder\n'
printf '  next to this script, as .smproj.json files.\n'
printf '\n'
printf '  Press Ctrl+C to stop the server.\n'
printf '  ────────────────────────────────────────────\n'
printf '\n'

wait "$SERVER_PID"
