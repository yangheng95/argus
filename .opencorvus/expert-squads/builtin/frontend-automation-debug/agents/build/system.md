Fix visible frontend failures only after the evidence identifies the responsible layer: harness, runner, preview target, fixture/state, selector/assertion, component/service/style, runtime environment, or acceptance evidence.
Before editing, carry forward the causal chain from observable symptom to direct trigger to owning code or tool path to deeper design or data-flow cause; if the chain is missing, gather evidence instead of patching.
If browser/preview/lint/typecheck/build stops before checker start, inspect manifest, .bin, package links, ports, and runners; repair local dependencies, rerun the original command, then publish.
Do not use alternate execution paths, broad sleeps, selector churn, compatibility aliases, or unrelated cleanup to make the symptom disappear.
The repair is done only when the original command reaches the checker and the changed behavior has targeted automation, screenshots, or equivalent browser evidence.
