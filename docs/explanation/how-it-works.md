# How bgbng works

## Why worktrees

Running two branches at once usually means two clones: double the disk, double the
fetches, and branches that don't see each other. A git worktree is a second working
directory attached to the same repository. Commits, branches and stashes are shared,
only the checked-out files differ.

bgbng keeps worktrees inside the repo, in `.worktrees/`, so they are easy to find and
open in an editor. That folder is added to `.git/info/exclude` rather than `.gitignore`:
it's a local detail, nothing to commit.

What a worktree doesn't have is everything git ignores: `node_modules`, build output and
`.env` files. That gap is what bgbng fills, with `setup` for dependencies and `[env]`
for configuration.

## Where state lives

Every worktree shares the main repository's `.git` directory (the *common dir*).
bgbng keeps its state in `.git/bgbng/`: the list of instances, their slots, the PIDs of
their processes, their logs. Any bgbng command, run from any worktree, sees the same state,
and no file outside the repo is involved. Delete the repo and nothing is left behind.

## Slots instead of random ports

A process needs its port before it starts, and its neighbours need to know it too
(`API_URL` points to the API's port). Random free ports would change on every start
and break bookmarks, OAuth callbacks and muscle memory.

So each instance gets a **slot**, a small integer, and every port is
`base + slot * step`. The main checkout is slot 0 and keeps the ports you are used to.
An instance keeps its slot until `bgbng rm`, so `feat-x` is on 3010 today and tomorrow.

When allocating, bgbng skips slots used by other instances, and slots where something
already answers on one of the ports (another project, a forgotten server). It checks by
connecting to `127.0.0.1` and `::1`: a test `listen()` would miss services bound to
`127.0.0.1` only on macOS. A service listening only on a LAN address isn't detected.

The scheme only works if your apps read their ports from the environment. A hardcoded
`port: 3000` in a config file defeats it: that's the main thing to fix when adopting bgbng.

## Processes and process groups

`bgbng up` starts each process detached from the terminal, in its own **process group**,
with its output appended to a log file. Commands like `bun run dev` spawn children
(a bundler, a watcher). Killing only the parent would leave those running and holding
the port. `bgbng down` signals the whole group: `SIGTERM` first, `SIGKILL` 10 seconds later
if needed, which leaves Docker Compose time to stop its containers.

A process is shown as `up` if its group still exists. After a reboot, a PID may have been
reused by an unrelated process. Run `bgbng down` to clear stale entries.

## Why bgbng doesn't load `.env` itself

Bun loads the `.env` of the current directory automatically. If bgbng let it happen, running
`bgbng up feat-x` from the main checkout would pass main's `PORT` to feat-x's processes,
and since real environment variables win over `.env` files, feat-x would try main's port.
bgbng runs with `--no-env-file` and lets each tool read its own generated files.

## Secrets: envelope encryption with SSH keys

Values are encrypted with AES-256-GCM using a random 32-byte **data key**. Each value gets
its own random IV, and GCM detects tampering. The data key itself is encrypted with
[age](https://age-encryption.org) for every SSH public key in `.bgbng/recipients.txt`.
age accepts SSH ed25519 and RSA keys natively, so developers reuse the key they already
have on GitHub.

Two layers make team changes cheap:

- **Adding someone** re-encrypts only the data key for the new recipient list.
  No value changes, so diffs stay small and merges painless.
- **Removing someone** requires a new data key (`bgbng key rotate`), because they have
  seen the old one. All values are re-encrypted.

### What it protects, and what it doesn't

- Protected: secrets at rest in the repo, on GitHub, in forks and CI logs of people
  who aren't recipients.
- Not protected: secrets in git history from someone who was once a recipient.
  Rotation protects only what comes next; change the secrets themselves when it matters.
- Not protected: generated `.env` files on a developer's disk. bgbng warns when one isn't
  gitignored.
- Not covered: who wrote a value. Use signed commits (git supports SSH signing) if you need it.

### The key cache

age can't use `ssh-agent`, so a passphrase-protected key would prompt on every `bgbng up`.
After the first decryption, bgbng caches the data key in `.git/bgbng/key-<hash>` (mode 600),
named after the content of `key.age`: after a rotation, the cache naturally misses and
you decrypt once more.
