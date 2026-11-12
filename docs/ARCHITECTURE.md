# Architecture

The workspace combines a Next.js and React interface, shared research policy, and PostgreSQL-backed workflow rules. The portfolio uses simulated sign-in and embedded PostgreSQL. The included fixture is enough to exercise both roles without a hosted account.

| Layer | Responsibility | Source |
| --- | --- | --- |
| Web interface | My Work, case facts and evidence, draft recovery, Supervisor Hub, and approved output. | [Workspace UI](../apps/web/src/approved) |
| Server routes | Resolve the signed-in actor, check their role, and handle workspace reads and writes. Sign-in distinguishes retryable provider failures from generic credential errors. | [API routes](../apps/web/src/app/api) |
| Domain policy | Evaluate evidence and review state, retain uncertainty, and determine whether a case qualifies for approved output. | [Domain package](../packages/domain/src) |
| Data layer | Persist role assignments, private drafts, revisions and review history in an isolated database. | [Synthetic schema](../tests/support/schema) |
| Export | Assemble a bounded ZIP with approved records, citations, and integrity information. | [Package builder](../packages/domain/src/research-export.mjs) · [Standalone verifier](../scripts/verify_export.py) |

## What happens when a researcher reviews a fact?

1. The case view displays a finding with its linked source, saved passage and limitations.
2. A review is staged locally in the workspace. A private save persists the draft for its owner and does not revise the shared fact.
3. A valid shared submission records the Researcher’s fact-level decision and its revision. The scientific correction workflow can later reopen a finding and requires a separate authorized reviewer to decide a proposed correction.
4. A Supervisor’s incident decision covers case-level readiness and limitations. A currently eligible incident can be included in the portable export. Each finding retains its own review status.

The [setup and walkthrough](LOCAL_REVIEW.md) exercise those boundaries with synthetic inputs. The [verification scope](VERIFICATION.md) identifies the selected checks and the hosted capabilities outside this review.
