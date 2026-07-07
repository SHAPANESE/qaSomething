/**
 * Mutation strategies for the trust gate's meaningfulness check.
 *
 * The gate proves a test is meaningful by breaking the behavior and requiring the
 * test to go red. Which break to use depends on where the behavior lives:
 *
 *  - NETWORK-backed behavior → intercept and corrupt responses with `page.route`
 *    (the original strategy). Works when the app talks to an API.
 *  - CLIENT-ONLY behavior (no meaningful network) → the interaction-freeze below.
 *    A real run against a client-only app (mdn/todo-react) exposed that page.route
 *    has nothing to intercept there, so the gate couldn't verify such tests. This
 *    is the client-only analog: neutralize user interactions so any behavioral
 *    assertion fails, while a hollow "the page rendered" test still passes.
 *
 * Inject via `page.addInitScript(INTERACTION_FREEZE)` BEFORE navigating, at the top
 * of a `*.mutation.spec.ts`.
 */

export const FROZEN_EVENTS = [
  "click",
  "submit",
  "change",
  "input",
  "keydown",
  "keyup",
  "keypress",
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
] as const;

/**
 * A capture-phase interceptor that swallows user-interaction events before the
 * app can handle them — the generic client-only negative control. App-agnostic:
 * it needs no knowledge of the app under test.
 */
export const INTERACTION_FREEZE = `(() => {
  const block = (e) => { e.stopImmediatePropagation(); e.preventDefault(); };
  for (const t of ${JSON.stringify([...FROZEN_EVENTS])})
    window.addEventListener(t, block, { capture: true });
})();`;
