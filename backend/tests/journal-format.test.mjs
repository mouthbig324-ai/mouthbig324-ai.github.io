import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { normalizePostCategory } from "../../src/utils/post-category.mjs";
const bundled = await build({ entryPoints: [new URL("../../src/utils/journal-heading.ts", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
const { applyJournalHeading } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));

test("heading levels preserve Chinese text, punctuation, cursor and surrounding paragraphs", () => {
  const body = "开头。\n今天的收获！\n下一段，继续。";
  const r = applyJournalHeading(body, 4, 10, 2);
  assert.equal(r.text, "开头。\n## 今天的收获！\n下一段，继续。");
  assert.equal(r.text.slice(r.start, r.end), body.slice(4, 10));
  const smaller = applyJournalHeading(r.text, r.start, r.end, 3);
  assert.ok(smaller.text.includes("\n### 今天的收获！\n"));
  assert.equal(applyJournalHeading(smaller.text, smaller.start, smaller.end, 0).text, body);
});
test("heading formatting protects code, lists and multi-line selections", () => {
  for (const [body, start, end] of [["```md\n代码\n```", 6, 8], ["    缩进代码", 5, 7], ["- 列表内容", 2, 6], ["1. 列表", 3, 5], ["> 引用", 2, 4], ["第一行\n第二行", 0, 7]]) {
    assert.equal(applyJournalHeading(body, start, end, 2).text, body);
  }
  assert.equal(applyJournalHeading("\n下一段", 0, 0, 2).text, "## \n下一段");
});
test("legacy daily categories normalize while empty and travel categories remain stable", () => {
  assert.equal(normalizePostCategory("日常"), "生活碎片");
  assert.equal(normalizePostCategory(" 生活碎片 "), "生活碎片");
  assert.equal(normalizePostCategory("旅行日记"), "旅行日记");
  for (const value of [null, undefined, "", "无"]) assert.equal(normalizePostCategory(value), "");
});
