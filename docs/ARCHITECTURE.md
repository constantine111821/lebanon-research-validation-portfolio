# Architecture

The workspace uses a Next.js and React application, a shared domain package, and PostgreSQL-backed workflow rules. The review build uses an isolated synthetic environment. The reviewer can exercise the workflow with the fixtures included in this repository.

| Layer | Responsibility |
| --- | --- |
| Web interface | Presents My Work, case facts and evidence, drafts, Supervisor Hub, and approved output. It distinguishes private saves from team submissions. |
| Server routes | Establish a session, check the active account and role, and handle reads and writes. Sign-in distinguishes retryable provider failures from generic credential errors. |
| Domain logic | Evaluates findings and evidence, preserves uncertainty, and decides which records qualify for approved output. |
| Data layer | Persists records, role assignments, review history, and private drafts. Database policies and functions enforce access and keep shared state changes consistent. |
| Export and tests | Generates portable packages for eligible records with a verification manifest. The tests exercise role boundaries, workflow behavior, and output using synthetic data. |

## Workflow boundaries

A Researcher can review and propose changes. A private draft belongs to its author, and a team submission makes the proposed work available for review. The Supervisor’s incident decision is distinct from an individual finding’s evidence status. Approval makes an eligible incident available in Validated Incidents. Exports preserve uncertainty and citations and use explicit limits on the work they perform.

The portfolio’s tests cover the local environment described in the walkthrough. That scope is the basis for the security statements and test results in this repository. [Local setup and walkthrough](LOCAL_REVIEW.md)

The source is organized into [Next.js routes](../apps/web/src/app), a [shared domain package](../packages/domain), and a [synthetic test schema](../tests/support/schema). The [browser checks](../tests/browser) use the same local routes as the walkthrough.
