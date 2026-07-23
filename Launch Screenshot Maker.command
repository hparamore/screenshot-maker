#!/bin/bash
#
# Double-click this file in Finder to start Screenshot Maker.
# Finder launches .command files with an arbitrary working directory, so step one is
# always to move into the folder the script itself lives in.

cd "$(dirname "$0")" || exit 1

PORT=5173
URL="http://localhost:$PORT"

printf '\n'
printf '  Screenshot Maker\n'
printf '  ────────────────────────────────────────────\n'
printf '  Starting the local dev server…\n'
printf '\n'

# Keep the window alive on failure so the message is readable before Terminal closes it.
fail() {
  printf '\n  %s\n\n' "$1"
  printf '  Press Return to close this window.\n'
  read -r _
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  printf '  Node.js is not installed.\n'
  printf '\n'
  printf '  Download the LTS installer, run it, then double-click this file again:\n'
  printf '      https://nodejs.org/en/download\n'
  fail 'Nothing was started.'
fi

if ! command -v npm >/dev/null 2>&1; then
  printf '  Node.js is installed but npm is missing.\n'
  printf '  Reinstalling Node.js from https://nodejs.org/en/download usually fixes this.\n'
  fail 'Nothing was started.'
fi

printf '  Node %s\n' "$(node --version)"

if [ ! -d node_modules ]; then
  printf '  First run — installing dependencies. This takes a minute…\n\n'
  npm install || fail 'npm install failed. Scroll up for the reason.'
  printf '\n'
fi

# Start Vite in the background so this script can wait for the port and open the browser,
# then hand the terminal back to Vite's log output.
npm run dev &
SERVER_PID=$!

# Ctrl+C (or closing the window) should take the server with it.
cleanup() {
  printf '\n  Stopping the server…\n'
  kill "$SERVER_PID" 2>/dev/null
  wait "$SERVER_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# Poll rather than sleep-and-hope: a cold npm cache or a slow disk can push startup well
# past any fixed delay, and opening the browser early just shows a connection error.
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

open "$URL"

printf '\n'
printf '  ────────────────────────────────────────────\n'
printf '  Screenshot Maker is running at %s\n' "$URL"
printf '\n'
printf '  Projects you save land in the "projects" folder\n'
printf '  next to this script, as .smproj.json files.\n'
printf '\n'
printf '  Closing this window — or pressing Ctrl+C — stops\n'
printf '  the server. The browser tab will stop working then.\n'
printf '  ────────────────────────────────────────────\n'
printf '\n'

wait "$SERVER_PID"
