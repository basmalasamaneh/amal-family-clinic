#!/usr/bin/env bash
# Run from workspace root. Requires installed Orca, speechd, dbus and Xvfb.
# Fresh private profile/display/bus; retain only announcement excerpts and step names.
set -euo pipefail
umask 077
if [[ "${1:-}" != "--inside-session" ]]; then
  export SR_DIRECT_ATSPI="${SR_DIRECT_ATSPI:-0}"
  if [[ "${1:-}" == "--direct-atspi" ]]; then export SR_DIRECT_ATSPI=1; fi
  export SR_WORK="$(mktemp -d /tmp/amal-orca-audit.XXXXXX)"
  export SR_EVIDENCE="${SR_EVIDENCE:-$PWD/docs/testing/screen-reader-evidence}"
  mkdir -p "$SR_EVIDENCE"
  # cp from the Nix store can preserve read-only directory permissions.
  trap 'chmod -R u+w "$SR_WORK" 2>/dev/null || true; rm -rf "$SR_WORK"' EXIT
  export XDG_RUNTIME_DIR="$SR_WORK/runtime"
  export XDG_CONFIG_HOME="$SR_WORK/config"
  export XDG_CACHE_HOME="$SR_WORK/cache"
  mkdir -p "$XDG_RUNTIME_DIR" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"
  # Explicitly expose matching AT-SPI service definitions in the private session.
  export SR_ATSPI="$(find /nix/store -maxdepth 1 -name '*-at-spi2-core-2.56.2' -print -quit)"
  test -n "$SR_ATSPI"
  export XDG_DATA_DIRS="$SR_ATSPI/share:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
  SR_DBUS_ROOT="$(dirname "$(dirname "$(command -v dbus-run-session)")")"
  timeout 240 dbus-run-session --config-file="$SR_DBUS_ROOT/share/dbus-1/session.conf" -- bash "$0" --inside-session
  exit
fi
cleanup() {
  for pid in "${ORCA_PID:-}" "${SPEECH_PID:-}" "${REGISTRY_PID:-}" "${BUS_PID:-}" "${XVFB_PID:-}"; do
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  done
}
trap cleanup EXIT
Xvfb -displayfd 3 -screen 0 1280x900x24 -nolisten tcp 3>"$SR_WORK/display" >"$SR_WORK/xvfb.log" 2>&1 &
XVFB_PID=$!
for i in {1..50}; do [[ -s "$SR_WORK/display" ]] && break; sleep .1; done
export DISPLAY=":$(cat "$SR_WORK/display")"
export NO_AT_BRIDGE=0 GTK_MODULES=atk-bridge ACCESSIBILITY_ENABLED=1
if [[ "${SR_DIRECT_ATSPI:-0}" == 1 ]]; then
  # Explicitly authorized alternative: bypass the Nix launcher with its missing
  # compiled daemon path. libatspi statically contains AT_SPI_BUS_ADDRESS support.
  dbus-daemon --nofork --config-file="$SR_ATSPI/share/defaults/at-spi2/accessibility.conf" \
    --print-address=3 3>"$SR_WORK/direct-bus-address" >"$SR_WORK/atspi.log" 2>&1 &
  BUS_PID=$!
  for i in {1..50}; do [[ -s "$SR_WORK/direct-bus-address" ]] && break; sleep .1; done
  export AT_SPI_BUS_ADDRESS="$(head -1 "$SR_WORK/direct-bus-address")"
  test -n "$AT_SPI_BUS_ADDRESS"
  "$SR_ATSPI/libexec/at-spi2-registryd" >"$SR_WORK/registry.log" 2>&1 &
  REGISTRY_PID=$!
  sleep 2
  if ! dbus-send --bus="$AT_SPI_BUS_ADDRESS" --print-reply \
      --dest=org.a11y.atspi.Registry /org/a11y/atspi/registry \
      org.freedesktop.DBus.Peer.Ping >"$SR_WORK/registry-ping" 2>"$SR_WORK/bus-error"; then
    {
      printf 'BLOCKED: direct private AT-SPI registry did not respond.\n'
      cat "$SR_WORK/bus-error"
      printf 'No screen-reader announcement observations obtained.\n'
    } >"$SR_EVIDENCE/environment.txt"
    cat "$SR_EVIDENCE/environment.txt"
    exit 1
  fi
