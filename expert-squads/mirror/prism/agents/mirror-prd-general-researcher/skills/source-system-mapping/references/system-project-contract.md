# System-project discovery contract

## Inputs and evidence

Require the authorized product boundary, entry URL, desktop viewport, repository path, and available
source material. Observe the entry route and every linked candidate needed to understand and complete the same
product subsystem. Capture canonical URL, route pattern, page/template family, business purpose,
navigation relation, shared shell/data/state relationship, access limitation, observation time, and
screenshot or extracted evidence for each candidate. Separately identify the independently
implementable delivery surfaces established by those facts. A delivery surface is one shared
template, behavior, state, and ownership boundary; concrete URLs that differ only in parameterized
content remain distinct route evidence but belong to the same surface.

## Candidate decisions

Classify every candidate as accepted, duplicate-template, outside product boundary, external,
non-product/legal/help, unreachable, or insufficiently evidenced. Accept a route only when it is
independently useful and material evidence establishes its role. Do not impose the source prompt's
historical three-subpage cap: the acquired material is the only route-count authority.

An associated subpage is closure-required when material evidence shows it completes a business
capability, owns a shared-state continuation, supplies a required navigation step, or participates
in an executable user journey. The entry page is not a delivery boundary. A one-route closure is
valid only when evidence proves that no associated route is required for the requested capability.

## Canonical artifact

Write `.mirror/prd/tmp/system-project-contract.json` with:

- system identity, product goal, authorized boundary, entry route and observation parameters;
- one ledger row per discovered candidate with decision, reason and evidence references;
- `subsystem_closure` with canonical entry route, exact member surface/route IDs, one
  evidence-backed closure reason per member, shared shell/data/state/service capabilities,
  required navigation edges, supported deep-link and return paths, material end-to-end journeys,
  and unresolved closure gaps;
- accepted stable route IDs, canonical URLs, route patterns, page families and business purposes;
- `delivery_surfaces` with stable surface IDs, route pattern/template family, shared
  structure/behavior/state/ownership evidence, and the complete member route-ID set;
- directed route graph and every observed cross-route transition;
- shared shell, navigation, components, data/state services, global states and error/recovery rules;
- material-defined user journeys with steps, routes, states and evidence anchors;
- `competitor_patterns` with stable competitor identity, exact source and access context, observed
  fact, separately labelled inference, applicable target job or route, and adopt/defer/reject
  disposition. These rows derive from the completely read and selected same-Task
  `prism/source-observation` Artifact;
- route-specific source screenshots/raw captures and known limitations.

Populate only facts supported by acquired evidence. Optional relationships, states, journeys, regions,
screenshots, template details, and recovery rules may remain absent when they were not observed and
are not needed for executable acceptance. Record that limitation; do not invent a value to satisfy
apparent field completeness. A required identity, accepted-route evidence ref, delivery-surface
membership, or owned output path remains mandatory because downstream work cannot resolve its owner
without it.

Every accepted route ID must belong to exactly one delivery surface and to the subsystem closure,
and every surface must cite
material evidence for its grouping. Do not group by URL-name keywords, impose a surface quota, or
erase route-specific content, screenshots, states, or journey evidence.

Publish a durable Task Artifact containing the resource locator/digest, candidate count, accepted route identities, subsystem-closure members/reasons,
delivery-surface identities and membership, competitor dispositions, exclusion counts and blockers.
Do not create Product Requirements Documents or infer missing routes from common website conventions.
