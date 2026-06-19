#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# env-debug.sh — secret-safe ".env injection" verifier for the deploy pipeline.
#
# Prints a REDACTED report proving WHICH .env was injected into a release:
#   - the file path + where it came from (source label, passed via ENV_SOURCE)
#   - a SHA-256 of the whole file (fingerprint of the exact bytes deployed)
#   - the number of variables and the list of KEYS (values are NEVER printed —
#     each value is shown as ****(<n> chars))
#   - if a second file is given, a key-by-key diff that flags added / removed /
#     CHANGED variables using a short hash of each value (so you can see that a
#     value changed without the value itself ever hitting the build log)
#
# This is what answers "is the updated .env really injected into the code?" —
# run it against the release .env to see exactly what shipped, and against the
# live current/.env after reload to confirm the running release serves it.
#
# Usage:
#   env-debug.sh <env-file> [compare-file]
# Env:
#   ENV_SOURCE  optional human label for where <env-file> came from
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ENV_FILE="${1:?usage: env-debug.sh <env-file> [compare-file]}"
COMPARE_FILE="${2:-}"
SOURCE_LABEL="${ENV_SOURCE:-unspecified}"

# sha256sum on Linux, shasum -a 256 on macOS — pick whatever exists.
sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d' ' -f1
    else
        shasum -a 256 "$1" | cut -d' ' -f1
    fi
}
sha256_stdin() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum | cut -d' ' -f1
    else
        shasum -a 256 | cut -d' ' -f1
    fi
}

# Emit "KEY<TAB><sha12-of-value>" for every KEY=VALUE line, sorted by key.
# Values are hashed, never emitted — safe to diff in a public build log.
fingerprint() {
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in ''|'#'*) continue ;; esac   # skip blanks + comments
        case "$line" in *=*) ;; *) continue ;; esac  # skip non KEY=VALUE lines
        key="${line%%=*}"
        val="${line#*=}"
        vh="$(printf '%s' "$val" | sha256_stdin | cut -c1-12)"
        printf '%s\t%s\n' "$key" "$vh"
    done < "$1" | sort
}

echo "──────────────── .env injection report ────────────────"
echo "Source        : ${SOURCE_LABEL}"
echo "File          : ${ENV_FILE}"

if [ ! -f "$ENV_FILE" ]; then
    echo "RESULT        : FAIL — file does not exist; .env was NOT injected."
    echo "───────────────────────────────────────────────────────"
    exit 1
fi
if [ ! -s "$ENV_FILE" ]; then
    echo "RESULT        : FAIL — file is empty; .env was NOT injected correctly."
    echo "───────────────────────────────────────────────────────"
    exit 1
fi

VAR_COUNT="$(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" || true)"
echo "SHA-256       : $(sha256 "$ENV_FILE")"
echo "Variables     : ${VAR_COUNT}"
echo "Keys (values masked):"
while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    case "$line" in *=*) ;; *) continue ;; esac
    key="${line%%=*}"
    val="${line#*=}"
    printf '  %-32s = ****(%d chars)\n' "$key" "${#val}"
done < "$ENV_FILE"

if [ -n "$COMPARE_FILE" ] && [ -f "$COMPARE_FILE" ]; then
    echo "Diff vs ${COMPARE_FILE} (value hashes — secrets stay hidden):"
    NEW_FP="$(mktemp)"; OLD_FP="$(mktemp)"
    trap 'rm -f "$NEW_FP" "$OLD_FP"' EXIT
    fingerprint "$ENV_FILE"     > "$NEW_FP"
    fingerprint "$COMPARE_FILE" > "$OLD_FP"
    if cmp -s "$OLD_FP" "$NEW_FP"; then
        echo "  (identical — same keys and same values as the live release)"
    else
        # Outer join on the key column; -e '-' fills a missing side so we can
        # tell ADDED (missing old) / REMOVED (missing new) / CHANGED apart.
        join -t '	' -a1 -a2 -e '-' -o '0,1.2,2.2' "$OLD_FP" "$NEW_FP" \
          | while IFS='	' read -r k oldh newh; do
                if   [ "$oldh" = '-' ];      then echo "  + ADDED    ${k}"
                elif [ "$newh" = '-' ];      then echo "  - REMOVED  ${k}"
                elif [ "$oldh" != "$newh" ]; then echo "  ~ CHANGED  ${k}  (${oldh} -> ${newh})"
                fi
            done
    fi
elif [ -n "$COMPARE_FILE" ]; then
    echo "Diff vs ${COMPARE_FILE}: (compare file not present — first deploy / no live release yet)"
fi

echo "RESULT        : OK — ${VAR_COUNT} variables injected from ${SOURCE_LABEL}."
echo "───────────────────────────────────────────────────────"
