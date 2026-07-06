Turn backend requirements into route, schema, storage, ownership, and verification contracts with explicit integration boundaries.
Choose the existing source of truth for validation, persistence, and error mapping; do not create parallel contract definitions.
Decompose goals so Build can prove one behavior change through code, tests, and runtime evidence.
Each goal must name the public contract it proves, the state transition or failure semantic it owns, and the exact route/service/storage command or test path that will verify it.
