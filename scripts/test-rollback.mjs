/**
 * Tests for P0 security fixes in exec rollback.
 * - diff apply failure does NOT overwrite target file
 * - rollback restores nested path files
 * - rollback deletes new files (existed===false)
 *
 * Run: node scripts/test-rollback.mjs
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

const cli = resolve(import.meta.dirname, "..", "dist", "index.js");
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { passed++; }
  else { failed++; console.error("FAIL:", label); }
}

function run(args, cwd) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"]
  });
}

// ── Test 1: rollback restores nested path files ──────────────────────────
{
  const fixture = mkdtempSync(join(tmpdir(), "codetalk-rollback-nested-"));
  try {
    execFileSync("git", ["init"], { cwd: fixture, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: fixture, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: fixture, stdio: "pipe" });

    mkdirSync(join(fixture, "src", "a", "b"), { recursive: true });
    writeFileSync(join(fixture, "src", "a", "b", "file.ts"), "original content\n", "utf8");
    execFileSync("git", ["add", "-A"], { cwd: fixture, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: fixture, stdio: "pipe" });

    // Create backup with nested path
    const backupDir = join(fixture, ".codetalk", "backups", "test-nested");
    mkdirSync(join(backupDir, "src", "a", "b"), { recursive: true });
    copyFileSync(join(fixture, "src", "a", "b", "file.ts"), join(backupDir, "src", "a", "b", "file.ts"));
    writeFileSync(join(backupDir, "manifest.json"), JSON.stringify({
      createdAt: new Date().toISOString(),
      repoRoot: fixture,
      files: [{ filePath: "src/a/b/file.ts", existed: true, backupPath: "src/a/b/file.ts" }]
    }), "utf8");

    // Modify the file
    writeFileSync(join(fixture, "src", "a", "b", "file.ts"), "modified content\n", "utf8");

    // Rollback
    run(["rollback", "test-nested"], fixture);

    const restored = readFileSync(join(fixture, "src", "a", "b", "file.ts"), "utf8");
    assert(restored === "original content\n", "nested file restored to original content");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

// ── Test 2: rollback deletes new files (existed===false) ─────────────────
{
  const fixture = mkdtempSync(join(tmpdir(), "codetalk-rollback-new-"));
  try {
    execFileSync("git", ["init"], { cwd: fixture, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: fixture, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: fixture, stdio: "pipe" });
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: fixture, stdio: "pipe" });

    mkdirSync(join(fixture, "src"), { recursive: true });
    writeFileSync(join(fixture, "src", "new_file.py"), "# created by exec\n", "utf8");

    const backupDir = join(fixture, ".codetalk", "backups", "test-newfile");
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(join(backupDir, "manifest.json"), JSON.stringify({
      createdAt: new Date().toISOString(),
      repoRoot: fixture,
      files: [{ filePath: "src/new_file.py", existed: false, backupPath: null }]
    }), "utf8");

    run(["rollback", "test-newfile"], fixture);
    assert(!existsSync(join(fixture, "src", "new_file.py")), "new file deleted by rollback");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

// ── Test 3: diff apply failure does not overwrite target file ────────────
{
  const fixture = mkdtempSync(join(tmpdir(), "codetalk-diff-fail-"));
  try {
    execFileSync("git", ["init"], { cwd: fixture, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: fixture, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: fixture, stdio: "pipe" });
    writeFileSync(join(fixture, "main.py"), "x = 1\n", "utf8");
    execFileSync("git", ["add", "-A"], { cwd: fixture, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: fixture, stdio: "pipe" });

    const original = readFileSync(join(fixture, "main.py"), "utf8");

    try {
      execFileSync("git", ["apply", "--check", "-"], {
        cwd: fixture,
        input: "--- a/main.py\n+++ b/main.py\n@@ -1 +1 @@\n-invalid\n",
        stdio: ["pipe", "pipe", "pipe"], encoding: "utf8"
      });
      assert(false, "invalid diff should fail check");
    } catch {
      const after = readFileSync(join(fixture, "main.py"), "utf8");
      assert(after === original, "file content unchanged after failed diff apply");
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
