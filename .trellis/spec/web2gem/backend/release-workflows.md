# Release Workflows

> GitHub Actions and release asset guidelines for the root `web2gem` package.

---

## Workflow Layout

- `.github/workflows/quality-gates.yml` runs pull request, `dev`, and `main` quality checks.
- `.github/workflows/release-main.yml` is the manual dispatcher for the `main` edition.
- `.github/workflows/release-account-pool.yml` is the manual dispatcher for the `gemini-account-pool` edition.
- `.github/workflows/reusable-versioned-release.yml` owns parameterized version calculation, branch checkout, package/Worker version updates, release gates, version commit, edition-specific tag creation, and immutable revision output.
- `.github/workflows/release-artifacts.yml` is callable only by the two dispatchers. It builds edition-specific GitHub assets and publishes the matching GHCR repository plus optional Docker Hub/Aliyun repositories.
- The `gemini-account-pool` branch does not carry independent release workflows. Its release control plane is maintained on `main`; the branch retains its own quality gates and upstream-sync workflow.

Keep workflow names stable unless the GitHub Actions UI and README are updated together.

---

## Release Asset Contract

GitHub Releases must expose only these build artifacts plus checksum metadata:

- `web2gem-main-worker.js` or `web2gem-account-pool-worker.js`
- `<asset-prefix>_<tag>_docker_linux_amd64.tar.gz`
- `<asset-prefix>_<tag>_docker_linux_arm64.tar.gz`
- `sha256sums.txt`

Do not add bundle tarballs for the Worker asset; the raw edition-named JavaScript file is the Cloudflare Worker deployment artifact. Docker image archives must be split by platform and use the same edition-specific asset prefix.

Before uploading assets, the release workflow should verify that every expected file exists and is non-empty. The upload list should stay explicit instead of relying on broad globs that can include stale artifacts.

---

## Docker Image Publishing

Release identity is isolated by edition:

| Edition | Source branch | Tag prefix | Asset prefix | Image repository |
| --- | --- | --- | --- | --- |
| Main | `main` | `v` | `web2gem-main` | `web2gem` |
| Account pool | `gemini-account-pool` | `pool-v` | `web2gem-account-pool` | `web2gem-account-pool` |

Each image repository receives the edition release tag, bare package version, and its own `latest` tag. Docker archive assets should load into the matching local repository and release tag. Registry images must include OCI labels for the package version and the actual release commit revision.

---

## Versioned Release Safety

Only one version-bumping release workflow should run at a time across both editions. Both dispatchers use the same concurrency group because they update branches and create repository-wide tags.

Before running expensive release gates, validate the dispatcher ref and fixed edition metadata. Query the latest tag with the edition prefix; never use an unfiltered `git describe --tags` because tags from the other edition must not influence version calculation.

Validate that the target tag does not already exist. After creating the version commit, capture `git rev-parse HEAD` and use that SHA for every asset and image build.

Registry-specific release workflows should not duplicate the version bump / tag logic. Call `.github/workflows/reusable-versioned-release.yml` and consume its outputs:

- `new_version`
- `new_tag`
- `revision_sha`

Registry publish jobs should check out `revision_sha` before building Docker images so image labels and contents match the version commit.

## Scenario: Unified Edition Release Control Plane

### 1. Scope / Trigger

Use this contract when changing release dispatchers, version/tag ownership, registry publication, GitHub Release assets, or Docker build reuse.

### 2. Signatures

- `release-main.yml` and `release-account-pool.yml` inputs: `version_type`, `publish_dockerhub`, `publish_aliyun`.
- Shared edition inputs: `edition`, `source_branch`, `tag_prefix`, `asset_prefix`, `image_repository`.
- `release-artifacts.yml` also receives `release_tag`, `revision_sha`, `prepared_revision`, and optional registry booleans.
- `reusable-versioned-release.yml` outputs: `new_version`, `new_tag`, `revision_sha`.

### 3. Contracts

- Both manual entrypoints live on `main` and accept runs only from `refs/heads/main`.
- Each dispatcher passes one fixed, complete edition identity to both reusable workflows.
- A manual release calls the version-authority workflow exactly once, then publication exactly once.
- Version calculation reads only tags matching the selected edition prefix.
- The version commit is pushed back to the selected source branch, and the tag is unique across the repository.
- All registry tags and release assets use the returned `revision_sha`.
- The publication workflow always publishes GHCR and may add Docker Hub/Aliyun tags when their boolean inputs are true.
- Selected registry credentials must be validated before the image build; credentials stay out of the version-authority job.
- Use one multi-platform publication build containing all requested registry tags.
- Platform archive exports use the same checked-out revision, labels, and an edition-specific GHA cache scope.
- `release-artifacts.yml` has no `release` or independent `workflow_dispatch` trigger because those contexts cannot safely infer an edition.

