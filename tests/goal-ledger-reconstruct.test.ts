/**
 * Tests that exercise reconstructGoalLedger through more event-type
 * combinations, covering the switch branches that the existing
 * goal-ledger.test.ts doesn't trigger.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { reconstructGoalLedger, type GoalLedgerEvent } from "../extensions/goal-ledger.ts";

function evt(type: GoalLedgerEvent["type"], overrides: Partial<GoalLedgerEvent> = {}): GoalLedgerEvent {
  return { type, goalId: "g1", at: "2026-06-01T00:00:00Z", ...overrides } as GoalLedgerEvent;
}

test("reconstructGoalLedger: goal_created + goal_tweaked + goal_completed chain", () => {
  const result = reconstructGoalLedger([
    evt("goal_created", { goalId: "g1" }),
    evt("goal_tweaked", { goalId: "g1", changeSummary: "scope narrowed" }),
    evt("goal_completed", { goalId: "g1" }),
  ]);
  assert.ok(result.terminalGoals.has("g1"));
});

test("reconstructGoalLedger: goal_created + goal_aborted chain", () => {
  const result = reconstructGoalLedger([
    evt("goal_created", { goalId: "g1" }),
    evt("goal_aborted", { goalId: "g1", reason: "blocked" }),
  ]);
  assert.ok(result.terminalGoals.has("g1"));
});

test("reconstructGoalLedger: goal_focused then goal_unfocused clears focus", () => {
  const result = reconstructGoalLedger([
    evt("goal_created", { goalId: "g1" }),
    evt("goal_focused", { goalId: "g1", reason: "selected" }),
    evt("goal_unfocused", { reason: "switched" }),
  ]);
  assert.equal(result.focusedGoalId, null);
});

test("reconstructGoalLedger: goal_paused with suggestedAction", () => {
  const result = reconstructGoalLedger([
    evt("goal_created", { goalId: "g1" }),
    evt("goal_paused", { goalId: "g1", reason: "stuck", suggestedAction: "ask user for path" }),
  ]);
  const g1 = result.goals.get("g1");
  assert.ok(g1);
  assert.equal(g1.latestStatus, "paused");
});

test("reconstructGoalLedger: goal_resumed then completed", () => {
  const result = reconstructGoalLedger([
    evt("goal_created", { goalId: "g1" }),
    evt("goal_resumed", { goalId: "g1", reason: "user" }),
    evt("goal_completed", { goalId: "g1" }),
  ]);
  assert.ok(result.terminalGoals.has("g1"));
});

test("reconstructGoalLedger: completion_requested keeps goal open", () => {
  const result = reconstructGoalLedger([
    evt("goal_created", { goalId: "g1" }),
    evt("completion_requested", { goalId: "g1", summary: "ready for review" }),
  ]);
  assert.ok(result.goals.has("g1"));
  assert.equal(result.terminalGoals.size, 0);
});

test("reconstructGoalLedger: audit_started, audit_result approved, goal_completed", () => {
  const result = reconstructGoalLedger([
    evt("goal_created", { goalId: "g1" }),
    evt("audit_started", { goalId: "g1" }),
    evt("audit_result", { goalId: "g1", verdict: "approved", report: "looks good" }),
    evt("goal_completed", { goalId: "g1" }),
  ]);
  assert.ok(result.terminalGoals.has("g1"));
  const state = result.terminalGoals.get("g1");
  assert.equal(state?.latestAuditorResult?.verdict, "approved");
});

test("reconstructGoalLedger: audit_result disapproved keeps goal open", () => {
  const result = reconstructGoalLedger([
    evt("goal_created", { goalId: "g1" }),
    evt("audit_result", { goalId: "g1", verdict: "disapproved", report: "needs more work" }),
  ]);
  assert.ok(result.goals.has("g1"));
  const state = result.goals.get("g1");
  assert.equal(state?.latestAuditorResult?.verdict, "disapproved");
});

test("reconstructGoalLedger: audit_result error variant", () => {
  const result = reconstructGoalLedger([
    evt("goal_created", { goalId: "g1" }),
    evt("audit_result", { goalId: "g1", verdict: "error", report: "timeout" }),
  ]);
  const state = result.goals.get("g1");
  assert.equal(state?.latestAuditorResult?.verdict, "error");
});

test("reconstructGoalLedger: audit_skipped with disabled reason", () => {
  const result = reconstructGoalLedger([
    evt("goal_created", { goalId: "g1" }),
    evt("audit_skipped", { goalId: "g1", reason: "disabled" }),
  ]);
  assert.ok(result.goals.has("g1"));
});

test("reconstructGoalLedger: task_list_set with blockCompletion true", () => {
  const result = reconstructGoalLedger([
    evt("goal_created", { goalId: "g1" }),
    evt("task_list_set", { goalId: "g1", taskCount: 4, blockCompletion: true }),
  ]);
  assert.ok(result.goals.has("g1"));
});

test("reconstructGoalLedger: task_complete with evidence", () => {
  const result = reconstructGoalLedger([
    evt("goal_created", { goalId: "g1" }),
    evt("task_complete", { goalId: "g1", taskId: "t1", evidence: "all tests green" }),
  ]);
  assert.ok(result.goals.has("g1"));
});

test("reconstructGoalLedger: task_skipped with reason", () => {
  const result = reconstructGoalLedger([
    evt("goal_created", { goalId: "g1" }),
    evt("task_skipped", { goalId: "g1", taskId: "t2", reason: "out of scope" }),
  ]);
  assert.ok(result.goals.has("g1"));
});

test("reconstructGoalLedger: event after terminal status is ignored", () => {
  // Once a goal is completed, further events for it should not resurrect it
  const result = reconstructGoalLedger([
    evt("goal_created", { goalId: "g1" }),
    evt("goal_completed", { goalId: "g1" }),
    evt("goal_resumed", { goalId: "g1", reason: "mistake" }),
  ]);
  assert.ok(result.terminalGoals.has("g1"));
  assert.ok(!result.goals.has("g1")); // should NOT be in open goals
});
