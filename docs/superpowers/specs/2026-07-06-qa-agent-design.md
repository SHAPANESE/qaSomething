# QA Agent — Design Spec

**Date:** 2026-07-06
**Status:** Design approved, implementation plan pending

---

## Guiding principle

Two axes — don't conflate them:

- **Lean in mechanisms/features:** no speculative subsystems added "just in case".
- **Robust in correctness and safety:** the foundations that make a test _actually useful_ and keep the agent from _breaking anything_ ship on day 1 — cheap now, extremely expensive to retrofit.

> "Robust" = correctness and safety foundations baked in from the start. It does NOT mean gold-plating or guessing abstractions before we've seen the engine run.

---

## Vision (the north star)

Code generation got 3-5x faster with AI, but **verification did not scale**. QA is now the dominant bottleneck of the AI era. This project is **the verification layer that runs at the speed code is now generated.**

The QA bottleneck isn't one problem — it's six:

1. **Writing tests** (slow, expensive E2E)
2. **Maintaining / auto-repairing tests** (flaky, breaking selectors) — _the biggest differentiator_
3. **Regression** (re-running everything each release)
4. **De-serializing the gate** (dev → waits for QA → long cycle)
5. **Coverage / unknowns** (what is NOT tested)
6. **Reproducing / triaging bugs** (vague report → hours)

**Core insight:** the six are NOT six products. They are **six missions for the same engine.** Build _one_ loop and _point_ it:

| Mission to the same agent          | Solves         |
| ---------------------------------- | -------------- |
| "Write a test for X"               | #1 Generate    |
| "This test broke, fix it"          | #2 Auto-repair |
| "Explore and find what's untested" | #5 Coverage    |
| "This test failed, why?"           | #6 Triage      |
| "Run everything and report"        | #3 Regression  |

Same idea that lets mini-swe-agent solve any coding task with a single loop: change the _task_, not the engine.

**Built staged, respecting dependencies** (you can't maintain/triage tests that don't exist yet). Order: **engine + Mission #1 first** (the foundation everything else attaches to) → #2 → #3/#5/#6 → #4 last (it's process/pipeline).

---

## Scope of THIS spec