### 4. Validation & Error Matrix

- Main dispatcher -> update `main`, create `v<version>`, publish `web2gem-main-*` assets and `web2gem` images.
- Account-pool dispatcher -> update `gemini-account-pool`, create `pool-v<version>`, publish `web2gem-account-pool-*` assets and images.
- Prepared versioned release -> skip duplicate release gates and build/publish the captured revision.
- Unsupported or mixed edition metadata -> fail before checkout or dependency installation.
- Docker Hub selected with missing username/token -> fail before registry login/build.
- Aliyun selected with incomplete registry/namespace/user/password -> fail before registry login/build.
- Optional registry not selected -> do not expose or use that registry's credentials/tags.

### 5. Good/Base/Bad Cases

- Good: one edition dispatcher calls one prepare workflow and one publication workflow with immutable outputs.
- Base: publish the selected edition's GHCR image, Worker asset, archives, and checksums with both optional registries disabled.
- Bad: use an unfiltered latest tag and let a `pool-v*` tag advance the main version or a `v*` tag advance the pool version.
- Bad: publish both editions into `ghcr.io/guardinary/web2gem:latest`.
- Bad: separate Docker Hub and Aliyun workflows each bump the package version and create their own tag.
- Bad: invoke `docker/build-push-action` once per registry for the same revision.

### 6. Tests Required

- Assert both dispatchers pass their fixed edition identity to both reusable workflows and contain no image build.
- Assert tag lookup is prefix-filtered and `git describe --tags` is absent.
- Assert the publication workflow is `workflow_call`-only and contains exactly one multi-registry `docker/build-push-action` step.
- Assert the legacy `release.yml` and independent Docker Hub workflow do not exist.
- Assert publication and archive builds share an edition-specific cache scope.
- Preserve explicit edition asset-name and checksum validation.

### 7. Wrong vs Correct

#### Wrong

```yaml
jobs:
  publish:
    uses: ./.github/workflows/release-artifacts.yml
    with:
      image_repository: web2gem
      release_tag: ${{ github.event.release.tag_name }}
```

#### Correct

```yaml
jobs:
  prepare:
    uses: ./.github/workflows/reusable-versioned-release.yml
    with:
      edition: account-pool
      source_branch: gemini-account-pool
      tag_prefix: pool-v
      asset_prefix: web2gem-account-pool
      image_repository: web2gem-account-pool
  publish:
    needs: prepare
    uses: ./.github/workflows/release-artifacts.yml
    with:
      edition: account-pool
      tag_prefix: pool-v
      asset_prefix: web2gem-account-pool
      image_repository: web2gem-account-pool
      release_tag: ${{ needs.prepare.outputs.new_tag }}
      revision_sha: ${{ needs.prepare.outputs.revision_sha }}
```

## Scenario: Main-Controlled Branch Release Source

### 1. Scope / Trigger

Use this contract for either `workflow_dispatch` entrypoint that can update package versions, create tags, or push a version commit to an edition branch.

### 2. Signatures

- `github.ref` / `GITHUB_REF` identifies the branch or tag selected for the manual workflow run.
- `.github/workflows/reusable-versioned-release.yml` is the only workflow allowed to create the version commit and tag.
- `source_branch` selects `main` or `gemini-account-pool` after the fixed edition tuple is validated.

### 3. Contracts

- A versioned release must fail unless `github.ref === "refs/heads/main"`.
- Validate the source ref and full edition tuple before checkout, dependency installation, version mutation, quality gates, tag creation, or pushes.
- Explicitly checkout `source_branch` with `fetch-depth: 0`; the caller ref controls which workflow definition runs, while the input controls which edition source is released.
- Push the version commit to `HEAD:<source_branch>` and create only `<tag_prefix><version>`.
- Registry-specific callers consume the reusable workflow outputs and must not push their own version commits or tags.

### 4. Validation & Error Matrix

- Main dispatcher on `refs/heads/main` -> checkout and update `main`.
- Account-pool dispatcher on `refs/heads/main` -> checkout and update `gemini-account-pool`.
- Any feature branch -> fail with a clear source-ref error before dependency installation.
- Tag ref -> fail before version calculation or mutation.
- Mixed or unsupported edition tuple -> fail closed.

### 5. Good/Base/Bad Cases

- Good: validate `GITHUB_REF` and the fixed tuple, then checkout `inputs.source_branch`.
- Base: an operator selects `main` in the manual workflow UI and either dispatcher proceeds against its declared edition branch.
- Bad: duplicate the account-pool release logic on `gemini-account-pool` and allow the two copies to drift.
- Bad: check out the caller ref implicitly and later push to a different hard-coded branch.

