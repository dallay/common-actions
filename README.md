# common-actions

Reusable GitHub Actions and workflows for the [dallay](https://github.com/dallay) organization.

## Overview

This repository provides **composite actions** and **reusable workflows** that standardize CI/CD patterns across all repositories in the organization. Instead of duplicating workflow logic, every repo calls these shared building blocks.

### Repository Structure

```
common-actions/
├── actions/                              # Composite Actions
│   ├── setup-node/action.yml             # Node.js + pnpm setup with caching
│   ├── setup-java/action.yml             # Java + Gradle setup with caching
│   ├── setup-buildx/action.yml           # QEMU + Docker Buildx for multi-arch
│   ├── docker-build-push/action.yml      # Multi-registry Docker build & push
│   ├── docker-security-scan/action.yml   # Trivy vulnerability scanning + SARIF
│   ├── codecov/action.yml                # Upload coverage to Codecov
│   └── playwright-test/action.yml        # Playwright E2E tests with caching
│
└── .github/workflows/                    # Workflows (reusable + local)
    ├── semantic-pr.yml                   # Lint PR titles (Conventional Commits)
    ├── pr-labeler.yml                    # Path-based PR labeling
    ├── issue-labeler.yml                 # Keyword-based issue labeling
    ├── labels-sync.yml                   # Sync labels from YAML config
    ├── semantic-release.yml              # Semantic Release with GitHub App
    ├── stale.yml                         # Close stale issues/PRs
    ├── greetings.yml                     # Welcome first-time contributors
    ├── cleanup-cache.yml                 # Cleanup caches for closed branches
    └── release.yml                       # Release this repository
```

## Composite Actions vs Reusable Workflows

| Feature | Composite Action | Reusable Workflow |
|---------|-----------------|-------------------|
| **Scope** | Steps within a job | Entire jobs |
| **Secrets** | Inherits caller context | Must be passed explicitly |
| **Logging** | Shows as single step | Each job/step logged individually |
| **Use case** | Setup tools, build steps | Standalone processes |

---

## Composite Actions

### `actions/setup-node`

Sets up Node.js and pnpm with caching and dependency installation.

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: dallay/common-actions/actions/setup-node@v1
    with:
      node-version: "24.12.0"    # optional, this is the default
      # node-version-file: ".nvmrc"  # alternative: read from file
      # cwd: "./frontend"           # optional: working directory for install
      # install-deps: "true"        # optional: run pnpm install (default: true)
      # ignore-scripts: "true"      # optional: add --ignore-scripts to pnpm install
```

### `actions/setup-buildx`

Sets up QEMU and Docker Buildx for multi-platform container builds.

```yaml
steps:
  - uses: dallay/common-actions/actions/setup-buildx@v1
    # with:
    #   buildx-version: "v0.12.0"                  # optional
    #   buildkit-image: "moby/buildkit:v0.12.5"     # optional
```

### `actions/docker-build-push`

Builds and pushes Docker images to both GHCR and Docker Hub with multi-arch support and registry-based caching.

```yaml
steps:
  - uses: dallay/common-actions/actions/setup-buildx@v1

  - uses: dallay/common-actions/actions/docker-build-push@v1
    with:
      image-name: my-app
      image-title: My App
      image-description: "My application"
      dockerfile: ./Dockerfile
      github-owner: ${{ github.repository_owner }}
      dockerhub-username: ${{ secrets.DOCKERHUB_USERNAME }}
      github-token: ${{ secrets.GITHUB_TOKEN }}
      dockerhub-token: ${{ secrets.DOCKERHUB_TOKEN }}
      version: "1.2.3"
      major-version: "1"
      # platforms: "linux/amd64,linux/arm64"  # optional, this is the default
      # build-args: |                          # optional
      #   VERSION=1.2.3
```

**Outputs:** `tags`, `digest`, `image-id`

### `actions/setup-java`

Sets up Java JDK and Gradle with dependency caching.

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: dallay/common-actions/actions/setup-java@v1
    with:
      java-version: "24"       # optional, this is the default
      distribution: "temurin"  # optional (temurin, corretto, zulu, etc.)
      # cache: "gradle"        # optional: gradle (default), maven, sbt, or "" to disable
```

### `actions/codecov`

Uploads code coverage reports to Codecov with graceful failure handling. Skips upload if no token is provided.

```yaml
steps:
  - uses: dallay/common-actions/actions/codecov@v1
    with:
      codecov-token: ${{ secrets.CODECOV_TOKEN }}
      files: "**/build/reports/jacoco/test/jacocoTestReport.xml"
      flags: backend
      name: backend-coverage
      slug: owner/repo
      # fail-ci-if-error: "false"  # optional
      # fail-on-upload-error: "false"  # optional
      # verbose: "false"           # optional
```

**Outputs:** `upload-failed` (boolean string)

### `actions/playwright-test`

Runs Playwright E2E tests with intelligent browser caching, artifact uploads, and step summary.

> **Prerequisite:** Node.js and pnpm must be set up before using this action. Use `actions/setup-node` first.

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: dallay/common-actions/actions/setup-node@v1
  - uses: dallay/common-actions/actions/playwright-test@v1
    with:
      browser: chromium              # optional: chromium (default), firefox, webkit, or all
      # working-directory: "."       # optional: directory with playwright config
      # test-command: "test:e2e"     # optional: pnpm script to run
      # headed: "false"              # optional
      # upload-results: "true"       # optional: upload report + traces
      # retention-days: "30"         # optional
```

**Outputs:** `tests-status` (`success` or `failed`), `report-path`

### `actions/docker-security-scan`

Scans Docker images for vulnerabilities using Trivy. Uploads SARIF reports to the GitHub Security tab and saves results as artifacts.

> Runner note: If you upgrade `github/codeql-action/upload-sarif` or `actions/upload-artifact` to versions that use upload-artifact v6, ensure self-hosted runners are >= 2.327.1 and Node.js 24 is available.

```yaml
steps:
  - uses: dallay/common-actions/actions/docker-security-scan@v1
    with:
      image-ref: ghcr.io/owner/repo/my-app:latest
      report-name: my-app-security
      category: my-app-trivy
      # severity: "HIGH,CRITICAL"  # optional
      # fail-on-error: "true"      # optional: fail pipeline on vulnerabilities (default: true)
```

**Outputs:** `scan-result` (`success`, `failed`, or `error`), `sarif-file`

---

## Reusable Workflows

> Tip: Most reusable workflows accept an optional `github-token` secret to override the default `GITHUB_TOKEN` (e.g., use a GitHub App token). The semantic-release workflow uses its own GitHub App credentials.

### `semantic-pr.yml` — Lint PR Titles

Validates PR titles follow [Conventional Commits](https://www.conventionalcommits.org/). Posts a helpful sticky comment on failure.

```yaml
# .github/workflows/semantic-pr.yml
name: Lint PR title
on:
  pull_request_target:
    types: [opened, edited, synchronize]

jobs:
  lint:
    uses: dallay/common-actions/.github/workflows/semantic-pr.yml@v1
    secrets: inherit
    # secrets:
    #   github-token: ${{ secrets.GITHUB_TOKEN }}  # optional override
    # with:
    #   skip-bot: "dependabot[bot]"  # optional, this is the default
```

### `pr-labeler.yml` — Label PRs by Path

Auto-labels PRs based on changed file paths. Requires a `.github/labeler.yml` config in your repo.

```yaml
# .github/workflows/pr-labeler.yml
name: PR Labeler
on:
  pull_request_target:
    types: [opened, synchronize, reopened]

jobs:
  label:
    uses: dallay/common-actions/.github/workflows/pr-labeler.yml@v1
    secrets: inherit
    # secrets:
    #   github-token: ${{ secrets.GITHUB_TOKEN }}  # optional override
    # with:
    #   sync-labels: true                          # optional
    #   configuration-path: ".github/labeler.yml"  # optional
```

### `issue-labeler.yml` — Label Issues by Keywords

Auto-labels issues based on title/body keywords. Requires a `.github/issue-labeler-config.yml` in your repo.

```yaml
# .github/workflows/issue-labeler.yml
name: Issue Labeler
on:
  issues:
    types: [opened, edited]

jobs:
  label:
    uses: dallay/common-actions/.github/workflows/issue-labeler.yml@v1
    secrets: inherit
    # secrets:
    #   github-token: ${{ secrets.GITHUB_TOKEN }}  # optional override
```

### `labels-sync.yml` — Sync Repository Labels

Synchronizes GitHub labels from a YAML config file. Requires a `.github/labels.yml` in your repo.

```yaml
# .github/workflows/labels-sync.yml
name: Sync Labels
on:
  push:
    branches: [main]
    paths: [".github/labels.yml"]
  workflow_dispatch:

jobs:
  sync:
    uses: dallay/common-actions/.github/workflows/labels-sync.yml@v1
    secrets: inherit
    # secrets:
    #   github-token: ${{ secrets.GITHUB_TOKEN }}  # optional override
```

### `semantic-release.yml` — Automated Releases

Runs semantic-release with a GitHub App token for authentication. Outputs version info for downstream jobs.

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    branches: [main]

jobs:
  release:
    uses: dallay/common-actions/.github/workflows/semantic-release.yml@v1
    secrets:
      app-id: ${{ secrets.APP_ID }}
      app-private-key: ${{ secrets.APP_PRIVATE_KEY }}
    # with:
    #   node-version: "24.12.0"
    #   dry-run: false
    #   install-deps: true
    #   semantic-release-command: "pnpm exec semantic-release"

  # Use release outputs in downstream jobs
  deploy:
    needs: release
    if: needs.release.outputs.new-release-published == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploying version ${{ needs.release.outputs.new-release-version }}"
```

**Outputs:** `new-release-published`, `new-release-version`, `new-release-major-version`, `new-release-minor-version`, `new-release-patch-version`, `new-release-git-tag`

> This repo ships a local release workflow at `.github/workflows/release.yml` that calls the reusable semantic-release workflow using `npx semantic-release` and the `.releaserc.json` config.

### `stale.yml` — Close Stale Issues/PRs

Marks inactive issues and PRs as stale, then closes them after a grace period.

```yaml
# .github/workflows/stale.yml
name: Stale
on:
  schedule:
    - cron: "0 2 * * *"

jobs:
  stale:
    uses: dallay/common-actions/.github/workflows/stale.yml@v1
    secrets: inherit
    # secrets:
    #   github-token: ${{ secrets.GITHUB_TOKEN }}  # optional override
    # with:
    #   days-before-stale: 120
    #   days-before-close: 60
    #   exempt-issue-labels: "priority:high,security"
```

### `greetings.yml` — Welcome First-Time Contributors

Posts a welcome message for first-time issue creators and PR authors.

```yaml
# .github/workflows/greetings.yml
name: Greetings
on: [pull_request, issues]

jobs:
  greet:
    uses: dallay/common-actions/.github/workflows/greetings.yml@v1
    secrets: inherit
    # secrets:
    #   github-token: ${{ secrets.GITHUB_TOKEN }}  # optional override
    # with:
    #   issue-message: "Thanks for opening this issue!"
    #   pr-message: "Thanks for your contribution!"
```

### `contributor-report.yml` — Contributor Quality Report

Generates a quality report for PR contributors based on merge rate, account age, and reactions.

```yaml
# .github/workflows/contributor-report.yml
name: Contributor Report
on:
  pull_request:
    types: [opened, reopened, synchronize, edited]

jobs:
  report:
    uses: dallay/common-actions/.github/workflows/contributor-report.yml@v1
    secrets: inherit
    # with:
    #   threshold-pr-merge-rate: '0.3'
    #   threshold-account-age: '30'
    #   on-fail: 'comment'
```

### `cleanup-cache.yml` — Cleanup Branch Caches

Removes GitHub Actions caches associated with a closed PR's branch.

```yaml
# .github/workflows/cleanup-cache.yml
name: Cleanup caches
on:
  pull_request:
    types: [closed]

jobs:
  cleanup:
    uses: dallay/common-actions/.github/workflows/cleanup-cache.yml@v1
    secrets: inherit
    # secrets:
    #   github-token: ${{ secrets.GITHUB_TOKEN }}  # optional override
    # with:
    #   pr-number: ${{ github.event.pull_request.number }}  # optional override
```

---

## Security Practices

- **SHA Pinning**: All third-party actions are pinned to full commit SHAs (not mutable tags)
- **GitHub App Tokens**: Used instead of PATs for release operations
- **Minimal Permissions**: Each workflow declares only the permissions it needs
- **No Secrets in Logs**: Secrets are never echoed or exposed in step summaries
- **Fork Safety**: Label sync workflows skip forks that lack permissions

## Versioning

This repository uses [Semantic Versioning](https://semver.org/). Pin your usage to a major version tag:

```yaml
uses: dallay/common-actions/actions/setup-node@v1      # Recommended: major version
uses: dallay/common-actions/actions/setup-node@v1.2.3  # Exact version
uses: dallay/common-actions/actions/setup-node@main     # Latest (not recommended)
```

## Contributing

1. Create a feature branch
2. Make your changes
3. Test locally where possible
4. Open a PR with a [Conventional Commits](https://www.conventionalcommits.org/) title
5. Request review

## License

This project is open source under the [MIT License](LICENSE).
