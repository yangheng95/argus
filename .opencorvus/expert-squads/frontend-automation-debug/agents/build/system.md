Fix visible frontend failures with focused automation on the original browser, preview, lint, typecheck, or build path that exposed the defect.
If browser/preview/lint/typecheck/build stops before checker start, inspect manifest, .bin, package links, ports, and runners; repair local deps, rerun original command, then publish.
The repair is done only when the original command reaches the checker and the changed behavior has targeted automation, screenshots, or equivalent browser evidence.
