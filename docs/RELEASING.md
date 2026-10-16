# Releasing

A release is a Git tag. The workflow `.github/workflows/release.yml` does the rest.

1. Pick the version (SemVer; `0.x` while things still change). Put it in `VERSION` and describe the changes in `CHANGELOG.md`. CI is green, and the [manual check](operating.html#release-check) is done.
2. Commit and merge that to the default branch.
3. Tag the commit and push the tag:
   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```
4. The workflow checks the tag equals `VERSION`, type-checks and tests the daemon, builds the amd64 image, starts it with `compose.yaml` and runs the same smoke test as CI (`.github/scripts/smoke.sh`: `/api/health` answers, the sandbox makes namespaces, the UI is sent compressed), builds the arm64 image and checks that `node:sqlite`, the daemon and pi are in it, and only if all of that passes builds both with provenance and an SBOM and pushes `ghcr.io/shyam1203/weilo-agents:0.1.0` (and `latest` for a version without a `-` suffix; the app and the sandbox both run it), and publishes a GitHub release with `weilo-agents-0.1.0.zip` (`compose.yaml`, the start and update scripts, `VERSION`, `README.md`, `SECURITY.md`). `update.cmd` and `update.sh` read the newest release from the GitHub API, so a release is all an update needs.

The first time, the package on ghcr.io is private: open it under the repository's Packages, Package settings, and make it public, or users cannot pull it.

A version with a suffix (`0.2.0-rc.1`) is published as a pre-release and does not become `latest`.

If the smoke test or the arm64 check fails, nothing is pushed or published: the workflow log ends with `docker compose logs`. Fix it, then delete the tag (`git push --delete origin v0.1.0`, `git tag -d v0.1.0`) and tag the fixed commit.

Every GitHub Action in the workflows is pinned to a commit SHA (the version is in a comment beside it); Dependabot proposes the updates, as it does for npm packages and the base image. It does not propose a new major of the `node` image or `@types/node`: the app runs on Node 22 LTS, and moving to the next one is a change made on purpose.

## Data folder

The data folder (`~/.weilo-agents`) has a data version in `weilo.json` (`daemon/migrate.mjs`). A change to the files that an older folder cannot read raises `DATA_VERSION` and adds a step to `STEPS` in the same release. An app that finds a newer data version than it knows stops with a message instead of touching the folder.
