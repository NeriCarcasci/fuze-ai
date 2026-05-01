# Security policy

## Reporting a vulnerability

Email `security@fuze.ai` with:

- A description of the issue
- The affected package and version (`npm ls @fuze-ai/agent` is helpful)
- A reproduction (minimal repo, gist, or detailed steps)
- Your assessment of impact

Encrypt sensitive details if possible. Public PGP key fingerprint will be published at `https://fuze.ai/.well-known/pgp.txt`.

Do not open public GitHub issues for vulnerability reports.

## Disclosure timeline

- Acknowledgement: within 3 business days.
- Initial assessment: within 10 business days.
- Fix or mitigation: within 90 days of acknowledgement, unless the issue is in a third-party dependency where we coordinate with the upstream maintainer.
- Public disclosure: coordinated with the reporter; default 90 days from acknowledgement.

If we cannot meet the 90-day target we will communicate the reason and a revised target before the deadline.

## Supported versions

| Version | Status |
|---|---|
| 1.x | supported (security fixes) |
| 0.x | pre-release; security fixes on a best-effort basis until 1.0 lands |

Once 1.0 ships, only the latest minor of the latest major receives security updates by default. Long-term-support arrangements are available for Sovereign-tier deployments.

## Scope

In scope:

- The published packages under `@fuze-ai/*` on npm
- The Fuze cloud ingest endpoints
- The reference Sovereign Terraform modules

Out of scope:

- Issues that require a customer-side misconfiguration (e.g., world-readable signing key on disk)
- Findings against the dashboard's marketing pages
- Issues in third-party dependencies, unless we shipped them in a way that creates a new attack surface

## Hall of fame

Reporters who follow this process and disclose responsibly are credited in `CHANGELOG.md` for the release that contains the fix, unless they ask to remain anonymous.
