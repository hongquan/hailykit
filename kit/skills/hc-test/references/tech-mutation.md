# Mutation Testing

Mutation testing seeds small code mutations (flipped conditionals, boundary shifts, removed statements) and reruns the test suite against each mutant. A mutant that still passes = a **surviving mutant** = a gap the test suite cannot detect. Mutation score (killed / total mutants) is the honest signal on whether tests assert real behavior — line/branch coverage only proves code ran, not that it was checked.

This runs the user's own project tooling (Stryker, mutmut, cargo-mutants, go-mutesting). HailyKit ships no mutation engine and adds no dependency — these are commands to run, not a bundled tool.

## When to Run

Nightly, pre-merge on critical-path modules, or on explicit request — never the inner loop. Killing mutants is slow (each mutant reruns the full suite); running it per red-green cycle stalls the loop for no proportional gain. Treat `--mutation` as a periodic quality audit, not a step in `{skill:hc-test}`'s standard pipeline.

## Tool Detection

Read the project's own config before assuming defaults — most repos already scope mutation runs to a subset of files.

| Language | Config signal | Tool |
|----------|---------------|------|
| JS/TS | `stryker.conf.js`, `stryker.conf.json`, `.stryker.conf.mjs` | Stryker Mutator |
| Python | `setup.cfg` `[mutmut]`, `pyproject.toml` `[tool.mutmut]` | mutmut |
| Rust | `Cargo.toml` (no dedicated section; check for `cargo-mutants` in dev workflow) | cargo-mutants |
| Go | no standard config file; check CI workflows for `go-mutesting` invocation | go-mutesting |

No config found → fall back to running the tool against the critical-path scope below with its default settings, and note in the report that no project-level mutation config exists yet.

## Stryker (JS/TS)

```bash
npx stryker init                          # one-time: generates stryker.conf.json
npx stryker run                           # full run per stryker.conf mutate globs
npx stryker run --mutate "src/auth/**/*.ts"   # scoped run
```

Reads `mutate` glob, `thresholds` (high/low/break), and test runner (Jest/Vitest/Mocha) from `stryker.conf.json`. Report: `reports/mutation/mutation.html` + JSON summary with per-file mutation score.

## mutmut (Python)

```bash
pip install mutmut                        # project dev dependency, not a kit dependency
mutmut run --paths-to-mutate=src/auth/    # scoped run
mutmut results                            # list survived/killed mutants
mutmut show <id>                          # inspect a specific surviving mutant's diff
```

Reads `[tool.mutmut]` in `pyproject.toml` (or `[mutmut]` in `setup.cfg`) for `paths_to_mutate` and test command. No config → pass `--paths-to-mutate` explicitly per the scoping heuristic below.

## Other Languages

```bash
# Rust — cargo-mutants
cargo install cargo-mutants
cargo mutants --file src/auth/*.rs

# Go — go-mutesting
go install github.com/avito-tech/go-mutesting/cmd/go-mutesting@latest
go-mutesting ./internal/auth/...
```

Both are less mature than Stryker/mutmut — expect slower runs and coarser scoping; read the tool's own README for the current invocation before trusting the commands above verbatim.

## Critical-Path Scoping

Full-repo mutation runs are prohibitively slow. Scope to modules where a silent logic bug has outsized cost:

- **Policy / validation** — authorization checks, input validators, business rule engines
- **Orchestrators** — workflow/state-machine code coordinating multiple steps
- **Auth** — login, session, token issuance/verification
- **Payment** — pricing, billing, transaction handling

Everything else (UI rendering, formatting, glue code) is lower priority for mutation testing — line/branch coverage from the standard `{skill:hc-test}` pipeline is sufficient signal there.

## Interpreting the Score

- **Mutation score** = killed mutants / total mutants. Read it per-module, not as a single repo-wide number — a critical module at 60% is a different risk than a formatting utility at 60%.
- **Surviving mutant** = the test suite ran but did not assert the right thing. This is a finding about the *test*, not a bug in the mutated code — the mutation is synthetic. Report survivors as weak/assertion-free tests to strengthen, not as production defects.
- Do not auto-fix survivors. Report the surviving mutant's diff (`mutmut show <id>` / Stryker HTML report) and the test file that should have caught it; let the follow-up work (a `{skill:hc-cook}` pass or manual fix) add the missing assertion.
- A rising mutation score over time on the same critical-path scope is the trend to track — a single run's absolute number matters less than whether it improves after tests are strengthened.
