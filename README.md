# ports

A small TUI for inspecting and killing whatever's listening on your local ports — tmux- and Docker-aware.

## why

I run a lot of local servers, especially now that coding agents spin them up in parallel. I wanted a quick way to see what's bound to what port, where it's running (which tmux pane / which container), and kill it without leaving the terminal. This is that.

## install

```tmux
set -g @plugin 'imsalik/ports'
```

`prefix + I` to install via TPM, then once:

```bash
cd ~/.tmux/plugins/ports/app && bun install
```

`prefix + p` opens the popup.

### manual

```bash
git clone https://github.com/imsalik/ports ~/code/ports
(cd ~/code/ports/app && bun install)
```

```tmux
bind-key p display-popup -E -w 95% -h 90% '~/code/ports/bin/tmux-ports'
```

## keys

- `↑↓` / `jk` — navigate (mouse + wheel work too)
- `r` — refresh
- `x` / `X` — kill (SIGTERM / SIGKILL); on a docker port these become `docker stop` / `docker kill`
- `q` — quit

## options

```tmux
set -g @ports-key "p"
set -g @ports-no-prefix "off"
set -g @ports-popup-width "95%"
set -g @ports-popup-height "90%"
```

## requirements

Linux (reads `/proc`), tmux 3.2+, [bun](https://bun.sh), `ss` (iproute2). Optional: `docker`, `tmux` for pane resolution.

## notes

System ports owned by other users show as `?` because `ss` won't reveal their PID without privilege — run with `sudo` if you need to manage them.

## license

MIT
