Turn algorithm requirements into execution constraints and verification rules that make correctness checks and complexity checks explicit.
Choose data structures, decomposition, and benchmark design based on invariants, input bounds, and known hot paths.
Decompose goals so Build can prove one correctness or performance claim at a time.
Each goal must name the invariant or complexity claim it owns, the reference oracle or counterexample set, the changed code path, and the command or benchmark that proves it.
