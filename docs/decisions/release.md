# Release: release-please, version tags, `:latest` only on releases

## Decision

A deploy is a deliberate event with a changelog. `main` is deployable by
definition but publishes nothing: images are created only on release.

- **Conventional Commits are mandatory;** they generate the changelog:
  `feat:` (minor), `fix:` (patch), `docs:`/`chore:`/`refactor:`/`test:`/`ci:`
  (no bump); a breaking change is `feat!:` or a `BREAKING CHANGE:` footer.
  This also applies to the PR title, because the squash merge takes it as the
  commit subject.
- **release-please** (`googleapis/release-please-action@v4` in
  `.github/workflows/release.yml`) runs on every push to `main` and keeps a
  release PR from the commits. The configuration lives in the root
  (`release-please-config.json`, `.release-please-manifest.json`): one package
  `"."`, `release-type: node`, `include-component-in-tag: false` and an
  **empty `package-name`** — not an empty `component`; otherwise the component
  silently falls back to the package name, the merged release PR is not
  tagged, and every following release is blocked. The version lives in the
  root `package.json` and is copied into the workspace manifests via
  `extra-files`.
- **Merging the release PR** (with PO approval like every PR) is the only
  release event: tag `vX.Y.Z`, GitHub release, `CHANGELOG.md` and the image.
  Nothing is ever tagged manually, and `CHANGELOG.md` and
  `.release-please-manifest.json` are never edited by hand.
- **CI gate:** `require-green-ci` resolves the tag to its commit, looks up
  that commit's `ci` push run and waits with `gh run watch --exit-status`. A
  missing run is not a passed run — then nothing is published.
  release-please itself is not gated.
- **`publish-image`** builds with a checkout **at the tag** (not at the branch
  head) and pushes `ghcr.io/jocur/grimoire` with the version tag and
  `:latest`. `:latest` means "last release", not "last merge". The compose
  file references `${GRIMOIRE_VERSION:-latest}`; a pinned version is
  recommended.
- **The build id** `GRIMOIRE_BUILD` is burned into the release image as the
  tag — the same value in bundle and server, so that the reload banner appears
  only on a real version change (`decisions/polling`).
- The PO pulls a version tag themselves; rollback is an older version tag.
- Not included: multi-arch (`linux/amd64` suffices) and auto-deploy.

### CI builds for checking, never publishes

**The release workflow is the only writer to the GHCR registry;**
`.github/workflows/ci.yml` pushes no image. It does have an `image-build` job
(`docker/build-push-action` with `push: false`, without registry login and
without `packages: write` — it cannot publish). It runs on PRs and main
pushes, depends only on `test` and uses the same GHA cache as the release
build. There, `GRIMOIRE_BUILD` gets the commit SHA as a throwaway value.

## Why

The PO wants to deploy a known good state deliberately before a session and
roll back trivially if there is a problem. A tag that mutates under running
operation on every merge prevents both. A SHA push on every merge would keep
the package permanently "just updated" and dilute the release semantics; a
version tag comes with a changelog, a SHA does not.

release-please stays ungated because the release PR must be maintained even
when `main` is red: it is the tool with which the state is read and repaired.

The check build in CI makes an error in the Dockerfile surface in review and
not only in the release run, where the tag already exists; the release build
additionally finds the cache warm. A few runner minutes per PR are cheaper
than a patch release that only repairs a broken image.

## Consequences

- CI checks, release publishes.
- The deploy steps are in [docs/DEPLOYMENT.md](../DEPLOYMENT.md).
