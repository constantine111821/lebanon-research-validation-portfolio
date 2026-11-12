# Verification scope

[Run the reviewer checks](LOCAL_REVIEW.md) or inspect the [clean-checkout workflow](../.github/workflows/reviewer.yml). The workflow checks the exact GitHub SHA, uses a fresh runner with the pinned Node and pnpm versions, installs the lockfile, and runs the build, typecheck, lint, unit tests, and Chromium suite. See the **Actions** tab for the platform results at the commit under review.

| Check | What is exercised |
| --- | --- |
| Researcher and Supervisor browser flow | Simulated sign-in, direct endpoint checks, both incident navigation links, an evidence card with its source link and saved excerpt, private draft save and reopen, and draft ownership across role sessions. |
| Research Analytics | Researcher access denied and Supervisor can open the uncaptured-week state in the fixture. A real weekly snapshot is outside the portfolio. |
| Failure handling | Generic invalid-credential message, retry messages for simulated provider faults, existing session continuity, and saved-draft preservation after failed operations. |
| Approved output | Supervisor approval, bounded export responses, an actual Chromium ZIP download, offline Python integrity verification, and exclusion of the private draft. |
| Data isolation | Synthetic accounts and records, embedded PostgreSQL, loopback-only service configuration, and a disposable reset path. |

The control-by-control results and scope of the operational assessment are described in [Security and verification](SECURITY.md).

The operational project separately tested its Auth-provider integration and reviewed its hosted access, configuration and recovery boundaries. This repository contains the runnable application review slice, selected domain and policy code, and synthetic schema and tests. It excludes hosted identity administration, production configuration, production migrations and data, historical GIS authority inputs, operational audit files, and the separate research-engine runners and corpora. Browser checks use Chromium and do not establish Safari or Firefox coverage.
