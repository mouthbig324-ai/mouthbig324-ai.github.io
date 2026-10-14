import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { build } from "esbuild";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";
import { postContent, parsePost } from "../src/index.mjs";

const origin = "https://mouthbig324-ai.github.io";
const password = "only-a-local-test-password";
const secret = "only-a-local-test-session-secret-1234567890";
const files = new Map(); const writes = []; let counter = 1;
let worker; let db; let bucket; let token;
const encode = content => Buffer.from(content).toString("base64");
const fileResponse = (path, record) => Response.json({ path, sha: record.sha, content: encode(record.raw), encoding: "base64" });
async function fakeNetwork(request) {
  const url = new URL(request.url);
  if (url.origin === origin && url.pathname === "/records.json") return Response.json([{ kind: "post", id: "hello", title: "小站的第一天", date: "2026-10-13" }]);
  assert.equal(url.origin, "https://api.github.com", "No test may call an external service");
  assert.ok(url.pathname.startsWith("/repos/mouthbig324-ai/mouthbig324-ai.github.io/"));
  if (url.pathname.endsWith("/git/trees/main")) return Response.json({ tree: [...files].map(([path, file]) => ({ path, sha: file.sha, type: "blob" })), truncated: false });
  const path = decodeURIComponent(url.pathname.split("/contents/")[1] || "");
  const record = files.get(path);
  if (request.method === "GET") return record ? fileResponse(path, record) : Response.json({ message: "Not Found" }, { status: 404 });
  assert.equal(request.method, "PUT");
  const data = await request.json();
  if ((record?.sha || "") !== (data.sha || "")) return Response.json({ message: "Conflict" }, { status: 409 });
  const saved = { sha: `test-sha-${counter++}`, raw: Buffer.from(data.content, "base64").toString("utf8") };
  files.set(path, saved); writes.push({ path, raw: saved.raw });
  return Response.json({ content: { sha: saved.sha }, commit: { sha: "local-test-commit" } });
}
async function call(path, { auth = false, data, ...options } = {}) {
  const headers = new Headers(options.headers); headers.set("Origin", origin);
  if (auth) headers.set("Authorization", `Bearer ${token}`);
  if (data !== undefined) { headers.set("Content-Type", "application/json"); options.body = JSON.stringify(data); options.method ||= "POST"; }
  return worker.dispatchFetch("https://local-service.test" + path, { ...options, headers });
}
const post = changes => ({ kind: "post", id: "test-travel", sha: "", title: "杭州的秋天", date: "2026-10-14", body: "走到湖边。", description: "一段旅途", category: "旅行日记", tags: ["杭州"], photos: [], videos: [], draft: true, ...changes });

