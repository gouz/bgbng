# `bgbng.toml` reference

Lives at the root of the repo. Each instance reads the copy from its own worktree,
so the file must be committed on the branch you create an instance from.

```toml
step = 10                         # optional, default 10
setup = ["bun install"]           # optional

[ports]
web = 3000
api = 4000

[env.".env"]
PORT = "{{ports.web}}"
API_URL = "http://localhost:{{ports.api}}"
SECRET = "enc:v1:..."

[env."apps/api/.env"]
PORT = "{{ports.api}}"

[procs]
web = "bun run dev"
api = "bun run --cwd apps/api dev"
```

## `step`

Integer. Gap between the ports of two consecutive slots: a port in slot `n` is
`base + n * step`. Space your base ports far enough apart that the shifted ports
never meet: with `web = 3000`, `admin = 3005` and `step = 5`, `web` of slot 1 is
`admin` of slot 0. Bases 1000 apart (3000, 4000, 5000) are the simplest.

## `setup`

Array of shell commands, run in order in the new worktree by `bgbng new`, after
the `.env` files are written. A failing command stops `new`; the instance is kept.

## `[ports]`

Table of `name = base port`. The main checkout (slot 0) uses the base ports.

## `[env."<path>"]`

One table per file to generate, `<path>` relative to the worktree root.
Missing directories are created. The file is overwritten on every `env`, `up` and `new`.

Values are strings (numbers and booleans are converted). In each value:

| Template | Value |
|---|---|
| `{{ports.<name>}}` | Port of this instance |
| `{{name}}` | Instance name (`main` for the main checkout) |
| `{{slot}}` | Slot number |

An unknown template variable is an error.

A value starting with `enc:v1:` is decrypted first, then templated.
See [Encrypt secrets](../how-to/encrypt-secrets.md).

Values made only of letters, digits and `_ . : / @ + , -` are written as is,
others are written double-quoted with JSON escaping.

## `[procs]`

Table of `name = shell command`, run with `sh -c` from the worktree root by `bgbng up`.
Commands must stay in the foreground: `docker compose up`, not `docker compose up -d`.
