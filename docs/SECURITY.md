# Security and verification

The workspace handles research in progress. I designed it so access depends on the signed-in account, its role, and the operation being requested. A researcher can save unfinished work privately. A shared fact review, a Supervisor’s decision on an incident, and account administration each follow their own authorization rules.

This repository runs a synthetic copy on loopback with simulated sign-in and an embedded PostgreSQL database. It gives a reviewer a way to exercise the application’s boundaries using fictional accounts and cases. The operational project has separate evidence for its provider integration and hosted configuration. [Architecture](ARCHITECTURE.md) · [Local setup and reviewer walkthrough](LOCAL_REVIEW.md)

The included schema uses row-level security and restricted database grants. The server routes check the signed-in actor before serving role-bound requests. [Database policies](../tests/support/schema/001-base-schema.sql) · [Database grants](../tests/support/schema/005-role-grants.sql) · [Server routes](../apps/web/src/app/api)

## Controls a reviewer can exercise here

| Control | What the checks demonstrated |
| --- | --- |
| Signed-in access and role checks | The isolated browser suite checked that unauthenticated requests were denied. A Researcher was denied Supervisor operations and Research Analytics. A Supervisor reached the Analytics view and saw the uncaptured-week state. [Browser role checks](../tests/browser/roles.spec.ts) |
| Private drafts | A Researcher saved and reopened a draft with its staged review notes intact. A Supervisor in a separate session could not see that draft. Failed operations preserved previously saved work. [Browser role checks](../tests/browser/roles.spec.ts) · [Failure and recovery checks](../tests/browser/provider-retry.spec.ts) |
| Sign-in and failure handling | Invalid credentials produced a generic message. Simulated provider faults produced retry guidance. An existing session remained usable. [Sign-in checks](../tests/browser/provider-retry.spec.ts) |
| Approved export | The browser downloaded an approved ZIP, and a separate offline verifier checked its integrity. The ZIP excluded a private draft. Local tests also exercised concurrent requests, oversized output, and retry after a failed export. These checks cover a single local instance. [Export checks](../tests/browser/provider-retry.spec.ts) · [Standalone verifier](../scripts/verify_export.py) |
| Analytics data boundaries | Unit tests rejected extra identity and content fields, kept person-level cohorts out of the report, and checked that duplicate evidence and report restatements preserved the intended counts and history. [Analytics tests](../tests/unit/analytics.test.mjs) |
| Research history | Correction projection tests checked that a citation stays tied to its source, that withdrawn support is removed from the current view while its history survives, and that edits target the intended private item. [Correction and review tests](../tests/unit/scientific019-projection.test.mjs) |
| Local isolation and state changes | The demo rejected hosted mode and an off-loopback database setting. Transport tests checked same-origin navigation, refused unmatched acknowledgments, and verified that a refresh after a write adopts the current revision. [Backend isolation test](../tests/unit/local-backend.test.ts) · [Transport tests](../tests/unit/performance-transport.test.ts) |

The November 11–12 portfolio review ran from clean checkouts on Windows, Ubuntu and macOS using the application, fixtures and tests included here. Build, typecheck, lint, unit, and Chromium checks completed successfully. A separate clean Windows run recorded 16 unit and three browser tests passing, with zero lint errors and 16 warnings. [Verification scope](VERIFICATION.md) · [Clean-checkout workflow](../.github/workflows/reviewer.yml)

## Operational review and its limits

I consulted cybersecurity students and professionals and organized a seven-agent defensive assessment of the application, repository and hosting. I prioritized dependency updates, clearer provider-outage handling, and bounded export. The final operational integration reran checks against the combined changes using disposable services, including a real GoTrue Auth service in CI. The CI evidence bundles were checked against the tested commit, tree, and file checksums. The public-facing portfolio shows the synthetic slice and the tests a reviewer can run here.

| Area | Evidence and scope |
| --- | --- |
| Account and database access | The isolated operational review exercised access for active Researcher and Supervisor accounts and denial for inactive accounts and unauthenticated requests. Read-only hosted checks sampled migration records, policy metadata, and role restrictions. A separate authenticator challenge protected account administration. The synthetic portfolio exercises selected app roles and privacy boundaries. |
| Corrections and incident decisions | The operational workflow checks exercised distinct responsibilities for Researcher fact review, independent correction review, and Supervisor incident decisions. The portfolio exposes the roles and tests selected correction behavior and export eligibility. |
| Availability and recovery | The operational follow-up inspected backup configuration and rehearsed recovery with synthetic data. End-to-end hosted alert delivery, access by an alternate operator, and a complete managed restore remained open. |
| Release and dependency review | The operational CI runs verified the integrated fixes and evidence bundles. The portfolio retained the tested dependency versions and rerunnable checks. These receipts establish results for their recorded revisions. |
| Hosted coverage | Exact authorization parity on an isolated hosted target, a populated hosted Analytics report, and an approved export on that target remained outside the verified scope. The browser suite here uses Chromium. |

The portfolio uses synthetic records, accounts and sources. The release evidence, production configuration, and research data remain with the operational project.
