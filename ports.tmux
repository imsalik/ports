#!/usr/bin/env bash
# tmux plugin entrypoint for ports-tui.
# Sourced once at tmux startup (by TPM or directly via run-shell).

CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER="$CURRENT_DIR/bin/tmux-ports"

# User-tunable options (set in .tmux.conf):
#   set -g @ports-key "o"          # default key
#   set -g @ports-no-prefix "off"  # set "on" to bind without prefix
#   set -g @ports-popup-width "95%"
#   set -g @ports-popup-height "90%"
get_opt() {
  local val
  val=$(tmux show-option -gqv "$1")
  echo "${val:-$2}"
}

key=$(get_opt "@ports-key" "p")
no_prefix=$(get_opt "@ports-no-prefix" "off")
width=$(get_opt "@ports-popup-width" "95%")
height=$(get_opt "@ports-popup-height" "90%")

popup_cmd="display-popup -E -w '$width' -h '$height' -T ' ports ' '$LAUNCHER'"

if [[ "$no_prefix" == "on" ]]; then
  tmux bind-key -n "$key" "$popup_cmd"
else
  tmux bind-key "$key" "$popup_cmd"
fi
