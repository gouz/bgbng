# bgbng

**bigbang**: run several copies of your dev environment side by side.

Each instance is a git worktree with its own ports and its own generated `.env` files.
Secrets live encrypted in the repo, readable by your team's SSH keys.

```sh
bgbng new feat-login     # worktree + ports + .env + setup
bgbng up feat-login      # start its processes
bgbng ls                 # what runs where
bgbng down -a            # stop everything
```

## Install

Requires git. Secrets need an ed25519 or RSA SSH key without passphrase.

With [Homebrew](https://brew.sh) (macOS, Linux):

```sh
brew install gouz/tools/bgbng
```

From source, with [Bun](https://bun.sh):

```sh
git clone git@github.com:gouz/bgbng.git && cd bgbng
bun install && bun link
```

Next: [your first parallel environments](tutorials/first-environments.md).

## License

MIT © gouz