else
"$SR_ATSPI/libexec/at-spi-bus-launcher" --launch-immediately >"$SR_WORK/atspi.log" 2>&1 &
BUS_PID=$!
sleep 2
if ! dbus-send --session --print-reply --dest=org.a11y.Bus /org/a11y/bus org.a11y.Bus.GetAddress \
    >"$SR_WORK/bus-address" 2>"$SR_WORK/bus-error"; then
  {
    printf 'BLOCKED before browser/Orca launch: AT-SPI bus could not start.\n'
    cat "$SR_WORK/bus-error"
    printf 'No screen-reader announcements or AT-SPI event observations obtained.\n'
  } >"$SR_EVIDENCE/environment.txt"
  cat "$SR_EVIDENCE/environment.txt"
  exit 1
fi
export AT_SPI_BUS_ADDRESS="$(sed -n 's/.*string "\(.*\)"/\1/p' "$SR_WORK/bus-address")"
test -n "$AT_SPI_BUS_ADDRESS"
fi
mkdir -p "$SR_WORK/speech-config" "$SR_WORK/speech-logs" "$SR_WORK/orca-prefs"
SR_SPEECH_ROOT="$(dirname "$(dirname "$(command -v speech-dispatcher)")")"
cp -r "$SR_SPEECH_ROOT/etc/speech-dispatcher/modules" "$SR_WORK/speech-config/modules"
printf '%s\n' 'LogLevel 1' 'AudioOutputMethod "pulse"' \
  'AddModule "espeak-ng" "sd_espeak-ng" "espeak-ng.conf"' \
  'DefaultModule espeak-ng' >"$SR_WORK/speech-config/speechd.conf"
speech-dispatcher --run-single --config-dir "$SR_WORK/speech-config" \
  --socket-path "$SR_WORK/speech.sock" --log-dir "$SR_WORK/speech-logs" \
  >"$SR_WORK/speech.log" 2>&1 &
SPEECH_PID=$!
export SPEECHD_ADDRESS="unix_socket:$SR_WORK/speech.sock"
sleep 2
orca --user-prefs "$SR_WORK/orca-prefs" --enable speech --disable braille \
  --debug-file "$SR_WORK/orca.debug" >"$SR_WORK/orca.log" 2>&1 &
ORCA_PID=$!
sleep 5
export SR_STEPS="$SR_EVIDENCE/steps.jsonl"
: >"$SR_STEPS"
set +e
node "${SR_DRIVER:-scripts/src/screen-reader-audit.mjs}" >"$SR_WORK/driver.log" 2>&1
result=$?
set -e
sleep 2
kill "$ORCA_PID" 2>/dev/null || true
sleep 1
# No raw Orca/application/network logs leave the private temporary directory.
grep -a 'SPEECH OUTPUT:' "$SR_WORK/orca.debug" >"$SR_EVIDENCE/announcements.txt" || true
{
  printf 'driver_exit=%s\n' "$result"
  printf 'direct_atspi_bus=%s\n' "${SR_DIRECT_ATSPI:-0}"
  printf 'orca_version='; orca --version
  printf 'speech_dispatcher_version='; speech-dispatcher --version
  printf 'speech_output_lines='; grep -ac 'SPEECH OUTPUT:' "$SR_WORK/orca.debug" || true
  printf 'atspi_focus_event_lines='; grep -acE 'OBJECT EVENT:.*(focused|focus:)|object:state-changed:focused|focus:' "$SR_WORK/orca.debug" || true
  printf 'chromium_script_event_lines='; grep -acE 'CHROMIUM|Chromium|chromium' "$SR_WORK/orca.debug" || true
  printf '\nSpeech startup errors (infrastructure only):\n'
  grep -aiE 'error|failed|refused|traceback|exception|not found|connection' "$SR_WORK/speech.log" "$SR_WORK/orca.log" | head -30 || true
  if [[ "$result" != 0 ]]; then
    printf '\nDriver failure (contains no credentials or API bodies):\n'
    tail -18 "$SR_WORK/driver.log"
  fi
} >"$SR_EVIDENCE/environment.txt"
printf 'Sanitized evidence: %s\n' "$SR_EVIDENCE"
cat "$SR_EVIDENCE/environment.txt"
exit "$result"
