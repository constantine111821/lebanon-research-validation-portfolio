# How I organized the project and handed work between chats

I credit this setup with making the whole project possible for me. I was learning to build software as I went. I kept one place where I could ask whatever question was on my mind, work through the research or product decision, and get help turning it into a prompt. I kept the build in a separate place where I could hand over that prompt and see what came back.

## Who did what

| Role | How I used it |
| --- | --- |
| Guide | I started with regular ChatGPT and went through several Guide versions. I asked it to explain what had happened, help me judge whether the result matched what I wanted, and write the prompt for the next assignment. |
| Masterbuild and Codex | I used ChatGPT Work as Masterbuild at first. It worked on the research tools and the implementation. After meeting Kenneth Bundy, I moved the build to Codex and gathered the source, project files and specifications in a GitHub repository. I kept the Guide alongside it. |
| Lebanon Project Analysis | I used this separate chat to think through the shared lab spreadsheet in October. I returned to it in November to assess the state of the project and count iterations. |
| Me | I set the research scope and decided what to build, what counted as evidence, when a result met the acceptance criteria, and which changes could go live. I tested the workflows myself and brought feedback from the lab back into the process. |

## How I kept the next chat from starting over

By September 18 I had noticed what I called “symptoms of memory compression.” Earlier decisions were getting harder to rely on as the conversation grew. I started carrying a written project state and decision log between Guides. I also kept source files, reports and test results. The handoff needed to tell the next Guide which files mattered and why.

1. **Write down what I have decided.** I want the next Guide to know the current research rules, the scope I approved, and the work I am asking it to think through. I also want it to see which older decisions have been superseded.
2. **Point to the actual artifact.** Early handoffs identified the exact workbook I had tested. Later ones pinned the source commit and the evidence from the checks that ran against it. When there were several versions of a workbook or release candidate, the name, date, version and checksum helped identify which one to use.
3. **Carry forward the state of the work.** I separate what I accepted, what was built locally, what was tested, what went live, and what is still unresolved. When a handoff discusses several candidate packages, it should say which one is current and which alternatives were set aside.
4. **Check the handoff against the work.** I ask a successor to read the current files and reconcile them with the summary. The September transition showed why that mattered. The first package and its description did not contain the same evidence. The corrected handoff supplied the missing material and identified the version to use.
5. **Keep the next assignment bounded.** A Guide handoff carries context and the next decision I need help with. I give the build its own assignment when I am ready. I keep the original chats and artifacts so I can check how we arrived at a decision.

## What I treat as authoritative

My current approved decisions set the research scope, product rules and permission to proceed. The versioned files record those decisions. The source code and data artifacts show what was implemented. A test or release receipt tells me what was actually exercised and in which environment. A Guide summary can help me find that evidence. If the records disagree, I want the discrepancy surfaced before we act on it.

For example, the September handoff identified the specific workbook I had opened and tested, alongside a recovery candidate that had passed automated checks. Those were two different facts with different consequences for what I could give the lab. Later, a release check needed to identify the exact commit and show what had been tested before I could decide whether to ship it.

The same distinction mattered for the research itself. We could use an older source as a lead and reassess it under the current rules. A case-level decision did not settle every fact in the case. Researchers and Supervisors still needed to see the evidence and make the decisions their roles allowed.

The early split, the switch to Codex, and the decisions that followed are in the [expanded timeline](TIMELINE_EXPANDED.md). Selected implementation changes and test references are in the [curated source snapshots](CURATED_SNAPSHOTS.md).