### 6. Tests Required

- Assert the source guard appears before checkout and dependency installation.
- Assert the guard accepts only `refs/heads/main`.
- Assert the edition tuple allowlist contains exactly the main and account-pool identities.
- Assert checkout contains `ref: ${{ inputs.source_branch }}` and `fetch-depth: 0`.
- Assert the push target uses `SOURCE_BRANCH` and the tag uses `TAG_PREFIX`.
- Keep the canonical release-gate assertions for the reusable workflow.

### 7. Wrong vs Correct

#### Wrong

```yaml
- uses: actions/checkout@v5
  with:
    ref: main
```

#### Correct

```yaml
- name: Validate release source
  env:
    RELEASE_REF: ${{ github.ref }}
  run: test "${RELEASE_REF}" = "refs/heads/main"

- uses: actions/checkout@v5
  with:
    ref: ${{ inputs.source_branch }}
    fetch-depth: 0
```

---

## Deterministic Quality Gates

- `biome.json` enables Git VCS integration with `useIgnoreFile: true` so
  `.gitignore`, `.ignore`, and Git's local exclude file bound the static scan.
- Generated-artifact consumers must select the artifact produced by their own build phase. Benchmarks default to `dist/worker.test.js`; coverage subprocesses use `BENCH_TEST_BUNDLE=dist-coverage/worker.test.js`.
- `pnpm check:bench` runs only the deterministic budget matrix and fails on missing, non-finite, or over-budget medians. Tune budgets only with repeated baseline evidence; do not hide regressions by gating the full noisy benchmark suite.
- `pnpm check:size` measures level-9 gzip bytes for the production Worker bundle
  against `BUNDLE_GZIP_SIZE_LIMIT_BYTES` or the 3 MiB default.
- `pnpm worker:types` generates `worker-configuration.d.ts` from `wrangler.jsonc` and `.dev.vars.example`; `pnpm check:worker-types` must reproduce it byte-for-byte.
- `WorkerBindings` contains only portable runtime vars and secret names. This edition has no database binding or persisted-account configuration.
- Worker type generation builds the main module first, uses `--include-runtime false` and `--strict-vars false`, and leaves runtime value validation to `getConfig`.

Run benchmark, bundle-size, Worker-type freshness, coverage, and smoke gates after changing generated sources, performance-sensitive code, or release scripts.

## Scenario: Dependency Upgrade And Local Tooling Policy

### 1. Scope / Trigger

Use this contract when upgrading dependencies, regenerating `pnpm-lock.yaml`,
changing pnpm supply-chain exceptions, or changing Biome scan boundaries.

### 2. Signatures

- Upgrade: `pnpm update --latest`.
- Explicit reviewed version: `pnpm add --save-dev <package>@<version>`.
- Reproducibility: `pnpm install --frozen-lockfile`.
- Freshness/security: `pnpm outdated` and `pnpm audit --audit-level moderate`.
- Early-release exceptions: exact versions in `minimumReleaseAgeExclude`.

### 3. Contracts

- `package.json` and `pnpm-lock.yaml` change together; lockfile resolutions are
  generated by pnpm, not edited manually.
- Replace an old exact release-age exception when accepting a newer reviewed
  version; do not accumulate stale exceptions or disable policy globally.
- Biome must honor Git ignore sources. Keep machine-local paths in Git ignore
  files rather than hard-coding developer directories in shared config.
- Wrangler or Workers types upgrades preserve generated bindings and runtime
  compatibility.

### 4. Validation & Error Matrix

- Stale lockfile -> `pnpm install --frozen-lockfile` fails.
- Updater reports a newer policy-blocked version -> inspect and intentionally
  replace the exact exception before installing that version explicitly.
- Ignored nested repository contains broken links -> `pnpm check:static` remains
  scoped to this package.
- Workers tooling incompatibility -> `pnpm check:worker-types` or typecheck fails.

### 5. Good/Base/Bad Cases

- Good: review manifest/lockfile diffs and run all affected quality gates.
- Base: already-current packages remain unchanged.
- Bad: use a pnpm override only to bypass release-age policy.
- Bad: claim freshness after install when the updater reported a newer version.

### 6. Tests Required

- Run frozen install, outdated, audit, static, typecheck, architecture, unit,
  coverage, and smoke checks.
- Run Worker type checks for Wrangler or Workers types changes.
- Run benchmark and size gates for build/runtime dependency changes.

### 7. Wrong vs Correct

#### Wrong

```yaml
minimumReleaseAgeExclude:
  - '@cloudflare/workers-types@<old-version>'
  - '@cloudflare/workers-types@<new-version>'
```

#### Correct

```yaml
minimumReleaseAgeExclude:
  - '@cloudflare/workers-types@<reviewed-version>'
```

