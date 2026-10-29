# Give or revoke access to a teammate

Only someone who already has access can grant it.

## Give access

From their GitHub username (fetches `https://github.com/<user>.keys`):

```sh
bgbng key add @octocat
```

Or from a public key file or a public key line:

```sh
bgbng key add ./octocat.pub
bgbng key add "ssh-ed25519 AAAAC3Nza... octocat@laptop"
```

Then commit:

```sh
git add .bgbng && git commit -m "bgbng: give access to octocat"
```

Values in `bgbng.toml` don't change: only `.bgbng/key.age` is re-encrypted.

## Revoke access

1. Remove their lines from `.bgbng/recipients.txt`.
2. Rotate the data key. They have seen the old one, so this step is mandatory:

   ```sh
   bgbng key rotate
   git add bgbng.toml .bgbng && git commit -m "bgbng: revoke octocat"
   ```

3. Change the secrets themselves (passwords, tokens) if they must no longer use them.
   Rotation only protects future versions of the file: the old ones stay in git history.

> Rotate on your main branch. Other branches still hold values encrypted with the
> old key, so they need to merge or rebase before `bgbng env` works there.
