# ports

A small TUI for inspecting and killing whatever's listening on your local ports — tmux- and Docker-aware.

<img width="1797" height="919" alt="image" src="https://github.com/user-attachments/assets/223ca98a-f23b-4e10-b956-ed6ccae2f68d" />

## why

I run a lot of local servers, especially now that coding agents spin them up in parallel. I wanted a quick way to see what's bound to what port, where it's running (which tmux pane / which container), and kill it without leaving the terminal. This is that.

## install (tmux plugin)

```tmux
set -g @plugin 'imsalik/ports'
```

`prefix + I` to install via TPM. `prefix + p` opens the popup. Deps install themselves on first run.

### manual bind

```bash
git clone https://github.com/imsalik/ports ~/code/ports
```

```tmux
bind-key p display-popup -E -w 95% -h 90% '~/code/ports/bin/ports'
```

## install (standalone CLI)

```bash
git clone https://github.com/imsalik/ports.git ~/.local/share/ports
ln -s ~/.local/share/ports/bin/ports ~/.local/bin/ports
```

Make sure `~/.local/bin` is on your `$PATH` (most setups already have it). Then run `ports` from any shell. Deps install themselves on first run.

To update later: `git -C ~/.local/share/ports pull`.

### already have it via TPM?

Skip the clone — just symlink the TPM copy:

```bash
ln -s ~/.tmux/plugins/ports/bin/ports ~/.local/bin/ports
```

## keys

- `↑↓` / `jk` — navigate (mouse + wheel work too)
- `/` — fuzzy filter by port, pid, process, or container; `enter` keeps the filter, `esc` clears it
- `r` — refresh
- `enter` — go to the pane running the process (tmux or herdr)
- `x` / `X` — kill (SIGTERM / SIGKILL); on a docker port these become `docker stop` / `docker kill`
- `t` — theme picker; `↑↓` preview, `enter` applies and remembers, `esc` cancels
- `q` — quit

## options

```tmux
set -g @ports-key "p"
set -g @ports-no-prefix "off"
set -g @ports-popup-width "95%"
set -g @ports-popup-height "90%"
set -g @ports-theme "mustard"     # mustard | dracula | gruvbox | nord | catppuccin | mono
                                  # (in-app `t` picker overrides this and persists)
```

Standalone CLI: same theme via `PORTS_THEME=dracula ports`.

### icons

The process/container column and the details section headings use Nerd Font
glyphs (docker, python, node, postgres, …). They need a Nerd Font in your
terminal; unknown processes fall back to a `•` that renders anywhere. To turn
icons off entirely (no icon column), set `PORTS_ICONS=0` or add `"icons": false`
to the config below.

### theme persistence

The `t` picker writes your choice to `~/.config/ports/config.json`, so it sticks
across launches without tmux. Resolution order, highest priority first:
`PORTS_THEME` env → saved config → `@ports-theme` (tmux) → `mustard`. Override the
config path with `$PORTS_CONFIG`.

### herdr

Runs the same as under tmux. Bind it to a popup in `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+shift+p"
type = "popup"
command = "ports"
```

Pane resolution and `enter` (go to pane) work through the `herdr` CLI when running
inside a Herdr pane, so no tmux server is needed.

## requirements

Linux (reads `/proc`), [bun](https://bun.sh), `ss` (iproute2). Optional: `docker`; `tmux` (3.2+) or `herdr` for pane resolution and go-to.

## notes

System ports owned by other users show as `?` because `ss` won't reveal their PID without privilege — run with `sudo` if you need to manage them.

## license

MIT
