/**
 * Small focused tests for branches not yet exercised by existing per-module tests.
 * Each test targets a specific real behavior, not just coverage enumeration.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { parseGoalFile, mergeGoalPromptFromDisk } from "../extensions/storage/goal-files.ts";
import {
  buildDraftConfirmationText,
  buildTweakConfirmationText,
} from "../extensions/goal-draft.ts";
import { buildCompletionReport } from "../extensions/goal-policy.ts";
import { normalizeGoalRecord } from "../extensions/goal-record.ts";
import { isAuditorEnabledByDefault } from "../extensions/goal-settings.ts";
import { goalPrompt } from "../extensions/prompts/goal-prompts.ts";

// ─── parseGoalFile: JSON body that can't be parsed ─────────────────────────

test("parseGoalFile returns null when JSON header is unparseable even though braces match", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "goal-jsonfail-"));
  mkdirSync(path.join(cwd, ".pi", "goals", "archived"), { recursive: true });
  try {
    // findJsonObjectEnd finds matching braces, but the content isn't valid JSON
    const file = path.join(cwd, ".pi", "goals", "active_goal_badjson.md");
    writeFileSync(file, `{"id": "g1", broken: } }\n# Goal Prompt\nhello`);
    const result = parseGoalFile(file);
    assert.equal(result, null);
  } finally {
    try { rmSync(cwd, { recursive: true, force: true }); } catch {}
  }
});

// ─── goal-draft: pipe-prefix formatting ────────────────────────────────────

test("buildDraftConfirmationText preserves pipe-prefixed lines as-is", () => {
  const result = buildDraftConfirmationText({
    focus: "goal",
    originalTopic: "Test topic",
    objective: "=== Goal ===\nObjective: Do it\n\n\u2502 already formatted line\n- new bullet",
    autoContinue: true,
  });
  // Pipe-prefixed lines preserved without extra indent
  assert.ok(result.includes("\u2502 already formatted line"));
  // Regular lines get indent prefix
  assert.ok(result.includes("\u2502   - new bullet"));
});

test("buildTweakConfirmationText preserves pipe-prefixed lines", () => {
  const result = buildTweakConfirmationText({
    currentObjective: "=== Goal ===\nObjective: Old\n\n\u2502 kept line\n- old bullet",
    changeSummary: "updated scope",
    newObjective: "=== Goal ===\nObjective: New\n\n\u2502 new pipe line\n- new bullet",
  });
  assert.ok(result.includes("\u2502 kept line"));
  assert.ok(result.includes("\u2502 new pipe line"));
  assert.ok(result.includes("\u2502   - old bullet"));
  assert.ok(result.includes("\u2502   - new bullet"));
});

// ─── buildCompletionReport: task summary branch ────────────────────────────

test("buildCompletionReport includes task summary when provided", () => {
  const result = buildCompletionReport({
    summary: "Done",
    taskSummary: "5/5 tasks complete",
    detailedSummary: "All work finished successfully.",
    auditorReport: undefined,
    auditSkippedReason: undefined,
  });
  assert.ok(result.includes("Task summary: 5/5 tasks complete"));
});

test("buildCompletionReport omits task summary when empty", () => {
  const result = buildCompletionReport({
    summary: "Done",
    taskSummary: "",
    detailedSummary: "Finished.",
    auditorReport: undefined,
    auditSkippedReason: undefined,
  });
  assert.ok(!result.includes("Task summary:"));
});

// ─── normalizeGoalRecord: paused + autoContinue → active ───────────────────

test("normalizeGoalRecord upgrades paused to active when autoContinue is true", () => {
  const raw = {
    id: "g-reactivate",
    objective: "Reactivation test",
    status: "paused",
    autoContinue: true,
    createdAt: "2026-06-01T00:00:00Z",
    tasks: [],
  };
  const result = normalizeGoalRecord(raw);
  assert.equal(result.status, "active");
});

test("normalizeGoalRecord keeps paused when autoContinue is false", () => {
  const raw = {
    id: "g-stay-paused",
    objective: "Stay paused",
    status: "paused",
    autoContinue: false,
    createdAt: "2026-06-01T00:00:00Z",
    tasks: [],
  };
  const result = normalizeGoalRecord(raw);
  assert.equal(result.status, "paused");
});

// ─── isAuditorEnabledByDefault ─────────────────────────────────────────────

test("isAuditorEnabledByDefault: true when no disabled field", () => {
  assert.equal(isAuditorEnabledByDefault({}), true);
  assert.equal(isAuditorEnabledByDefault({ disabled: false }), true);
});

test("isAuditorEnabledByDefault: false when disabled=true", () => {
  assert.equal(isAuditorEnabledByDefault({ disabled: true }), false);
});

// ─── goalPrompt: per-task verification contract rendering ──────────────────

test("goalPrompt renders contract line for pending task with verificationContract", () => {
  const goal: any = {
    id: "g-contract",
    objective: "Verify this",
    status: "active",
    sisyphus: false,
    autoContinue: true,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    usage: { tokensUsed: 0, activeSeconds: 0 },
    taskList: {
      tasks: [
        { id: "t1", title: "Build feature", status: "pending", verificationContract: "Must pass all tests" },
      ],
      blockCompletion: false,
      proposedAt: "now",
    },
  };
  const result = goalPrompt(goal, { disabled: false, disableTasks: false, disableContracts: false, subtaskDepth: 1 });
  // The per-task contract renders as a sub-line under the task
  assert.ok(result.includes("contract: Must pass all tests"));
});

// ─── mergeGoalPromptFromDisk: catch when activePath is not safe ────────────

test("mergeGoalPromptFromDisk returns current when activePath is unsafe", () => {
  const goal: any = { id: "g1", objective: "original", activePath: undefined };
  const result = mergeGoalPromptFromDisk({ cwd: "/tmp" }, goal);
  assert.equal(result.objective, "original");
});
