# Your first parallel environments

In this tutorial you will run three copies of a small web server at the same time,
each on its own port, each with its own `.env`. It takes about ten minutes.

You need Bun, git and bgbng installed (see the [README](../../README.md#install)).

## 1. Create a project

```sh
mkdir hello && cd hello && git init
```

Create `server.ts`:

```ts
Bun.serve({
  port: process.env.PORT,
  fetch: () => new Response(`Hello from ${process.env.INSTANCE}\n`),
});
console.log(`listening on ${process.env.PORT}`);
```

## 2. Describe the environment

Create `bgbng.toml` at the root of the repo:

```toml
[ports]
web = 3000

[env.".env"]
PORT = "{{ports.web}}"
INSTANCE = "{{name}}"

[procs]
web = "bun server.ts"
```

The generated `.env` must never be committed. Ignore it, then commit:

```sh
echo ".env" > .gitignore
git add -A && git commit -m "init"
```

## 3. Start the main checkout

```sh
bgbng up
```

You should see `main up: web=3000`. If bgbng warns that port 3000 is already in use,
another program holds it: set `web = 3100` in `bgbng.toml`, commit, and run `bgbng up` again.

Check it:

```sh
curl localhost:3000
# Hello from main
```

Notice that `.env` appeared in your repo, with `PORT=3000`.

## 4. Create two more instances

```sh
bgbng new alice
bgbng new bob
```

Each command created a worktree under `.worktrees/` and a branch of the same name.
Start them:

```sh
bgbng up alice
bgbng up bob
```

## 5. See them run

```sh
bgbng ls
```

```
NAME   SLOT  BRANCH  PORTS     PROCS
main   0     -       web:3000  web:up
alice  1     alice   web:3010  web:up
bob    2     bob     web:3020  web:up
```

```sh
curl localhost:3010
# Hello from alice
curl localhost:3020
# Hello from bob
```

Three copies of the same code, no port conflict. Look at the logs of one of them:

```sh
bgbng logs alice
```

Press `Ctrl+C` to stop following the logs. The server keeps running.

## 6. Clean up

```sh
bgbng down -a
bgbng rm alice
bgbng rm bob
```

The worktrees are gone. The `alice` and `bob` branches are kept.

## What's next

- Put secrets in `bgbng.toml`: [Encrypt secrets](../how-to/encrypt-secrets.md)
- Run a database per instance: [Use Docker Compose](../how-to/docker-compose.md)
- Every option: [`bgbng.toml` reference](../reference/config.md)
