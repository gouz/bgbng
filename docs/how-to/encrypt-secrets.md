# Encrypt secrets

Goal: commit secret values in `bgbng.toml` so that only your team can read them.

Requires an ed25519 or RSA SSH key without passphrase (`~/.ssh/id_ed25519` or `~/.ssh/id_rsa`).

## Set up encryption once per repo

```sh
bgbng key init
git add .bgbng && git commit -m "bgbng: add encryption key"
```

This creates `.bgbng/recipients.txt` (your public key) and `.bgbng/key.enc`
(the data key, encrypted for those recipients). Both are safe to commit.

To use another public key than `~/.ssh/id_ed25519.pub`:

```sh
bgbng key init --pub ~/.ssh/work.pub
```

## Encrypt a value

Pipe the value in, so it stays out of your shell history:

```sh
pbpaste | bgbng encrypt
# enc:v1:3au6iZXaWRandtIY1P2Y...
```

Paste the output in `bgbng.toml`:

```toml
[env.".env"]
API_TOKEN = "enc:v1:3au6iZXaWRandtIY1P2Y..."
```

The plain value may contain template variables. They are filled in after decryption:

```sh
printf 'postgres://app:s3cret@localhost:{{ports.db}}/app' | bgbng encrypt
```

## Check the result

```sh
bgbng env
cat .env
```

## Use another key

To use another key than `~/.ssh/id_ed25519` or `~/.ssh/id_rsa`:

```sh
export BGBNG_IDENTITY=~/.ssh/work
```

If your usual key has a passphrase, create a dedicated one without, and give its public key
to `bgbng key init --pub` or `bgbng key add`:

```sh
ssh-keygen -t ed25519 -N "" -f ~/.ssh/bgbng
export BGBNG_IDENTITY=~/.ssh/bgbng
```

## Troubleshooting

- `your SSH key is not in .bgbng/recipients.txt`: your key is not in
  `.bgbng/recipients.txt`. Ask a teammate to [add you](team-access.md).
- `warning: .env is not gitignored`: add the file to `.gitignore`, it contains decrypted secrets.
