import { test } from "node:test";
import assert from "node:assert/strict";
import { draftPrefix, listLocalDrafts, writeLocalDraft } from "../../src/scripts/local-drafts.ts";

class MemoryStorage {
  data = new Map();
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, value); }
}
const draft = (id, body = "未提交的文字") => ({ version: 1, key: draftPrefix + id, updated: 1, baseline: "", record: { kind: "post", id: "same-article", body, photos: [], tags: [] } });

test("recovery copies from two editors remain separate and exclude unrelated storage", () => {
  const storage = new MemoryStorage();
  storage.setItem("zuige-owner-access", "not-part-of-recovery");
  writeLocalDraft(storage, draft("first", "手机的文字"));
  writeLocalDraft(storage, draft("second", "另一标签页的文字"));
  assert.equal(listLocalDrafts(storage).length, 2);
  assert.ok(!JSON.stringify(listLocalDrafts(storage)).includes("not-part-of-recovery"));
  writeLocalDraft(storage, draft("first", "手机继续写"));
  assert.equal(JSON.parse(storage.getItem(draftPrefix + "second")).record.body, "另一标签页的文字");
});

test("the recovery budget rejects new data without evicting any existing copy", () => {
  const storage = new MemoryStorage();
  writeLocalDraft(storage, draft("first", "字".repeat(600000)));
  const before = storage.getItem(draftPrefix + "first");
  assert.throws(() => writeLocalDraft(storage, draft("second", "字".repeat(600000))), /本机暂存空间已满/);
  assert.equal(storage.getItem(draftPrefix + "first"), before);
  assert.equal(storage.getItem(draftPrefix + "second"), null);
  assert.throws(() => writeLocalDraft(storage, draft("first", "字".repeat(1000000))), /本机暂存空间已满/);
  assert.equal(storage.getItem(draftPrefix + "first"), before);
});

test("a malformed recovery entry does not prevent restoring valid copies or delete data", () => {
  const storage = new MemoryStorage();
  storage.setItem(draftPrefix + "broken", "invalid-json");
  writeLocalDraft(storage, draft("valid"));
  assert.equal(listLocalDrafts(storage).length, 1);
  assert.equal(storage.getItem(draftPrefix + "broken"), "invalid-json");
});
