# Use Docker Compose

Goal: give each instance its own containers, volumes and ports.

## 1. Read ports from the environment

Compose reads the `.env` next to `compose.yml` for `${...}` interpolation.
Replace every hardcoded host port:

```yaml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_PASSWORD: app
    ports:
      - "${DB_PORT}:5432"   # not "5432:5432"
```

Remove any `container_name:`: two instances cannot share a container name.

## 2. Declare it in `bgbng.toml`

```toml
[ports]
db = 5432

[env.".env"]
DB_PORT = "{{ports.db}}"
DATABASE_URL = "postgres://postgres:app@localhost:{{ports.db}}/postgres"

[procs]
db = "docker compose up db"
```

Use `docker compose up` **without `-d`**: bgbng supervises the process, and
`bgbng down` stops the containers by sending it `SIGTERM`.

## 3. Run it

```sh
bgbng new feat-x && bgbng up feat-x
```

bgbng sets `COMPOSE_PROJECT_NAME=<repo>-<instance>` for worktree instances, so their
containers and volumes are separate. The main checkout keeps Compose's default
project name, so your existing volumes are still used.

Each new instance starts with empty volumes. Seed them in `setup`:

```toml
setup = ["bun install", "docker compose run --rm migrate"]
```

## Run Compose by hand in an instance

Pass the project name, or you will target other containers:

```sh
docker compose -p myrepo-feat-x ps
```

If containers are left behind after a crash, stop them the same way:

```sh
docker compose -p myrepo-feat-x down
```
