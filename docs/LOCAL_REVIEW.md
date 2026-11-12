# Local review

The demo runs against an embedded PostgreSQL engine and simulated sign-in. The web and fixture servers listen on loopback. The fixture is fictional and resets on restart. You need internet access for the initial Git clone and dependency downloads. You need no hosted database credentials, environment file, Docker, or Python to open the demo.

## Start from GitHub

From the repository’s **Code** menu, copy the HTTPS clone URL. Use the GitHub repository and revision in your review handoff. Replace the placeholders below before running the commands.

```sh
git clone <HTTPS clone URL>
cd <checkout directory>
git checkout --detach <review commit SHA>
git rev-parse HEAD
```

Install Node.js **24.22.3** with npm, then install pnpm **11.19.0**. Open a fresh terminal if the installer changes your PATH. On Windows, if PowerShell blocks the npm or pnpm script shim, use Command Prompt or invoke `npm.cmd` and `pnpm.cmd` there. [Node 24.22.3 release files](https://nodejs.org/dist/v24.22.3/) · [pnpm installation](https://pnpm.io/installation#using-npm)

```sh
node --version
npm install --global pnpm@11.19.0
pnpm --version
pnpm install --frozen-lockfile
pnpm build
pnpm demo
```

With ports **3000** and **43139** free, open [http://127.0.0.1:3000](http://127.0.0.1:3000). If a port is busy, stop the program that owns it if appropriate, then restart the demo. Keep the terminal open. Press **Ctrl+C** to stop both services. Run `pnpm demo` again to reset the synthetic records. Sign in again if a previous session is still in the browser.

| Role | Demo sign-in |
| --- | --- |
| Researcher | `researcher@example.invalid` |
| Supervisor | `supervisor@example.invalid` |

Both use the synthetic fixture password `Local-fixture-only-2026!`.

## Researcher walkthrough

1. In **My Work**, open **Synthetic019 MAIN Facility** and its incident. Check the facility, incident date status and limitations.
2. Choose **Review facts and evidence**. Open the fact category containing **Synthetic physical consequences**, then expand its **Evidence** disclosure. The finding, the **Synthetic019 SUPPORTS report** source link, and the recorded passage **Synthetic SUPPORTS description** are in the same fact card. The link has a fictional destination.
3. On the fact card, choose **Review fact**. Keep the recorded value, select **Needs more evidence**, enter a short synthetic note, attest to the review and stage it. Select **Review changes**, then **Save private draft**. Open [My private drafts](http://127.0.0.1:3000/drafts), choose **Continue draft**, and reopen **Review changes** to see the saved note. The shared finding stays as it was.
4. Close **Review Changes** and choose **Next research steps** on the incident to see the unresolved-question workflow. Leave the draft private for this walkthrough. The Researcher has no **Research Analytics** tab and receives a 403 from [the local Analytics API](http://127.0.0.1:3000/api/analytics).

## Supervisor walkthrough

1. Sign out and sign in as the Supervisor. Open **Supervisor Hub** to inspect the queue and readiness. Open **Research Analytics** and see the uncaptured-week state. The other role’s draft is absent from [My private drafts](http://127.0.0.1:3000/drafts).
2. Open **Synthetic019 OTHER Facility** and its incident. Inspect its findings and limitations. Choose **Approve incident**, continue through the prompts, enter a synthetic reason, and attest before submitting.
3. Open **Validated Incidents**, then choose **Export research package** to download the ZIP. This represents the Supervisor’s acceptance of the synthetic incident and its limitations. Individual factual certifications are distinct.
4. To verify the ZIP, install Python 3.10 or newer and run the checked-out verifier from the repository root. Replace the example path with the actual download path. On systems where the command is `python3`, use that name. The output should report `"status": "PASS"`.

```sh
python scripts/verify_export.py "/path/to/downloaded-package.zip"
```

## Run the automated checks

Stop the demo first. The Playwright suite starts its own services on ports **3300** and **43139**. Python is required here because a browser test verifies the downloaded ZIP. The test can find `python3` or `python` on PATH. [Python downloads](https://www.python.org/downloads/)

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm browser:install
pnpm test:browser
```

On Linux, replace `pnpm browser:install` with `pnpm exec playwright install --with-deps chromium` if the runner needs Chromium system libraries. Installing OS libraries can require administrator access. [What the checks cover](VERIFICATION.md)
