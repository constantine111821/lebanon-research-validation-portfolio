# What I designed and led

## Finding a better way to do the research

When Human Rights Watch assigned our lab to investigate disruptions to healthcare in Lebanon, I saw a gap in how we were doing the research. Our team of 14 researchers was working from a national Excel workbook with 1,383 facility records. Researchers would search Google for a facility by name and try to determine whether an incident had occurred there. Some searches started with broad terms about strikes in Lebanon, which made it hard to see what had already been checked and which facilities still needed attention.

I saw an opportunity to make the team’s work more productive and learn how to build software with AI. I designed a research agent that narrowed the workbook to 122 records in South and El Nabatieh, the two governorates in scope. For each named facility, it ran a defined set of keyword searches, opened relevant sources, and extracted passages that addressed a predefined set of research questions. It saved the findings alongside the sources and excerpts, then moved to the next facility. I could run a batch without prompting it for every record.

I’m developing a second version that assigns discovery and verification to separate agents, preserves the exact passages they used, and can resume after an interruption. One supervised benchmark used 20 agents, with ten investigators and ten separate reviewers. That version is still in development.

## Building a workspace for human verification

Once the agent could gather evidence, I had to figure out how the lab would review it. Human verification was a design requirement from the start. In human rights research, a plausible answer can still get the facility, date, or effect wrong. I wanted a researcher to be able to open a proposed finding, read the exact supporting passage, see what remained uncertain, and make their own decision.

I first tried to build that workflow in an interactive Excel workbook. I reached the limits of what I could do with formulas and workbook automation, so I used Codex to build a web pilot. When I started the project in mid-September, I had never coded and had mainly used AI for occasional graphs, writing help, and image generation. I learned by asking Codex to explain what it was doing, testing the results myself, and changing the design when the workflow failed in practice. I funded my AI usage myself. After I presented the pilot to the lab leadership and faculty lead, I received the go-ahead to continue.

The hardest part was designing an interface a first-time researcher could learn quickly. I worked through the workflow repeatedly and used feedback from lab members to find places where the next action was unclear. I separated Researcher and Supervisor roles so researchers could collect and review evidence while supervisors could assign work, see what was outstanding, and decide which records were ready for approved output. The lab began using the workspace, and its feedback still informs the design. A recent change made fact review easier to find and put the exact source excerpt alongside the finding it supports.

I also wanted to carry the lab’s existing article research into the website. People were still sorting the sources they had gathered. Starting over in a new system would have felt like a step backward. We audited the submissions and prepared evidence and leads that could be reviewed in the new workflow. [Expanded timeline](TIMELINE_EXPANDED.md)

I led the product and workflow design, defined what the software needed to do, and decided what evidence was sufficient to accept a change. I used Codex to help implement those decisions, coordinate development, and run tests. I also used the workspace myself and recruited lab members to test it under real working conditions.

I organized the project so I could use the Guide to understand the work and shape the next prompt, then hand that prompt to Masterbuild or Codex to implement. I kept approved decisions and evidence in files the next chat could read. [How I organized the project](PROJECT_WORKFLOW.md)

## Preparing the research for mapping and protecting access

The next phase of the Human Rights Watch project is to map the facilities alongside the findings the lab verifies. Drawing on my GIS minor, I designed a coordinate review workflow and a one-click export formatted for ArcGIS. That gives the lab a path from reviewed findings to a mapping dataset without manually rebuilding the facility and evidence records in GIS.

Because the workspace handles sensitive research, I designed permissions around what each role needs to do. Private drafts are scoped to their owners, and sensitive actions require the appropriate role. The goal is to limit what a compromised account can access or change. I consulted cybersecurity students and professionals and organized a seven-agent defensive review of the application, repository, and hosting. That work verified specific access controls and identified further work on hosted monitoring and recovery. [Security and verification](SECURITY.md)

## Acknowledgments

Thank you to Kenneth Bundy, whom I met by chance when I was stuck. His advice on structuring the data and his encouragement to use Codex, Next.js, and Vercel helped me see a way forward. I’m not sure this project would have crossed the finish line without that conversation.

Thank you to my HRL faculty lead for believing I could build this and trusting that the workspace could support real research. Thank you to my Lebanon project lead for the encouragement, trust, and leadership throughout the development of the website.
