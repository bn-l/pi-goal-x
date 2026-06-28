/**
 * Tests for buildGoalCompactSummary event-type formatting.
 * Fills coverage gaps for the switch cases that the existing
 * goal-compaction.test.ts doesn't exercise.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildGoalCompactSummary } from "../extensions/goal-compaction.ts";
import type { GoalLedgerEvent } from "../extensions/goal-ledger.ts";
import type { GoalRecord } from "../extensions/goal-record.ts";

function goal(): GoalRecord {
  return {
    id: "g1",
    objective: "Test goal",
    status: "active",
    sisyphus: false,
    autoContinue: true,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    usage: { tokensUsed: 0, activeSeconds: 0 },
  } as GoalRecord;
}

function event(type: GoalLedgerEvent["type"], overrides: Partial<GoalLedgerEvent> = {}): GoalLedgerEvent {
  return { type, goalId: "g1", at: "2026-06-01T00:00:00Z", ...overrides } as GoalLedgerEvent;
}

test("formats goal_tweaked event", () => {
  const result = buildGoalCompactSummary(goal(), [
    event("goal_tweaked", { changeSummary: "reduced scope to core" }),
  ]);
  assert.ok(result.includes("tweaked: reduced scope to core"));
});

test("formats goal_completed event", () => {
  const result = buildGoalCompactSummary(goal(), [event("goal_completed")]);
  assert.ok(result.includes("completed"));
});

test("formats task_list_set with blockCompletion=true", () => {
  const result = buildGoalCompactSummary(goal(), [
    event("task_list_set", { taskCount: 3, blockCompletion: true }),
  ]);
  assert.ok(result.includes("task list set: 3 tasks (blocking)"));
});

test("formats task_list_set with blockCompletion=false", () => {
  const result = buildGoalCompactSummary(goal(), [
    event("task_list_set", { taskCount: 5, blockCompletion: false }),
  ]);
  assert.ok(result.includes("task list set: 5 tasks"));
  assert.ok(!result.includes("(blocking)"));
});

test("formats task_complete with evidence", () => {
  const result = buildGoalCompactSummary(goal(), [
    event("task_complete", { taskId: "t-verify", evidence: "all 42 tests pass" }),
  ]);
  assert.ok(result.includes("task complete: t-verify"));
  assert.ok(result.includes("all 42 tests pass"));
});

test("formats task_skipped with reason", () => {
  const result = buildGoalCompactSummary(goal(), [
    event("task_skipped", { taskId: "t-skip", reason: "out of scope per user" }),
  ]);
  assert.ok(result.includes("task skipped: t-skip"));
  assert.ok(result.includes("out of scope per user"));
});

test("formats goal_aborted event", () => {
  const result = buildGoalCompactSummary(goal(), [
    event("goal_aborted", { reason: "blocked by missing dependency" }),
  ]);
  assert.ok(result.includes("aborted: blocked by missing dependency"));
});
