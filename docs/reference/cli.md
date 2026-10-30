# CLI reference

`[name]` is optional everywhere it appears in brackets. When it's omitted, bgbng uses
the instance whose worktree contains the current directory, or `main` (the main checkout).

## Instances

| Command | Description |
|---|---|
| `bgbng new <name> [-b <branch>]` | Create `.worktrees/<name>`, allocate a slot, write the `.env` files, run `setup`. Checks out `<branch>` (default: `<name>`), creating it from `HEAD` if it doesn't exist. `name`: lowercase letters, digits, `-`, `_`. `main` is reserved. |
| `bgbng env [name]` | Regenerate the `.env` files. |
| `bgbng up [name]` | Regenerate the `.env` files, then start every process of `[procs]` that isn't already running. When none was running, warns about ports already taken by another program. |
| `bgbng down [name]` | Stop the processes: `SIGTERM` to each process group, `SIGKILL` after 10 s. |
| `bgbng down -a` | Stop every instance. |
| `bgbng ls` | List instances with slot, branch, ports and process status. |
| `bgbng logs [name] [proc]` | `tail -f` the last 100 lines of a process's logs, or of all its processes. |
| `bgbng rm <name> [-f]` | Stop the instance, remove its worktree (`-f`: even with uncommitted changes) and free its slot. The branch is kept. |

## Secrets

| Command | Description |
|---|---|
| `bgbng encrypt [value]` | Print `enc:v1:...` for the value, read from stdin if not given. |
| `bgbng key init [--pub <file>]` | Create `.bgbng/recipients.txt` and `.bgbng/key.enc`. Default public key: `<identity>.pub`. |
| `bgbng key add <who>` | Add recipients and re-encrypt `.bgbng/key.enc`. `who`: `@github-user`, a `.pub` file, or a public key line. |
| `bgbng key rotate` | New data key: re-encrypts every `enc:v1:` value of `bgbng.toml` and `.bgbng/key.enc`. |

Secret commands act on the worktree that contains the current directory.

## Environment variables

| Variable | Description |
|---|---|
| `BGBNG_IDENTITY` | SSH private key used to decrypt. Default: `~/.ssh/id_ed25519`, then `~/.ssh/id_rsa`. |

## Variables passed to processes and `setup`

Your shell's environment, plus `COMPOSE_PROJECT_NAME=<repo>-<name>` for worktree instances.
bgbng doesn't load any `.env` itself: your tools read the generated files.

## Files

| Path | Committed | Content |
|---|---|---|
| `bgbng.toml` | yes | [Configuration](config.md) |
| `.bgbng/recipients.txt` | yes | SSH public keys allowed to decrypt |
| `.bgbng/key.enc` | yes | Data key, encrypted for each recipient |
| `.worktrees/<name>/` | no (added to `.git/info/exclude`) | Instance worktrees |
| `.git/bgbng/state.json` | no | Instances, slots, PIDs |
| `.git/bgbng/logs/<name>.<proc>.log` | no | Process output |
