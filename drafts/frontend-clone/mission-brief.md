# Mission seed brief — TradingView-style multi-module site clone (research, unattended)

> This is the `text` you send to `POST /gateway/master/wake` (omit missionID to
> start; resend with the same missionID to resume). It seeds the Gateway Master's
> frontier and dispatch plan. It is NOT a skill and NOT an engine_task request —
> the Gateway Master reads it, then dispatches engine_tasks from it.

You are supervising this mission. Your operating doctrine is your
gateway-master-core (wake protocol, mission-state files, task granularity, scope
honesty). This brief only seeds WHAT to dispatch and in WHAT ORDER. You do not
execute — every artifact comes from an engine_task you dispatch with
`executor=opencorvus`, which internally runs
design_analysis → requirements → architect → build → integrity.

## The per-module closed loop

Each opencorvus task already does, inside one shared workspace:
1. design_analysis — investigate the module's live reference URL → mirror-grounded PRD/SPEC
2. build — write the code
3. integrity — OpenCorvus checks the project (the acceptance gate)

Your job is step 4: `panel query_task` the verdict, update `tasks.md` /
`frontier.md`, then `panel create_task (queue=true)` the next module. Loop across
wakes until the frontier is empty or you hit a real blocker. That is the
unattended replication loop.

## Dispatch order (seed frontier.md with this)

1. **FIRST: one shared-foundation task.** Shared shell + central route registry +
   boundary system (auth / paid / route-placeholder / unsupported) + deterministic
   synthetic market-data engine + local DB + a single instrument/quote/bar domain +
   an API layer with one response envelope. Acceptance: app boots, base routes
   render inside the shell, health check, a site-smoke Playwright passes.
   **Do NOT dispatch any module before this task reaches integrity=pass.**
2. **THEN one task per module**, each carrying the module's live reference URL as
   the visual source of truth, built on the accepted foundation. Priority order:
   Screener → Chart → Symbol Detail → Markets → Home → News/Ideas/Scripts →
   Calendar/Brokers/Pricing → Heatmap/Crypto-Screener → Support/About.
3. **FINALLY: one integration/regression task** — full-site Playwright + cross-module
   routing + confirm no earlier module regressed.

## Writing each task request (self-contained — the executor never sees this brief)

Every module task `request` MUST include:
- the module's live reference URL (authoritative; restore 1:1 as the stack allows);
- "build on the existing shared foundation; reuse the single instrument/quote
  domain, the API response envelope, the central route registry, the shared
  shell/components, and the boundary system — do NOT create parallel copies";
- module in-scope / out-of-scope;
- acceptance criteria incl. cross-module route links + a Playwright spec + a visual
  fidelity check against the reference;
- "no static mock, no real TradingView API/private bundle, no faked login/payment —
  degrade through the shared boundaries honestly".

Phrasing each request as "复刻/clone the <module> module on top of the shared
foundation" auto-loads the `frontend-module-fidelity` skill inside the executor's
build/design agents, so you need not restate the full engineering law — but you DO
restate the module-specific facts above, because the executor sees only the request.

## Granularity

One task per wake (your core doctrine). The foundation is one task; each module is
one task — let that task's architect split it into goals. Do NOT fan out one task
per UI section; that is double-decomposition.

## Scope honesty (read before planning)

OpenCorvus has NO whole-site DFS crawler — its mirror tools are single-URL. You
cannot "crawl the whole site" in one task. Discover modules from the seed order
above plus the site's own navigation (you MAY `webfetch` the root page yourself to
read the nav for planning — that is research for your dispatch decision, not the
work). Each module is captured by giving its own URL to its own task's
design_analysis. If a module needs login/paid state or blocks automation, mark it
blocked in `frontier.md` and raise a `question` — do not churn redispatches.

## Done

Mission is done when every seeded module reached integrity=pass and the
integration/regression task passed. Write the final state into `handoff.md`.
