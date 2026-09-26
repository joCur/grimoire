# Release: release-please, version tags, `:latest` only on releases

## Decision

A deploy is a deliberate event with a changelog. `main` is deployable by
definition but publishes nothing: images are created only on release.

- **Conventional Commits are mandatory;** they generate the changelog and the
  version bump. This includes the PR title, because the squash merge uses it
  as the commit subject.
- **release-please** keeps a release PR from the commits. Merging it, with PO
  approval like every PR, is the only release event: it creates the version
  tag, the GitHub release, the changelog and the image. Nothing is tagged or
  versioned by hand.
- **A release requires green CI** on the tagged commit; a missing run counts
  as failed. release-please itself is not gated.
- **The image is built from the tag** and published with the version tag and
  `:latest`, which means "last release", not "last merge". Deployments are
  recommended to pin a version.
- **CI builds the image to check it but never publishes;** the release
  workflow is the only writer to the registry.
- The PO pulls a version deliberately; rollback is an older version tag.
- Not included: multi-arch images and auto-deploy.

## Why

The PO wants to deploy a known good state deliberately before a session and
roll back trivially. A tag that moves on every merge prevents both, and a
push per merge would dilute what a release means; a version tag comes with a
changelog, a commit hash does not.

release-please stays ungated because the release PR must be maintained even
while `main` is red.

Building the image in CI surfaces a broken Dockerfile in review rather than
in the release run, where the tag already exists.

## Consequences

- CI checks, release publishes.
- The deploy steps are in [docs/DEPLOYMENT.md](../DEPLOYMENT.md).