before(async () => {
  files.set("src/content/posts/hello.md", { sha: "original-hello", raw: postContent(post({ title: "小站的第一天", date: "2026-10-13", draft: false })) });
  files.set("src/data/friends.json", { sha: "original-friends", raw: "[]" });
  const bundled = await build({ entryPoints: [new URL("../src/index.mjs", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")], bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent" });
  worker = new Miniflare(convertV4MiniflareOptions({ log: new Log(LogLevel.ERROR), workers: [{ modules: true, script: bundled.outputFiles[0].text, compatibilityDate: "2026-08-01", d1Databases: ["DB"], r2Buckets: ["BUCKET"], outboundService: fakeNetwork, bindings: { BLOG_ORIGIN: origin, GITHUB_OWNER: "mouthbig324-ai", GITHUB_REPO: "mouthbig324-ai.github.io", GITHUB_TOKEN: "only-a-test-token", ADMIN_PASSWORD_HASH: createHash("sha256").update(password).digest("hex"), SESSION_SECRET: secret, MAX_STORAGE_BYTES: "8000000000" } }] }));
  db = await worker.getD1Database("DB"); bucket = await worker.getR2Bucket("BUCKET");
  for (const file of ["0001_initial.sql", "0002_record_index.sql"]) {
    const sql = readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8");
    for (const statement of sql.split(";").filter(value => value.trim())) await db.prepare(statement).run();
  }
  const response = await call("/admin/login", { data: { password } }); assert.equal(response.status, 200); token = (await response.json()).token;
});
after(async () => { await worker?.dispose(); });

test("visitor cannot use the publishing or upload endpoints", async () => {
  assert.equal((await call("/admin/status")).status, 401);
  assert.equal((await call("/admin/record", { data: post() })).status, 401);
  assert.equal((await call("/admin/media", { method: "POST", body: "test" })).status, 401);
  assert.equal((await call("/admin/login", { data: { password: "wrong-password" } })).status, 401);
  assert.equal(writes.length, 0);
});
test("tampered and expired owner sessions fail", async () => {
  assert.equal((await call("/admin/status", { headers: { Authorization: `Bearer ${token}wrong` } })).status, 401);
  const payload = Buffer.from(JSON.stringify({ role: "owner", expires: Date.now() - 1000 })).toString("base64url");
  const expired = payload + "." + createHmac("sha256", secret).update(payload).digest("base64url");
  assert.equal((await call("/admin/status", { headers: { Authorization: `Bearer ${expired}` } })).status, 401);
});
test("CORS allows the blog and rejects an unrelated origin", async () => {
  const allowed = await call("/health"); assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), origin);
  const denied = await worker.dispatchFetch("https://local-service.test/health", { headers: { Origin: "https://unrelated.test" } });
  assert.equal(denied.status, 403); assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal((await call("/admin/media", { method: "OPTIONS" })).status, 204);
});
test("comments persist but the email is available only to the owner", async () => {
  const submitted = await call("/comments", { data: { path: "/posts/hello/", name: "朋友", email: "friend@example.test", body: "<script>alert(1)</script> 很好看", company: "" } });
  assert.equal(submitted.status, 201);
  const publicData = await (await call("/comments?path=%2Fposts%2Fhello%2F")).json();
  assert.equal(publicData.comments.length, 1); assert.equal(publicData.comments[0].email, undefined); assert.ok(publicData.comments[0].body.includes("<script>"));
  const privateData = await (await call("/admin/comments", { auth: true })).json(); assert.equal(privateData.items[0].email, "friend@example.test");
});
test("invalid paths, invalid emails and the spam honeypot cannot add comments", async () => {
  const data = { path: "/posts/hello/", name: "朋友", email: "friend@example.test", body: "test" };
  assert.equal((await call("/comments", { data: { ...data, path: "/../../admin/" } })).status, 400);
  assert.equal((await call("/comments", { data: { ...data, email: "bad" } })).status, 400);
  assert.equal((await call("/comments", { data: { ...data, company: "spam" } })).status, 200);
  assert.equal((await (await call("/comments?path=%2Fposts%2Fhello%2F")).json()).comments.length, 1);
});
test("owner can reply to and hide a comment", async () => {
  const items = (await (await call("/admin/comments", { auth: true })).json()).items;
  assert.equal((await call("/admin/comments/reply", { auth: true, data: { id: items[0].id, body: "谢谢！" } })).status, 201);
  const beforeHide = (await (await call("/comments?path=%2Fposts%2Fhello%2F")).json()).comments;
  assert.equal(beforeHide[1].owner, 1); assert.equal(beforeHide[1].parent_id, items[0].id);
  assert.equal((await call("/admin/comments/hide", { auth: true, data: { id: items[0].id } })).status, 200);
  assert.equal((await (await call("/comments?path=%2Fposts%2Fhello%2F")).json()).comments.length, 1);
});
test("an excessive posting rate is stopped", async () => {
  const data = { path: "/posts/hello/", name: "test", email: "friend@example.test", body: "test" };
  let last;
  for (let index = 0; index < 9; index++) last = await call("/comments", { data, headers: { "CF-Connecting-IP": "192.0.2.10" } });
  assert.equal(last.status, 429);
});
test("drafts and long Chinese text save with valid dates and a readable record list", async () => {
  const text = "在湖边记录一天。".repeat(7000);
  const response = await call("/admin/record", { auth: true, data: post({ body: text }) }); assert.equal(response.status, 200);
  const saved = await response.json();
  assert.match(files.get("src/content/posts/test-travel.md").raw, /published: 2026-10-14\n/);
  const reopened = await (await call("/admin/record?kind=post&id=test-travel", { auth: true })).json();
  assert.equal(reopened.body, text); assert.equal(reopened.meta.draft, true); assert.equal(reopened.sha, saved.sha);
  const list = (await (await call("/admin/records?kind=post", { auth: true })).json()).items;
  assert.equal(list.find(item => item.id === "test-travel").title, "杭州的秋天"); assert.equal(list.find(item => item.id === "hello").title, "小站的第一天");
});
test("stale editors and unsafe file paths cannot overwrite records", async () => {
  assert.equal((await call("/admin/record", { auth: true, data: post({ sha: "wrong-sha" }) })).status, 409);
  assert.equal((await call("/admin/record", { auth: true, data: post({ id: "../../config" }) })).status, 400);
  assert.equal((await call("/admin/record", { auth: true, data: post({ id: "invalid-date", date: "2026-02-30" }) })).status, 400);
});
test("publishing, albums and friend links use only their permitted repository paths", async () => {
  const sha = files.get("src/content/posts/test-travel.md").sha;
  const published = await (await call("/admin/record", { auth: true, data: post({ sha, draft: false, featured: true, photos: [{ src: "https://media.example.test/1.webp", width: 1920, height: 1280, alt: "湖边" }] }) })).json();
  assert.equal(published.url, origin + "/posts/test-travel/"); assert.equal(parsePost(files.get("src/content/posts/test-travel.md").raw).meta.featured, true);
  assert.equal((await call("/admin/record", { auth: true, data: { kind: "album", id: "autumn", sha: "", title: "秋日", date: "2026-10-14", photos: [], draft: true } })).status, 200);
  assert.equal((await call("/admin/record", { auth: true, data: { kind: "friends", sha: "original-friends", items: [{ name: "test", url: "/invalid-local-url", description: "" }] } })).status, 400);
  assert.equal((await call("/admin/record", { auth: true, data: { kind: "friends", sha: "original-friends", items: [{ name: "Clairis", url: "https://clairis.cn/", description: "朋友的小站" }] } })).status, 200);
  assert.ok(writes.every(item => /^src\/(content\/posts\/[a-z0-9-]+\.md|data\/albums\/[a-z0-9-]+\.json|data\/friends\.json)$/.test(item.path)));
});
test("uploaded media supports full downloads, ranges, HEAD and ETag validation", async () => {
  const uploaded = await call("/admin/media", { auth: true, method: "POST", headers: { "Content-Type": "video/mp4", "Content-Length": "10" }, body: "0123456789" }); assert.equal(uploaded.status, 201);
  const media = await uploaded.json(); const path = new URL(media.src).pathname;
  const full = await call(path); assert.equal(full.status, 200); assert.equal(await full.text(), "0123456789"); assert.equal(full.headers.get("Content-Type"), "video/mp4");
  const partial = await call(path, { headers: { Range: "bytes=2-5" } }); assert.equal(partial.status, 206); assert.equal(partial.headers.get("Content-Range"), "bytes 2-5/10"); assert.equal(await partial.text(), "2345");
  const head = await call(path, { method: "HEAD" }); assert.equal(head.status, 200); assert.equal(await head.text(), "");
  assert.equal((await call(path, { headers: { "If-None-Match": full.headers.get("ETag") } })).status, 304);
  assert.equal((await (await call("/admin/status", { auth: true })).json()).usedBytes, 10);
});
test("media size and storage limits refuse uploads before anything is written", async () => {
  const oversized = Buffer.alloc(13 * 1024 * 1024);
  assert.equal((await call("/admin/media", { auth: true, method: "POST", headers: { "Content-Type": "image/webp", "Content-Length": String(oversized.length), "X-Media-Width": "1000", "X-Media-Height": "1000" }, body: oversized })).status, 413);
  const before = (await bucket.list()).objects.length;
  await db.prepare("UPDATE storage_budget SET used_bytes=8000000000 WHERE id=1").run();
  assert.equal((await call("/admin/media", { auth: true, method: "POST", headers: { "Content-Type": "video/mp4", "Content-Length": "4" }, body: "test" })).status, 507);
  assert.equal((await bucket.list()).objects.length, before);
});
