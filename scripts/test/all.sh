#!/usr/bin/env bash
# Esegue typecheck + test root + shared + server e stampa un riepilogo. Idempotente, nessuna rete, non modifica il repository
# (scrive solo log temporanei). Esce con 0 solo se TUTTI i passi sono verdi.
#
# Uso:    scripts/test/all.sh
# Opzioni (variabili d'ambiente):
#   SKIP_TYPECHECK=1   salta tsc            SKIP_SERVER=1  salta i test del server
#   SHUFFLE=1          ordine casuale dei test (cerca dipendenze dall'ordine)
#   TEST_FAKE_NOW=ISO  sposta l'orologio dei test root/shared, es. 2027-01-01T00:00:10 (non per il server: i test con processi figli usano l'orologio vero)
#   COVERAGE=1         aggiunge la copertura ai test root (richiede @vitest/coverage-v8, vedi docs/TEST-REPORT.md)
set -u -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

LOGDIR="$(mktemp -d "${TMPDIR:-/tmp}/vp-tests.XXXXXX")"
trap 'rm -rf "$LOGDIR"' EXIT

VITEST_EXTRA=()
[ "${SHUFFLE:-0}" = "1" ] && VITEST_EXTRA+=(--sequence.shuffle)
ROOT_EXTRA=("${VITEST_EXTRA[@]+"${VITEST_EXTRA[@]}"}")
[ "${COVERAGE:-0}" = "1" ] && ROOT_EXTRA+=(--coverage)

NAMES=()
CODES=()
SECS=()
FAILED=0

# step <nome> <comando...>: esegue, registra esito e durata, mostra l'ultimo pezzo del log solo se fallisce
step() {
  local name="$1"; shift
  local log="$LOGDIR/${#NAMES[@]}.log"
  local t0 t1 code
  t0=$(date +%s)
  printf '>> %s ...\n' "$name"
  "$@" >"$log" 2>&1
  code=$?
  t1=$(date +%s)
  NAMES+=("$name"); CODES+=("$code"); SECS+=("$((t1 - t0))")
  if [ "$code" -ne 0 ]; then
    FAILED=1
    printf '   FALLITO (exit %s). Ultime righe:\n' "$code"
    tail -n 25 "$log" | sed 's/^/   | /'
  else
    printf '   ok (%ss)\n' "$((t1 - t0))"
  fi
  # una riga di sintesi dei test (se presente) per il riepilogo
  grep -E '^\s*Tests\s' "$log" | tail -n 1 | sed 's/^\s*/   /' || true
}

if [ "${SKIP_TYPECHECK:-0}" != "1" ]; then
  step "typecheck client+shared (tsc --noEmit)" npx --no-install tsc --noEmit
  step "typecheck server (tsc -p server --noEmit)" npx --no-install tsc -p server --noEmit
fi
step "test root (vitest run)" npx --no-install vitest run "${ROOT_EXTRA[@]+"${ROOT_EXTRA[@]}"}"
step "test shared (vitest -c shared/vitest.config.ts)" npx --no-install vitest run -c shared/vitest.config.ts "${VITEST_EXTRA[@]+"${VITEST_EXTRA[@]}"}"
if [ "${SKIP_SERVER:-0}" != "1" ]; then
  step "test server (cd server && vitest run)" bash -c 'cd server && npx --no-install vitest run "$@"' _ "${VITEST_EXTRA[@]+"${VITEST_EXTRA[@]}"}"
fi

printf '\n==== RIEPILOGO ====\n'
for i in "${!NAMES[@]}"; do
  if [ "${CODES[$i]}" -eq 0 ]; then mark="OK    "; else mark="ROSSO "; fi
  printf '%s %-52s %4ss\n' "$mark" "${NAMES[$i]}" "${SECS[$i]}"
done
if [ "$FAILED" -eq 0 ]; then echo "Tutto verde."; else echo "ATTENZIONE: almeno un passo è rosso (vedi sopra)."; fi
exit "$FAILED"
