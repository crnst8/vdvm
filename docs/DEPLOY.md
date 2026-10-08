# Deployment

| Part | Where | Updated by |
|---|---|---|
| Web app | Cloudflare Pages project `drums` → [re20.one](https://re20.one) | `deploy` workflow, on push to `main` |
| Catalog and audio | Container on `vpsau3` → Cloudflare Tunnel → media.re20.one | `npm run deploy:sync`, from the machine with the sample archive |
| Container code | `vpsau3:/opt/drums/app`, a checkout of `main` | `deploy` workflow, on push to `main` |
| Plugin installers | `vpsau2:/var/www/vdvm-downloads` → dl.vdvm.crnst8.com | `downloads` workflow, on a `v*` tag |

## Release

1. Set `version` in `package.json` and run `npm install --package-lock-only`.
2. Add an entry to `CHANGELOG.md`.
3. Run `plugin/dev check`, commit, then `git tag vX.Y.Z` and `git push origin main vX.Y.Z`.

The push to `main` deploys the web app. The tag builds both installers on macOS and publishes them. The app shows the version under the logo.

## Web app and container

`.github/workflows/deploy.yml` runs `npm run check`, then:

- builds the app with `npm run build:pages` (catalog from `https://media.re20.one/`, set in `.env.pages`) and uploads `dist-pages/` with wrangler;
- connects to `vpsau3` with a key whose `authorized_keys` entry forces `deploy/remote-deploy.sh`, which resets the checkout to `origin/main` and rebuilds the container.

`vpsau3` has no public 80/443; the tunnel is the only way in. Its config lives in `/opt/drums/server.env` (mode 600; local copy `deploy/server.env`, not in git).

The catalog and audio are not in git. `npm run deploy:status` compares the local production build with the server; `npm run deploy:sync` uploads it. `vpsau3` must keep at least 15 GB free; `deploy/sync.sh` refuses an upload that would leave less than 16 GB.

Server state: `ssh vpsau3 /opt/drums/app/deploy/remote-deploy.sh status`.

## Plugin installers

`.github/workflows/downloads.yml` runs on a `v*` tag or by hand:

1. Checks that the tag matches `package.json`.
2. Downloads the published catalog from media.re20.one (`plugin/scripts/fetch-catalog.mjs`).
3. Runs `plugin/dev release` with it: universal build, core tests, host test, both installers. pluginval crashes on headless runners, so it runs locally (`plugin/dev check`) before tagging.
4. Uploads both installers to `vpsau2` and publishes them.

On `vpsau2` the CI key can only run `~/bin/vdvm-downloads` (`deploy/downloads.sh`). `publish` checks both hashes, points `latest/` at the new version, rewrites `SHA256SUMS`, and deletes every other version, so one version is on disk at a time.

| URL | File |
|---|---|
| `https://dl.vdvm.crnst8.com/latest/V.D.V.M-mac-with-samples.pkg` | bundled installer |
| `https://dl.vdvm.crnst8.com/latest/V.D.V.M-mac.pkg` | plugin only |
| `https://dl.vdvm.crnst8.com/SHA256SUMS` | hashes |

Server state: `ssh vpsau2 ~/bin/vdvm-downloads status`.

## Secrets

| Name | Holds | Set by |
|---|---|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Pages deploy token | by hand |
| `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`; variables `VPS_HOST`, `VPS_PORT`, `VPS_USER` | `vpsau3` deploy key | `deploy/bootstrap.sh` |
| `DL_SSH_KEY`, `DL_KNOWN_HOSTS`; variables `DL_HOST`, `DL_PORT`, `DL_USER` | `vpsau2` download key | `deploy/bootstrap-downloads.sh` |

Both bootstrap scripts are safe to rerun. To rotate a key, delete its secret and run the script again.
