# Release Workflows

> GitHub Actions and release asset guidelines for the root `web2gem` package.

---

## Workflow Layout

- `.github/workflows/quality-gates.yml` runs pull request, `dev`, and `main` quality checks.
- `.github/workflows/release-artifacts.yml` builds GitHub Release assets and publishes the GHCR image for a release tag.
- `.github/workflows/reusable-versioned-release.yml` owns shared version calculation, package version update, release gates, commit, tag push, and release revision output.
- `.github/workflows/release-dockerhub.yml` calls the reusable versioned release workflow, then publishes Docker Hub images.
- `.github/workflows/release.yml` calls the reusable versioned release workflow, then publishes Aliyun Container Registry images.

Keep workflow names stable unless the GitHub Actions UI and README are updated together.

---

## Release Asset Contract

GitHub Releases must expose only these build artifacts plus checksum metadata:

- `worker.js`
- `web2gem_<tag>_docker_linux_amd64.tar.gz`
- `web2gem_<tag>_docker_linux_arm64.tar.gz`
- `sha256sums.txt`

Do not add bundle tarballs for `worker.js`; the raw `worker.js` asset is the Cloudflare Worker deployment artifact. Docker image archives must be split by platform and named with the `web2gem_<tag>_docker_linux_<arch>.tar.gz` pattern.

Before uploading assets, the release workflow should verify that every expected file exists and is non-empty. The upload list should stay explicit instead of relying on broad globs that can include stale artifacts.

---

## Docker Image Publishing

Docker images are named `web2gem` and are tagged with:

- the release tag, for example `v1.1.1`
- the bare package version, for example `1.1.1`
- `latest`

Docker archive assets should load into a readable local image tag, at minimum `web2gem:<tag>`. Registry images should include OCI labels for the package version and the actual release commit revision.

---

## Versioned Release Safety

Only one version-bumping registry release workflow should run at a time. Use a shared concurrency group for workflows that update `package.json`, create tags, or push version commits.

Before running expensive release gates, validate that the target tag does not already exist. If a workflow creates a version commit before publishing Docker images, capture `git rev-parse HEAD` after the commit and use that SHA for image revision labels.

Registry-specific release workflows should not duplicate the version bump / tag logic. Call `.github/workflows/reusable-versioned-release.yml` and consume its outputs:

- `new_version`
- `new_tag`
- `revision_sha`

Registry publish jobs should check out `revision_sha` before building Docker images so image labels and contents match the version commit.

## Scenario: Manual Versioned Release Source

### 1. Scope / Trigger

Use this contract for any `workflow_dispatch` workflow that can update package versions, create tags, or push commits to `main`.

### 2. Signatures

- `github.ref` / `GITHUB_REF` identifies the branch or tag selected for the manual workflow run.
- `.github/workflows/reusable-versioned-release.yml` is the only workflow allowed to create the version commit and tag.
- The release checkout explicitly uses `ref: main` with `fetch-depth: 0`.

### 3. Contracts

- A versioned release must fail unless `github.ref === "refs/heads/main"`.
- Validate the source ref before checkout, dependency installation, version mutation, quality gates, tag creation, or pushes.
- Pin the checkout to `main` independently of the guard; do not rely on the workflow UI's selected ref as the release source.
- Registry-specific callers consume the reusable workflow outputs and must not push their own version commits or tags.

### 4. Validation & Error Matrix

- `refs/heads/main` -> continue to explicit `main` checkout.
- Any feature branch -> fail with a clear source-ref error before dependency installation.
- Tag ref -> fail before version calculation or mutation.
- Missing or unexpected ref -> fail closed.

### 5. Good/Base/Bad Cases

- Good: validate `GITHUB_REF`, then use `actions/checkout` with `ref: main`.
- Base: an operator selects `main` in the manual workflow UI and the release proceeds normally.
- Bad: check out the selected ref implicitly and later run `git push origin HEAD:main`.

### 6. Tests Required

- Assert the source guard appears before checkout and dependency installation.
- Assert the guard accepts only `refs/heads/main`.
- Assert the checkout contains `ref: main` and `fetch-depth: 0`.
- Keep the canonical release-gate assertions for the reusable workflow.

### 7. Wrong vs Correct

#### Wrong

```yaml
- uses: actions/checkout@v5
  with:
    fetch-depth: 0
```

#### Correct

```yaml
- name: Validate release source
  env:
    RELEASE_REF: ${{ github.ref }}
  run: test "${RELEASE_REF}" = "refs/heads/main"

- uses: actions/checkout@v5
  with:
    ref: main
    fetch-depth: 0
```

---

## Deterministic Quality Gates

- Generated-artifact consumers must select the artifact produced by their own build phase. Benchmarks default to `dist/worker.test.js`; coverage subprocesses use `BENCH_TEST_BUNDLE=dist-coverage/worker.test.js`.
- `pnpm check:bench` runs only the deterministic budget matrix and fails on missing, non-finite, or over-budget medians. Tune budgets only with repeated baseline evidence; do not hide regressions by gating the full noisy benchmark suite.
- `pnpm check:size` measures the production Worker bundle against the configured byte budget.
- `pnpm worker:types` generates `worker-configuration.d.ts` from `wrangler.jsonc` and `.dev.vars.example`; `pnpm check:worker-types` must reproduce it byte-for-byte.
- `WorkerBindings` contains only portable runtime vars and secret names. This edition has no database binding or persisted-account configuration.
- Worker type generation builds the main module first, uses `--include-runtime false` and `--strict-vars false`, and leaves runtime value validation to `getConfig`.

Run benchmark, bundle-size, Worker-type freshness, coverage, and smoke gates after changing generated sources, performance-sensitive code, or release scripts.

---

## Validation

For workflow changes, run:

```sh
git diff --check
pnpm typecheck
pnpm docker:smoke
```

Run broader checks such as `pnpm coverage:ci` and `pnpm smoke` when release gates, build scripts, Docker runtime behavior, or generated bundle behavior change.
