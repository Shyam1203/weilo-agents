# Releasing

A release is a Git tag. The workflow `.github/workflows/release.yml` does the rest.

1. Pick the version (SemVer; `0.x` while things still change). Put it in `VERSION` and describe the changes in `CHANGELOG.md`.
2. Commit and merge that to the default branch.
3. Tag the commit and push the tag:
   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```
4. The workflow checks the tag equals `VERSION`, builds the image for amd64 and arm64, pushes `ghcr.io/shyam1203/weilo-agents:0.1.0` (and `latest` for a version without a `-` suffix), and publishes a GitHub release with `weilo-agents-0.1.0.zip` (`compose.yaml`, the start scripts, `VERSION`, `README.md`).

The first time, the package on ghcr.io is private: open it under the repository's Packages, Package settings, and make it public, or users cannot pull it.

A version with a suffix (`0.2.0-rc.1`) is published as a pre-release and does not become `latest`.

## Data folder

The data folder (`~/.weilo-agents`) has a data version in `weilo.json` (`daemon/migrate.mjs`). A change to the files that an older folder cannot read raises `DATA_VERSION` and adds a step to `STEPS` in the same release. An app that finds a newer data version than it knows stops with a message instead of touching the folder.
