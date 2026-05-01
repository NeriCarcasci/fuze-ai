# Branch protection rules

These rules cannot be applied via a workflow alone — set them in the GitHub UI under **Settings → Branches → Branch protection rules** (or via `gh api`).

## `main`

Required:

- Require a pull request before merging
  - Require **1** approving review from a maintainer
  - Dismiss stale approvals on new commits
  - Require review from Code Owners (if `CODEOWNERS` is present)
- Require status checks to pass before merging
  - `ci / build-test (node 20)`
  - `ci / build-test (node 22)`
  - `ci / build-test (node 24)`
  - `ci / sbom`
  - `ci / osv-scanner`
  - Require branches to be up to date before merging
- Require **linear history** (no merge commits — squash or rebase only)
- Require **signed commits**
- Require conversation resolution before merging
- Restrict who can push to matching branches: maintainers only
- Do **not** allow bypass for administrators

## Tags (`v*.*.*`)

- Restrict tag creation to maintainers
- Require signed tags

## Required secrets / variables

| Name              | Scope        | Required for          | Notes                                              |
| ----------------- | ------------ | --------------------- | -------------------------------------------------- |
| `NPM_TOKEN`       | repo secret  | `release.yml`         | npm automation token, scoped to `@fuze-ai`         |
| `MISTRAL_API_KEY` | repo secret  | `live-tests.yml`      | optional; gates the live provider suite            |
| `E2B_API_KEY`     | repo secret  | `live-tests.yml`      | optional; gates the live sandbox suite             |
| `CI_LIVE`         | repo var     | `ci.yml`              | set to `1` to opt the matrix into live tests       |
| `KMS_*`           | future       | KMS-backed signing    | reserved; not used yet                             |

`GITHUB_TOKEN` is provided automatically and is used for OCI registry login + Cosign keyless OIDC.
