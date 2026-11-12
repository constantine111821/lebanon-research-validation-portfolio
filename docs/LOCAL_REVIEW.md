# Local review

Run this portfolio with the included synthetic records and demo accounts. Both the application and its demo data service bind to the local machine. The demo uses simulated Auth and an embedded PostgreSQL engine. It requires no hosted database account or environment file.

## Set up a clean clone

Clone this repository using your GitHub access and enter the checkout. Use Node.js 24.22.3, pnpm 11.19.0, and Python 3.10 or newer. Python runs the standalone export verifier used in the browser checks.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm demo
```

Open the workspace at [http://127.0.0.1:3000](http://127.0.0.1:3000). Ports 3000 and 43139 must be available. Stop the demo with Ctrl+C when you finish. The included service uses disposable data and starts from the fixture when restarted.

| Role | Demo sign-in |
| --- | --- |
| Researcher | `researcher@example.invalid` |
| Supervisor | `supervisor@example.invalid` |

Both accounts use the fixture password `Local-fixture-only-2026!`. These are synthetic identities for the loopback demo.

## Researcher walkthrough

1. Sign in as the Researcher. In **My Work**, open **Synthetic019 MAIN Facility** and its incident. Review the recorded facility, date, and limitations.
2. Choose **Review facts and evidence**. Open a fact category and expand a saved evidence entry. Check the source label, excerpt, and whether it supports, contradicts, limits, or provides context for the finding. An unknown value is a meaningful recorded state.
3. Select **Review fact** on a finding. Keep its recorded value, enter a short synthetic review note, and stage the change. Use **Review changes** to inspect the pending work, then choose **Save private draft**. Open your saved drafts to resume it.
4. Choose **Next research steps** to see the separate workflow for unresolved questions. **Submit changes** makes reviewed items available to the team. Saving privately is the useful choice when you want to return later.

## Supervisor walkthrough

1. Sign out and sign in as the Supervisor. Open **Supervisor Hub** to see review work and incident readiness. Open **Synthetic019 OTHER Facility** and its incident.
2. Inspect the available evidence and recorded limitations. Select **Approve incident** and follow the review prompts. Enter a synthetic reason such as “Reviewed the demo incident and its recorded limitations.” Select the attestation and submit the decision.
3. Open **Validated Incidents** and find the approved example. Choose **Export research package** to download the ZIP. It contains the approved record and a manifest with integrity information. The exported decision records the Supervisor’s acceptance of the incident and its limitations. It does not certify every individual finding.
4. Sign out when finished. The next clean start restores the original synthetic fixture.

## Run the browser checks

Stop the demo before running the tests. The test runner starts its own disposable services and uses ports 3300 and 43139.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm browser:install
pnpm test:browser
```

On Linux, if Chromium needs operating system libraries, use `pnpm exec playwright install --with-deps chromium` to install the browser and its system dependencies.

The browser checks use simulated sign-in and synthetic records to exercise retry messages, session behavior, private draft recovery, Supervisor approval, and the approved ZIP download. The export check verifies the download against the included verifier and checks that a private draft is absent from the package. These results describe the local review environment and its selected workflows. The portfolio disables account administration and omits historical GIS authority data. [Architecture](ARCHITECTURE.md)
