# Algorithm Selector

Use `select_expert_squad` with `profile_id` `algorithm` when the user's request depends on algorithmic correctness, complexity, numerical semantics, reproducible benchmark evidence, or adversarial counterexample handling.

## Activation Criteria

Select this expert squad when the task includes any of these surfaces:

1. Designing or repairing an algorithm, data structure, solver, ranking rule, scheduler heuristic, matching rule, parser, optimizer, simulation, numeric calculation, or statistical method.
2. Proving time or memory complexity, precision, overflow behavior, convergence, monotonicity, ordering, graph properties, recurrence behavior, or probabilistic assumptions.
3. Building tests where a reference oracle, brute-force checker, property test, independently derived expected values, or adversarial input generator is needed.
4. Investigating performance regressions where benchmark inputs, variance, thresholds, and hot-path ownership matter.

Do not select this squad just because a task mentions "logic" or "bug" if the acceptance is primarily UI layout, API state semantics, documentation, package wiring, or test-process quality.

## Expert Contract

An expert algorithm result must include a falsifiable correctness model:

1. Claim boundary: state the function, data shape, input domain, output guarantee, and numeric or ordering semantics that must hold.
2. Invariant model: name the invariants, monotonicity, conservation rules, recurrence, graph property, probabilistic assumption, or precision rule the implementation depends on.
3. Oracle and counterexample discipline: use a reference method, mathematical proof sketch, brute-force checker, property test, or independently derived expected values; include adversarial and boundary inputs that could falsify the claim.
4. Complexity account: tie time and memory bounds to input variables, selected data structures, and hot paths.
5. Measurement proof: when performance matters, provide reproducible benchmark inputs, command, environment notes, and threshold interpretation.
6. Implementation ownership: identify the code path that owns the algorithm and remove or update obsolete branches touched by the change.
7. Acceptance proof: connect implementation, tests, adversarial cases, and benchmark or proof obligations to the original claim.

Do not accept an algorithm result that only passes happy-path examples, lacks a reference oracle, ignores precision or overflow behavior, claims complexity without proof or measurement, or verifies a narrower behavior than the requested algorithm.

## Orchestrator Protocol

After selecting this squad, preserve the visible protocol:

1. Keep `prompt_profile.active` as the only active expert-squad source.
2. Dispatch only existing OpenCorvus workflow roles projected by this package.
3. Require Requirements, Architect, Build, and Integrity work to carry the claim boundary, invariant model, oracle, adversarial cases, and proof evidence forward.
4. If evidence shows the task is not algorithmic, say so and choose a more appropriate visible expert squad instead of stretching this profile.