## Scenario: Isolated Docker Build Context

### 1. Scope / Trigger

Use this contract when changing `Dockerfile`, `.dockerignore`, Docker smoke behavior, or files copied into container build stages.

### 2. Signatures

- `Dockerfile` build inputs: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.mjs`, `wrangler.jsonc`, `scripts/`, and `src/`.
- Safe environment templates: `.env.example` and `.dev.vars.example`.

### 3. Contracts

- Exclude `.env`, `.env.*`, `.dev.vars`, and `.dev.vars.*` from every Docker build context.
- Re-include the two committed example files after their matching wildcard exclusions.
- Exclude repository-only content such as tests, docs, reports, coverage, and release assets when it is not copied by `Dockerfile`.
- Every path copied from the repository by `Dockerfile` must remain available in the build context.

### 4. Validation & Error Matrix

- Sensitive environment file matches an exclusion -> it must not enter the context.
- Committed example matches a wildcard exclusion -> a later negation rule must re-include it.
- `Dockerfile` adds a new repository `COPY` input -> update `.dockerignore` and the context contract test together.
- Required build input becomes excluded -> the contract test must fail before a release build.

### 5. Good/Base/Bad Cases

- Good: `.env.*` is followed by `!.env.example`, and `.dev.vars.*` is followed by `!.dev.vars.example`.
- Base: source, build scripts, manifests, and TypeScript configuration remain available.
- Bad: send `.env.production`, tests, coverage, or local reports to the Docker daemon.
- Bad: exclude `scripts/` or `src/` while `Dockerfile` still copies them.

### 6. Tests Required

- Assert all sensitive environment patterns and repository-only paths are excluded.
- Assert example-file negations exist after their wildcard exclusions.
- Assert every declared `Dockerfile` build input is absent from the exclusion set.
- Run `pnpm unit -- tests/unit/scripts.test.mjs`; run `pnpm docker:smoke` when container startup is authorized.

### 7. Wrong vs Correct

#### Wrong

```dockerignore
.env.*
scripts
src
```

#### Correct

```dockerignore
.env
.env.*
!.env.example
.dev.vars
.dev.vars.*
!.dev.vars.example
tests
docs
```

## Scenario: Risk-Routed Pull Request Gates

### 1. Scope / Trigger

Use this contract when changing `.github/workflows/quality-gates.yml` or the local changed-file classifier.

### 2. Signatures

- `classifyChangedFiles(files)` returns `docs` or `runtime`.
- `Classify Change Risk` exposes the boolean `runtime` job output.
- `Required Gates - Ubuntu` remains the stable aggregate required-check name.

### 3. Contracts

- Every pull request triggers the workflow and classifier.
- Only root README files, `LICENSE`, and paths under `docs/` are documentation-only; empty or unknown sets fail closed to `runtime`.
- Source, tests, scripts, package/config, Docker, workflow, and `.trellis/spec/` changes run the full Ubuntu gates and Node matrix.
- Pushes to `dev`/`main` and manual runs always classify as runtime-impacting.
- Documentation-only PRs keep the Ubuntu required job present while skipping dependency installation, coverage, benchmarks, bundle checks, and the Node matrix.

### 4. Validation & Error Matrix

- `README.md` plus `docs/image.png` -> `docs`.
- Any `.github/`, `.trellis/spec/`, `src/`, `tests/`, or `scripts/` path -> `runtime`.
- No changed paths -> `runtime`.
- Non-PR event -> `runtime` without diff classification.

### 5. Good/Base/Bad Cases

- Good: use `git diff --name-only -z` and the repository-owned Node classifier.
- Base: preserve existing job display names and full release gates.
- Bad: skip the whole workflow for Markdown paths, leaving required checks pending.
- Bad: use a broad `*.md` allowlist that treats Trellis specs as documentation-only.

### 6. Tests Required

- Unit test representative docs-only, source, workflow, Trellis spec, test, and empty file sets.
- Contract-test the workflow classifier pipe, stable Ubuntu job, lightweight docs step, and runtime-only Node matrix.
- Run `actionlint` across every workflow file.

### 7. Wrong vs Correct

#### Wrong

```yaml
on:
  pull_request:
    paths-ignore: ["**/*.md"]
```

#### Correct

```yaml
jobs:
  classify:
    outputs:
      runtime: ${{ steps.risk.outputs.runtime }}
  ubuntu-quality:
    name: Required Gates - Ubuntu
    needs: classify
```

---

## Validation

For workflow changes, run:

```sh
git diff --check
pnpm typecheck
pnpm docker:smoke
```

Run broader checks such as `pnpm coverage:ci` and `pnpm smoke` when release gates, build scripts, Docker runtime behavior, or generated bundle behavior change.
