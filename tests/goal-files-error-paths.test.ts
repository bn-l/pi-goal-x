/**
 * Tests for goal-files error paths: symlink rejection, corrupt/missing files,
 * and safe-path guards. These exercise branches not covered by the happy-path
 * tests in goal-files.test.ts.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { symlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  atomicWriteGoalFile,
  parseGoalFile,
  mergeGoalPromptFromDisk,
  serializeGoalFile,
  GOALS_DIR,
  isSafeRelativeUnder,
  safeUnlinkGoalFile,
  archiveGoalFile,
  extractObjectiveFromBody,
  readActiveGoalFiles,
} from "../extensions/storage/goal-files.ts";
import { createGoal } from "../extensions/goal-record.ts";
import type { GoalRecord } from "../extensions/goal-record.ts";

function makeGoal(overrides: Partial<GoalRecord> = {}): GoalRecord {
  return {
    id: "test-g1",
    objective: "Test objective",
    status: "active",
    sisyphus: false,
    autoContinue: true,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    usage: { tokensUsed: 0, activeSeconds: 0 },
    ...overrides,
  } as GoalRecord;
}

function tmpdirFixture() {
  const cwd = mkdtempSync(path.join(tmpdir(), "goal-fs-err-"));
  mkdirSync(path.join(cwd, ".pi", "goals", "archived"), { recursive: true });
  return { cwd, cleanup: () => { try { rmSync(cwd, { recursive: true, force: true }); } catch {} } };
}

test("atomicWriteGoalFile rejects symlinked target", () => {
  const { cwd, cleanup } = tmpdirFixture();
  try {
    const realPath = path.join(cwd, ".pi", "goals", "real.md");
    writeFileSync(realPath, "real content");
    const linkPath = path.join(cwd, ".pi", "goals", "active_goal_linked.md");
    symlinkSync(realPath, linkPath);

    assert.throws(
      () => atomicWriteGoalFile({ cwd }, GOALS_DIR, `${GOALS_DIR}/active_goal_linked.md`, "content"),
      /symlinked goal file/,
    );
  } finally {
    cleanup();
  }
});

test("parseGoalFile returns null for symlinked goal file", () => {
  const { cwd, cleanup } = tmpdirFixture();
  try {
    const target = path.join(cwd, ".pi", "goals", "real.md");
    writeFileSync(target, serializeGoalFile(makeGoal({ objective: "real" })));
    const link = path.join(cwd, ".pi", "goals", "active_goal_sym.md");
    symlinkSync(target, link);
    assert.equal(parseGoalFile(link), null);
  } finally {
    cleanup();
  }
});

test("parseGoalFile returns null for nonexistent file", () => {
  assert.equal(parseGoalFile("/tmp/definitely/does/not/exist.md"), null);
});

test("parseGoalFile returns null for unreadable content", () => {
  const { cwd, cleanup } = tmpdirFixture();
  try {
    // No JSON header at all — findJsonObjectEnd returns -1 → null
    const file = path.join(cwd, ".pi", "goals", "active_goal_nometa.md");
    writeFileSync(file, "just text, no json object header at all");
    assert.equal(parseGoalFile(file), null);
  } finally {
    cleanup();
  }
});

test("mergeGoalPromptFromDisk returns current when file read fails", () => {
  const g = makeGoal({ activePath: ".pi/goals/nonexistent.md" });
  const result = mergeGoalPromptFromDisk({ cwd: "/nonexistent/path" }, g);
  assert.equal(result.objective, g.objective);
});

test("mergeGoalPromptFromDisk returns current on corrupt parse", () => {
  const { cwd, cleanup } = tmpdirFixture();
  try {
    const file = path.join(cwd, ".pi", "goals", "active_goal_corrupt.md");
    writeFileSync(file, "{corrupt");
    const g = makeGoal({ activePath: ".pi/goals/active_goal_corrupt.md" });
    const result = mergeGoalPromptFromDisk({ cwd }, g);
    assert.equal(result.objective, g.objective);
  } finally {
    cleanup();
  }
});

test("mergeGoalPromptFromDisk returns current when path is not safe", () => {
  const g = makeGoal(); // no activePath → isSafeActivePath returns false
  const result = mergeGoalPromptFromDisk({ cwd: "/tmp" }, g);
  assert.equal(result.objective, g.objective);
});

test("isSafeRelativeUnder rejects absolute path", () => {
  assert.equal(isSafeRelativeUnder({ cwd: "/tmp" }, ".pi/goals", "/etc/passwd"), false);
});

test("isSafeRelativeUnder rejects null byte injection", () => {
  assert.equal(isSafeRelativeUnder({ cwd: "/tmp" }, ".pi/goals", "safe\0.md"), false);
});

test("isSafeRelativeUnder rejects parent traversal", () => {
  assert.equal(isSafeRelativeUnder({ cwd: "/tmp" }, ".pi/goals", "../outside.md"), false);
});

test("isSafeRelativeUnder rejects path outside the root directory", () => {
  const { cwd, cleanup } = tmpdirFixture();
  try {
    // A path that resolves outside .pi/goals after normalization
    assert.equal(isSafeRelativeUnder({ cwd }, ".pi/goals", ".pi/settings.json"), false);
  } finally {
    cleanup();
  }
});

test("readActiveGoalFiles returns empty array when goals dir is a symlink", () => {
  const { cwd, cleanup } = tmpdirFixture();
  try {
    const goalsDir = path.join(cwd, ".pi", "goals");
    const realDir = path.join(cwd, ".pi", "real_goals");
    mkdirSync(realDir, { recursive: true });
    rmSync(goalsDir, { recursive: true, force: true });
    symlinkSync(realDir, goalsDir);
    assert.deepEqual(readActiveGoalFiles({ cwd }), []);
  } finally {
    cleanup();
  }
});

test("readActiveGoalFiles returns empty array for missing directory", () => {
  assert.deepEqual(readActiveGoalFiles({ cwd: "/no/such/dir" }), []);
});

test("extractObjectiveFromBody handles body without Goal Prompt header", () => {
  assert.equal(extractObjectiveFromBody("  plain text  "), "plain text");
  assert.equal(extractObjectiveFromBody(""), undefined);
});

test("extractObjectiveFromBody stops at ## Progress section", () => {
  const body = "# Goal Prompt\nDo the work\n\n## Progress\nStatus: active";
  assert.equal(extractObjectiveFromBody(body), "Do the work");
});
