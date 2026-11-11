#!/bin/sh
# Prints one JSON snapshot of the Command Code account's usage.
# The API key is read here so it never appears in the mod's JavaScript or argv.
auth="$HOME/.commandcode/auth.json"

# plutil prints its own errors on stdout, so only accept a token-shaped value.
valid_key() {
  case "$1" in
    "" | *[!A-Za-z0-9_-]*) return 1 ;;
  esac
  [ ${#1} -ge 10 ]
}

key=$(plutil -extract apiKey raw -o - "$auth" 2>/dev/null)
valid_key "$key" || key=$(sed -n 's/.*"apiKey"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$auth" 2>/dev/null | head -1)
valid_key "$key" || key=""

if [ -z "$key" ]; then
  printf '{"error":"not-authenticated"}\n'
  exit 0
fi

api="https://api.commandcode.ai"
get() {
  curl -sS --max-time 20 -H "Authorization: Bearer $key" \
    -H "Content-Type: application/json" "$api$1" 2>/dev/null
}

who=$(get "/alpha/whoami?limits=1")
org=$(printf '%s' "$who" | sed -n 's/.*"org"[[:space:]]*:[[:space:]]*{[^}]*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

query=""
[ -n "$org" ] && query="?orgId=$org"

credits=$(get "/alpha/billing/credits$query")
subscription=$(get "/alpha/billing/subscriptions$query")
summary=$(get "/alpha/usage/summary$query")

case "$who" in \{*) ;; *) who="null" ;; esac
case "$credits" in \{*) ;; *) credits="null" ;; esac
case "$subscription" in \{*) ;; *) subscription="null" ;; esac
case "$summary" in \{*) ;; *) summary="null" ;; esac

printf '{"whoami":%s,"credits":%s,"subscription":%s,"summary":%s}\n' \
  "$who" "$credits" "$subscription" "$summary"