Build **the engine** + its first mission (**#1 Generate tests**) + the **robustness foundations** (correctness and safety) + a **minimal eval harness** so we can measure and trust.

### Non-goals (explicit, for later)

- The other 5 missions (added as new prompts pointed at the same engine).
- The layered CI pipeline (Layer 1 deterministic / Layer 2 agentic / Layer 3 triage).
- The detailed selector auto-repair strategy (#2) — designed _after_ we've seen the engine run, not guessed now.
- History summarization/compaction for long runs (context rot) — added when the real problem shows up.
- Context preloading (the agent fetches what it needs via shell; we only tweak the prompt if it turns out myopic).
- Automatic ticket creation (Jira/GitHub Issues).

> **Anti-guessing note:** some things that sound "robust" (auto-repair, CI pipeline, history compaction) are deferred on purpose — building them now is _guessing_, and a wrong robust abstraction is worse than none. Robustness yes; guessing early no.

---

## Architecture: the loop

A single cycle, mini-swe-agent style:

```
1. The agent receives: the mission + the history of what it has done so far
2. It responds with ONE action: a shell command
3. The command runs (with guardrails, see below)
4. The output (stdout + stderr + exit code) is appended to the history
5. Back to 1 — until the agent emits the end signal ("DONE")
```

- **Action space:** a single action type — **one shell command.** No tool schemas, no function-calling. With shell the agent can already: read the repo (`cat`/`grep`/`ls`), start the app, run Playwright (`npx playwright test`), write `*.spec.ts`, and dump reports.
- **Observation:** observation _is_ the command output. If the agent wants to "see" the screen, its own Playwright script prints what it needs. No observation subsystem.
- **Context:** the agent manages it itself, fetching via shell. If it's myopic, the first fix is a line in the mission prompt, not code.

---

## Robustness on day 1 — correctness (make the test USEFUL)

The core LLM vice: they write tests that **always pass** (navigate, check it loaded, green). A test that never fails is **worse than no test**. Foundations against this:

1. **Proof the test catches bugs (mutation check).** IMPLEMENTED as a harness gate (`src/verify.ts`), not a matter of trust. For every real `X.spec.ts` the agent also writes a sibling `X.mutation.spec.ts`: same scenario and assertions, but the behavior is deliberately broken via Playwright network interception (`page.route`) — **no app-source edit**, so it respects the read-only guardrail. The harness runs both and checks **polarity**: real → PASS, mutation → FAIL. If the mutation still passes, the assertions are hollow and the test is **rejected**. This is the differentiator.

   **Oracle (resolved): expected behavior derives from a TICKET.** A `--ticket` reference (file now; Jira/GitHub provider later, `src/oracle.ts`) is injected as the source of truth. The agent tests against the ticket's acceptance criteria, NOT against the running app — which is what stops it from freezing current bugs as "correct". Without a ticket the CLI warns loudly.

2. **Meaningful assertions, not smoke tests.** The prompt biases toward verifying _behavior / acceptance criteria_, not "the page rendered".
3. **Semantic locators only.** `getByRole`, `getByLabel`, `getByText`, `data-testid`. No xpath, `nth-child`, or volatile text. Playwright auto-wait; **zero arbitrary `sleep`s.** (This is exactly the debt #2 would have to clean up — don't generate it.)
4. **Quarantine.** IMPLEMENTED (`src/verify.ts`): a freshly generated test isn't marked "trusted" until it runs N times (`config.reruns`, default 3) without flaking. Prevents polluting the suite.
5. **Evidence, not the agent's word.** What counts is the test file + a real run result. The agent's summary proves nothing; it may hallucinate that it tested something.

---

## Robustness on day 1 — safety (keep the agent from breaking anything)

The agent has shell → dangerous power. Guardrails from day 1:

6. **🚨 App source code = read-only.** Writes allowed **only** in `tests/` and `reports/`. A QA agent that edits the product to make its test go green **hides the bug** — forbidden. Enforced at the filesystem/permission level, not just by prompt.
7. **🚨 Sandboxed shell.** Runs **only against a local / test environment, NEVER prod.** Blocklist of dangerous commands (`rm -rf`, real sends, destructive mutations, network to non-allowed hosts). Per-command timeout.
8. **Reproducible environment.** Declared config for how to start the app clean: start command, test user, data seed, base URL. Without this the agent invents fragile workarounds.
9. **Step limit** on the loop (configurable) to cut infinite loops.

---

## The senior-QA criteria layer (the brain)

The mechanism (loop + guardrails) defines _how_ the agent acts. This layer defines _what it decides to test and why_ — it's what separates "an agent that writes a test" from someone with real craft. It is **content/knowledge, not mechanism** (fits the guiding principle: robust where it matters, no code complexity).

**Meta-criterion that governs everything:** a senior QA does NOT test everything equally — their #1 skill is **knowing what NOT to test.** Prioritize by **risk = impact × probability** (critical, most-used, recently-changed, historically-buggy). The criteria MUST drive prioritization first; otherwise the agent gold-plates (tests everything blindly), the exact opposite of a senior.

**Encoding:** a companion document — `qa-senior-criteria.md` (the "Senior QA Operating Manual") — that the agent loads and applies in **two phases** per mission:

1. **Prioritize:** given the goal and the risk, decide what's worth testing and what isn't.
2. **Apply** the techniques/heuristics/attributes _only to what was prioritized._

Anatomy of the criteria (full detail in the companion manual):

- **A. Meta:** risk-based prioritization (governs everything).
- **B. Scenarios:** happy path, negatives/errors, boundaries (empty/null/0/negative/max/long/unicode/special), state (auth/roles/flags), concurrency, idempotency, data integrity, interruptions.
- **C. Formal techniques:** equivalence partitioning, boundary value analysis, decision tables, state transition, pairwise, error guessing.
- **D. Cross-cutting attributes:** accessibility, security, performance, compatibility, i18n/l10n, error handling, usability.
- **E. Oracle:** validate against acceptance criteria + reasonable user expectation; question the spec itself.
- **F. Exploration heuristics:** SFDIPOT, CRUD per entity, "follow the data", Goldilocks, tours.
- **G. Criteria on the test itself:** independent, deterministic, single focus, contract-not-implementation, test pyramid.
- **H. Reporting:** severity vs priority, repro, evidence.

**Caveat (honest):** the manual captures a senior's _transferable methodology_. It does NOT capture the tacit knowledge of the app's _specific domain_ (where it historically breaks) — the agent infers that per repo.

**Impact on the eval harness:** evals verify not just "did it generate the test?" but "did it apply the right criteria?" (did it cover boundaries/negatives or only the happy path?, did it prioritize by risk?, did it question the spec?).

---

## Eval harness (inside the MVP)

You can't improve or trust what you don't measure. Minimal but present from the start:

- A small set of **known missions** with expected outcomes (e.g. "login test" over a fixture app with a planted bug and a healthy flow).
- Run the agent over them and **score**: did it generate the test?, does the test catch the planted bug?, did it use semantic locators?, did it pass the mutation check?, cost/steps within budget?
- It's the basis of the "QA of AI" skill and what lets us iterate the prompt with data, not blindly.

---

## Inputs and outputs

**Input:** natural-language instruction + repo path + environment config (start/creds/seed/URL).
**Output of a run:** one or more `*.spec.ts` (that passed quarantine + mutation check) in the repo, plus a summary with evidence at the end.

---

## Tech stack

- **Language:** TypeScript / Node — same ecosystem as the Playwright tests (one toolchain, one runtime, simple CI).
- **Model:** Claude via the **Vercel AI SDK** (thin _and_ provider-agnostic; starts on Claude/Opus, swappable in one line).
- **Testing tool:** Playwright.
- **Execution:** shell commands via `child_process`, with the guardrails above; portable and headless.

---

## Success criteria (MVP)

1. Given a simple mission over a real web app, the agent explores, starts the app, and writes at least one Playwright test that:
   - reflects real behavior and **catches a planted bug** (mutation check),
   - uses only semantic locators,
   - passes quarantine (no flaking across N runs).
2. Verifiable guardrails: the agent **cannot** write outside `tests/`/`reports/`, and **does not** run dangerous commands or touch prod.
3. The eval harness runs and yields a reproducible score over the known-mission set.
4. The loop is understandable (~150-250 core lines) and model-agnostic.
5. The same architecture lets us point the engine at a second mission (#2) by only changing the prompt, no redesign.

---

## Open questions / future

- Selector auto-repair strategy (#2) — designed with the engine already running.
- How a test "graduates" from quarantine into the deterministic Layer 1 of the pipeline.
- Bug-report format when it's added (#6).
- Context-rot point / when to compact history on long runs.
- How to plant bugs for the mutation check generically (mock vs. controlled temporary edit).
