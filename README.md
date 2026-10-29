# bgbng

**bigband**: run several copies of your dev environment side by side.

Each instance is a git worktree with its own ports and its own generated `.env` files.
Secrets live encrypted in the repo, readable by your team's SSH keys.

```sh
bgbng new feat-login     # worktree + ports + .env + setup
bgbng up feat-login      # start its processes
bgbng ls                 # what runs where
bgbng down -a            # stop everything
```

## Install

Requires [Bun](https://bun.sh), git, and [age](https://age-encryption.org) for secrets (`brew install age`).

```sh
git clone git@github.com:gouz/bgbng.git && cd bgbng
bun install && bun link
```

## Documentation

The docs follow the [Diátaxis](https://diataxis.fr) framework:

- **Tutorial**: [Your first parallel environments](docs/tutorials/first-environments.md)
- **How-to guides**
  - [Encrypt secrets](docs/how-to/encrypt-secrets.md)
  - [Give or revoke access to a teammate](docs/how-to/team-access.md)
  - [Use Docker Compose](docs/how-to/docker-compose.md)
- **Reference**
  - [CLI](docs/reference/cli.md)
  - [`bgbng.toml`](docs/reference/config.md)
- **Explanation**: [How bgbng works](docs/explanation/how-it-works.md)

## License

MIT © gouz
