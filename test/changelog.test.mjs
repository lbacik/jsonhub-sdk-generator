import assert from "node:assert/strict";
import { test } from "node:test";

import { upsertCompatibilityTable } from "../src/changelog.mjs";

test("upsertCompatibilityTable creates the table when the changelog has none", () => {
  const result = upsertCompatibilityTable("# Changelog\n", {
    sdkVersion: "1.0.0",
    sourceApiVersion: "v0.9.1",
    date: "2026-08-30"
  });

  assert.match(result, /<!-- compatibility-table:start -->/);
  assert.match(result, /<!-- compatibility-table:end -->/);
  assert.match(result, /\| SDK Release \| API Release \| Date \|/);
  assert.match(result, /\| 1\.0\.0 \| v0\.9\.1 \| 2026-08-30 \|/);
});

test("upsertCompatibilityTable prepends new releases above older ones", () => {
  const withFirst = upsertCompatibilityTable("# Changelog\n", {
    sdkVersion: "1.0.0",
    sourceApiVersion: "v0.9.1",
    date: "2026-08-30"
  });

  const withSecond = upsertCompatibilityTable(withFirst, {
    sdkVersion: "1.1.0",
    sourceApiVersion: "v0.9.3",
    date: "2026-09-15"
  });

  const startIndex = withSecond.indexOf("<!-- compatibility-table:start -->");
  const firstRow = withSecond.indexOf("1.1.0", startIndex);
  const secondRow = withSecond.indexOf("1.0.0", startIndex);
  assert.ok(firstRow > -1 && secondRow > -1);
  assert.ok(firstRow < secondRow, "the newest SDK Release should appear first");
});

test("upsertCompatibilityTable replaces the row for a repeated SDK Release instead of duplicating it", () => {
  const withFirst = upsertCompatibilityTable("# Changelog\n", {
    sdkVersion: "1.0.0",
    sourceApiVersion: "v0.9.1",
    date: "2026-08-30"
  });

  const regenerated = upsertCompatibilityTable(withFirst, {
    sdkVersion: "1.0.0",
    sourceApiVersion: "v0.9.1",
    date: "2026-08-30"
  });

  assert.equal(regenerated, withFirst);
  assert.equal((regenerated.match(/\| 1\.0\.0 \|/g) ?? []).length, 1);
});

test("upsertCompatibilityTable leaves hand-written content outside the markers untouched", () => {
  const changelog = [
    "# Changelog",
    "",
    "## Unreleased",
    "",
    "- some hand-written note",
    "",
    "<!-- compatibility-table:start -->",
    "| SDK Release | API Release | Date |",
    "| --- | --- | --- |",
    "| 1.0.0 | v0.9.1 | 2026-08-30 |",
    "<!-- compatibility-table:end -->",
    ""
  ].join("\n");

  const result = upsertCompatibilityTable(changelog, {
    sdkVersion: "1.1.0",
    sourceApiVersion: "v0.9.3",
    date: "2026-09-15"
  });

  assert.match(result, /## Unreleased/);
  assert.match(result, /- some hand-written note/);
  assert.match(result, /\| 1\.1\.0 \| v0\.9\.3 \| 2026-09-15 \|/);
  assert.match(result, /\| 1\.0\.0 \| v0\.9\.1 \| 2026-08-30 \|/);
});
