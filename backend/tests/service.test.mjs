import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFileSync } from "node:fs";
import { createHmac, pbkdf2Sync } from "node:crypto";
import { build } from "esbuild";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";
import service, { postContent, parsePost } from "../src/index.mjs";

const origin = "https://mouthbig324-ai.github.io";
const secret = "only-a-local-test-session-secret-1234567890";
const password = "local-test-password-not-a-real-credential";
const salt = Buffer.from("local-test-salt-only");
const passwordHash = `pbkdf2-sha256:100000:${salt.toString("base64url")}:${pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("base64url")}`;
const credential = createHmac("sha256", secret).update("password-session:" + passwordHash).digest("base64url");
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
  worker = new Miniflare(convertV4MiniflareOptions({ log: new Log(LogLevel.ERROR), workers: [{ modules: true, script: bundled.outputFiles[0].text, compatibilityDate: "2026-08-01", d1Databases: ["DB"], r2Buckets: ["BUCKET"], outboundService: fakeNetwork, bindings: { BLOG_ORIGIN: origin, GITHUB_OWNER: "mouthbig324-ai", GITHUB_REPO: "mouthbig324-ai.github.io", GITHUB_TOKEN: "only-a-test-token", SESSION_SECRET: secret, ADMIN_PASSWORD_HASH: passwordHash, MAX_STORAGE_BYTES: "8000000000" } }] }));
  db = await worker.getD1Database("DB"); bucket = await worker.getR2Bucket("BUCKET");
  for (const file of ["0001_initial.sql", "0002_record_index.sql", "0003_article_views.sql"]) {
    const sql = readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8");
    for (const statement of sql.split(";").filter(value => value.trim())) await db.prepare(statement).run();
  }
  const payload = Buffer.from(JSON.stringify({ role: "owner", expires: Date.now() + 3600000, credential })).toString("base64url");
  token = payload + "." + createHmac("sha256", secret).update(payload).digest("base64url");
});
after(async () => { await worker?.dispose(); });

test("visitor cannot use the publishing or upload endpoints", async () => {
  assert.equal((await call("/admin/status")).status, 401);
  assert.equal((await call("/admin/record", { data: post() })).status, 401);
  assert.equal((await call("/admin/media", { method: "POST", body: "test" })).status, 401);
  assert.equal((await call("/admin/login", { data: { password: "obsolete-password" } })).status, 401);
  assert.equal(writes.length, 0);
});
test("tampered and expired owner sessions fail", async () => {
  assert.equal((await call("/admin/status", { headers: { Authorization: `Bearer ${token}wrong` } })).status, 401);
  assert.equal((await call("/admin/status", { headers: { Authorization: `Bearer ${token}.extra` } })).status, 401);
  const payload = Buffer.from(JSON.stringify({ role: "owner", expires: Date.now() - 1000, credential })).toString("base64url");
  const expired = payload + "." + createHmac("sha256", secret).update(payload).digest("base64url");
  assert.equal((await call("/admin/status", { headers: { Authorization: `Bearer ${expired}` } })).status, 401);
});
test("retired private links cannot authenticate; password sessions expire after seven days", async () => {
  const payload = Buffer.from(JSON.stringify({ role: "owner", expires: Date.now() + 365 * 24 * 3600000 })).toString("base64url");
  const access = payload + "." + createHmac("sha256", secret).update(payload).digest("base64url");
  const response = await call("/admin/status", { headers: { Authorization: `Bearer ${access}` } });
  assert.equal(response.status, 401);
  assert.equal((await (await call("/health")).json()).authMode, "password");
  const login = await call("/admin/login", { data: { password } });
  assert.equal(login.status, 200); assert.equal(login.headers.get("Cache-Control"), "no-store");
  const session = await login.json();
  assert.ok(session.expires > Date.now() + 6.99 * 86400000 && session.expires <= Date.now() + 7 * 86400000);
  assert.ok(!JSON.stringify(session).includes(password));
  assert.equal((await call("/admin/status", { headers: { Authorization: `Bearer ${session.token}` } })).status, 200);
  assert.equal((await call("/admin/login", { data: { password: password.toUpperCase() } })).status, 401);
  const stale = Buffer.from(JSON.stringify({ role: "owner", expires: Date.now() + 3600000, credential: "previous-password" })).toString("base64url");
  assert.equal((await call("/admin/status", { headers: { Authorization: `Bearer ${stale}.${createHmac("sha256", secret).update(stale).digest("base64url")}` } })).status, 401);
});
test("password attempts are limited and malformed or oversized credentials fail", async () => {
  for (const value of [null, 12, "", "a".repeat(257)]) {
    assert.equal((await call("/admin/login", { data: { password: value }, headers: { "CF-Connecting-IP": "192.0.2.70" } })).status, 401);
  }
  assert.equal((await call("/admin/login", { data: { password: "a".repeat(3000) }, headers: { "CF-Connecting-IP": "192.0.2.71" } })).status, 413);
  for (let i = 0; i < 8; i++) assert.equal((await call("/admin/login", { data: { password: "wrong" }, headers: { "CF-Connecting-IP": "192.0.2.72" } })).status, 401);
  assert.equal((await call("/admin/login", { data: { password }, headers: { "CF-Connecting-IP": "192.0.2.72" } })).status, 429);
  assert.equal((await call("/admin/login", { data: { password }, headers: { "CF-Connecting-IP": "192.0.2.73" } })).status, 200);
});
test("missing credentials fail closed and a password change invalidates existing sessions", async () => {
  const request = new Request("https://local-service.test/admin/status", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await service.fetch(request, { DB: {}, SESSION_SECRET: secret })).status, 503);
  assert.equal((await service.fetch(request, { DB: {}, SESSION_SECRET: secret, ADMIN_PASSWORD_HASH: passwordHash + "changed" })).status, 401);
  const health = await service.fetch(new Request("https://local-service.test/health"), { SESSION_SECRET: secret });
  assert.equal((await health.json()).login, false);
  assert.equal((await call("/admin/login", { method: "POST", body: "null", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.74" } })).status, 401);
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
test("visitor replies retain the recipient, reject hidden or cross-article parents and cannot claim ownership", async () => {
  const path = "/posts/thread-test/";
  const data = { path, name: "访客", email: "visitor@example.test", body: "第一行\n第二行 👍" };
  const headers = { "CF-Connecting-IP": "192.0.2.21" };
  assert.equal((await call("/comments", { data, headers })).status, 201);
  const parent = (await (await call("/comments?path=" + encodeURIComponent(path))).json()).comments[0];
  assert.equal((await call("/comments", { data: { ...data, parent_id: parent.id, owner: true }, headers })).status, 201);
  const comments = (await (await call("/comments?path=" + encodeURIComponent(path))).json()).comments;
  const reply = comments.find(item => item.parent_id === parent.id);
  assert.equal(reply.owner, 0); assert.equal(reply.email, undefined); assert.equal(reply.body, data.body);
  assert.equal((await call("/comments", { data: { ...data, path: "/posts/other/", parent_id: parent.id }, headers })).status, 404);
  await call("/admin/comments/hide", { auth: true, data: { id: parent.id } });
  assert.equal((await call("/comments", { data: { ...data, parent_id: parent.id }, headers })).status, 404);
  assert.equal((await (await call("/comments?path=" + encodeURIComponent(path))).json()).comments.length, 1);
});
test("view totals are durable, atomic and deduplicated per browser and article", async () => {
  const path = "/posts/view-test/";
  const visitor = "11111111-1111-4111-8111-111111111111";
  const headers = { "CF-Connecting-IP": "192.0.2.30" };
  assert.deepEqual(await (await call("/views?path=" + encodeURIComponent(path))).json(), { views: 0 });
  const responses = await Promise.all(Array.from({ length: 6 }, () => call("/views", { data: { path, visitor }, headers })));
  for (const response of responses) { assert.equal(response.status, 200); assert.equal((await response.json()).views, 1); }
  assert.equal((await (await call("/views", { data: { path, visitor: "22222222-2222-4222-8222-222222222222" }, headers })).json()).views, 2);
  assert.equal((await (await call("/views", { data: { path: "/posts/another-view/", visitor }, headers })).json()).views, 1);
  assert.equal((await (await call("/views?path=" + encodeURIComponent(path))).json()).views, 2);
  assert.equal((await call("/views", { data: { path: "/admin/", visitor }, headers })).status, 400);
  assert.equal((await call("/views", { data: { path, visitor: "invalid" }, headers })).status, 400);
  const visits = await db.prepare("SELECT id FROM view_visits").all();
  assert.equal(visits.results.length, 3); assert.ok(visits.results.every(item => !item.id.includes(visitor)));
  await db.prepare("INSERT INTO view_visits(id, expires) VALUES ('expired-test', 1)").run();
  await service.scheduled({}, { DB: db });
  assert.equal(await db.prepare("SELECT id FROM view_visits WHERE id = 'expired-test'").first(), null);
  assert.equal((await (await call("/views?path=" + encodeURIComponent(path))).json()).views, 2);
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
test("travel series fields round-trip for posts and albums and survive older editors", async () => {
  for (const kind of ["post", "album"]) {
    const id = `series-${kind}`;
    const fields = { series: "国庆之旅 / 杭州", tripDate: "2026-10-01", location: "西湖", seriesOrder: 2 };
    const data = post({ kind, id, ...fields });
    const created = await call("/admin/record", { auth: true, data });
    assert.equal(created.status, 200);
    let saved = await created.json();
    const read = () => call(`/admin/record?kind=${kind}&id=${id}`, { auth: true }).then(response => response.json());
    for (const [field, value] of Object.entries(fields)) assert.equal((await read()).meta[field], value);
    // A device with an older cached editor omits these fields instead of clearing them.
    const older = await call("/admin/record", { auth: true, data: post({ kind, id, sha: saved.sha }) });
    assert.equal(older.status, 200); saved = await older.json();
    for (const [field, value] of Object.entries(fields)) assert.equal((await read()).meta[field], value);
    const cleared = await call("/admin/record", { auth: true, data: post({ kind, id, sha: saved.sha, series: "", tripDate: "", location: "", seriesOrder: null }) });
    assert.equal(cleared.status, 200);
    assert.equal((await read()).meta.series, "");
    assert.equal((await read()).meta.seriesOrder, null);
  }
});
test("invalid travel dates, series lengths and order numbers cannot be published", async () => {
  const before = writes.length;
  for (const kind of ["post", "album"]) {
    for (const fields of [{ tripDate: "2026-02-30" }, { series: "长".repeat(81) }, { location: "长".repeat(81) }, { seriesOrder: -1 }, { seriesOrder: 1.5 }, { seriesOrder: "2" }, { seriesOrder: 10000 }]) {
      assert.equal((await call("/admin/record", { auth: true, data: post({ kind, id: "invalid-series", ...fields }) })).status, 400);
    }
  }
  assert.equal(writes.length, before);
});
test("legacy daily records merge into moments and uncategorized records stay empty", async () => {
  for (const [index, category] of ["日常", ""].entries()) {
    const id = `test-category-${index}`;
    const expected = category === "日常" ? "生活碎片" : category;
    const first = await call("/admin/record", { auth: true, data: post({ id, category }) });
    assert.equal(first.status, 200);
    assert.equal(parsePost(files.get(`src/content/posts/${id}.md`).raw).meta.category, expected);
    const reopenedResponse = await call(`/admin/record?kind=post&id=${id}`, { auth: true });
    assert.equal(reopenedResponse.status, 200);
    const reopened = await reopenedResponse.json();
    assert.equal(reopened.meta.category, expected);
    const edited = await call("/admin/record", { auth: true, data: post({ id, sha: reopened.sha, category: reopened.meta.category, body: reopened.body + "\nEdited record.", draft: false }) });
    assert.equal(edited.status, 200);
    const finalResponse = await call(`/admin/record?kind=post&id=${id}`, { auth: true });
    assert.equal(finalResponse.status, 200);
    const final = await finalResponse.json();
    assert.equal(final.meta.category, expected);
    assert.equal(final.meta.draft, false);
    assert.equal(final.body, reopened.body + "\nEdited record.");
  }
  assert.equal(parsePost(postContent(post({ category: "无" }))).meta.category, "");
  for (const category of [undefined, "unknown"]) {
    assert.equal(parsePost(postContent(post({ category }))).meta.category, "生活碎片");
  }
});
test("publishing, albums and friend links use only their permitted repository paths", async () => {
  const sha = files.get("src/content/posts/test-travel.md").sha;
  const published = await (await call("/admin/record", { auth: true, data: post({ sha, draft: false, featured: true, photos: [{ src: "https://media.example.test/1.webp", width: 1920, height: 1280, alt: "湖边" }] }) })).json();
  assert.equal(published.url, origin + "/posts/test-travel/"); assert.equal(parsePost(files.get("src/content/posts/test-travel.md").raw).meta.featured, true);
  assert.equal((await call("/admin/record", { auth: true, data: { kind: "album", id: "autumn", sha: "", title: "秋日", date: "2026-10-14", photos: [], draft: true } })).status, 200);
  assert.equal((await call("/admin/record", { auth: true, data: { kind: "friends", sha: "original-friends", items: [{ name: "test", url: "/invalid-local-url", description: "" }] } })).status, 400);
  assert.equal((await call("/admin/record", { auth: true, data: { kind: "friends", sha: "original-friends", items: [{ name: "Clairis", url: "https://clairis.cn/", description: "朋友的小站", note: "以后一起旅行" }] } })).status, 200);
  assert.equal(JSON.parse(files.get("src/data/friends.json").raw)[0].note, "以后一起旅行");
  const friendSha = files.get("src/data/friends.json").sha;
  assert.equal((await call("/admin/record", { auth: true, data: { kind: "friends", sha: friendSha, items: [{ name: "Clairis", url: "https://clairis.cn/", description: "朋友的小站", note: "备注".repeat(126) }] } })).status, 400);
  assert.ok(writes.every(item => /^src\/(content\/posts\/[a-z0-9-]+\.md|data\/albums\/[a-z0-9-]+\.json|data\/friends\.json)$/.test(item.path)));
});
test("uploaded media supports full downloads, ranges, HEAD and ETag validation", async () => {
  const uploaded = await call("/admin/media", { auth: true, method: "POST", headers: { "Content-Type": "video/mp4", "Content-Length": "10" }, body: "0123456789" }); assert.equal(uploaded.status, 201);
  const media = await uploaded.json(); const path = new URL(media.src).pathname;
  const full = await call(path); assert.equal(full.status, 200); assert.equal(await full.text(), "0123456789"); assert.equal(full.headers.get("Content-Type"), "video/mp4");
  const partial = await call(path, { headers: { Range: "bytes=2-5" } }); assert.equal(partial.status, 206); assert.equal(partial.headers.get("Content-Range"), "bytes 2-5/10"); assert.equal(await partial.text(), "2345");
  const head = await call(path, { method: "HEAD" }); assert.equal(head.status, 200); assert.equal(head.headers.get("Content-Length"), "10"); assert.equal(await head.text(), "");
  assert.equal((await call(path, { headers: { "If-None-Match": full.headers.get("ETag") } })).status, 304);
  assert.equal((await (await call("/admin/status", { auth: true })).json()).usedBytes, 10);
});
test("media ranges clamp to the object and reject unsatisfiable positions", async () => {
  const path = "/media/2026/10/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.mp4";
  await bucket.put(path.slice(1), "0123456789", { httpMetadata: { contentType: "video/mp4" } });
  for (const [range, expectedRange, expectedBody] of [["bytes=7-99", "bytes 7-9/10", "789"], ["bytes=4-", "bytes 4-9/10", "456789"], ["bytes=-4", "bytes 6-9/10", "6789"], ["bytes=-99", "bytes 0-9/10", "0123456789"]]) {
    const response = await call(path, { headers: { Range: range } });
    assert.equal(response.status, 206); assert.equal(response.headers.get("Content-Range"), expectedRange); assert.equal(response.headers.get("Content-Length"), String(expectedBody.length)); assert.equal(await response.text(), expectedBody);
  }
  for (const range of ["bytes=10-", "bytes=99-100", "bytes=-0"]) {
    const response = await call(path, { headers: { Range: range } });
    assert.equal(response.status, 416); assert.equal(response.headers.get("Content-Range"), "bytes */10"); assert.equal(await response.text(), "");
  }
  for (const range of ["bytes=bad", "bytes=5-2", "bytes=0-1,4-5"]) {
    const response = await call(path, { headers: { Range: range } });
    assert.equal(response.status, 200); assert.equal(response.headers.get("Content-Range"), null); assert.equal(await response.text(), "0123456789");
  }
});
test("media preconditions and If-Range distinguish cached, stale and partial responses", async () => {
  const path = "/media/2026/10/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.mp4";
  await bucket.put(path.slice(1), "0123456789", { httpMetadata: { contentType: "video/mp4" } });
  const head = await call(path, { method: "HEAD" }); const etag = head.headers.get("ETag"); const modified = head.headers.get("Last-Modified");
  for (const [headers, expected] of [[{ "If-Match": '"wrong"' }, 412], [{ "If-Match": `W/${etag}` }, 412], [{ "If-Unmodified-Since": "Thu, 01 Jan 1970 00:00:00 GMT" }, 412], [{ "If-None-Match": `W/${etag}` }, 304], [{ "If-Match": etag, "If-None-Match": etag }, 304], [{ "If-Modified-Since": modified }, 304], [{ "If-None-Match": '"wrong"', "If-Modified-Since": modified }, 200]]) {
    const response = await call(path, { headers }); assert.equal(response.status, expected);
    assert.equal(await response.text(), expected === 200 ? "0123456789" : "");
  }
  for (const [validator, expected] of [[etag, 206], [modified, 206], ['"wrong"', 200], [`W/${etag}`, 200], ["Thu, 01 Jan 2099 00:00:00 GMT", 200]]) {
    const response = await call(path, { headers: { Range: "bytes=2-5", "If-Range": validator } });
    assert.equal(response.status, expected); assert.equal(response.headers.get("Content-Range"), expected === 206 ? "bytes 2-5/10" : null); assert.equal(await response.text(), expected === 206 ? "2345" : "0123456789");
  }
  const rangedHead = await call(path, { method: "HEAD", headers: { Range: "bytes=2-5" } });
  assert.equal(rangedHead.status, 200); assert.equal(rangedHead.headers.get("Content-Length"), "10"); assert.equal(rangedHead.headers.get("Content-Range"), null); assert.equal(await rangedHead.text(), "");
});
test("original photos larger than 12 MiB retain their exact uploaded bytes", async () => {
  const original = Buffer.alloc(13 * 1024 * 1024, 0x5a);
  const response = await call("/admin/media", { auth: true, method: "POST", headers: { "Content-Type": "image/jpeg", "Content-Length": String(original.length), "X-Media-Width": "6000", "X-Media-Height": "4000" }, body: original });
  assert.equal(response.status, 201); const saved = await response.json();
  assert.equal(saved.size, original.length); assert.equal(saved.type, "image/jpeg"); assert.equal(saved.width, 6000); assert.equal(saved.height, 4000); assert.match(saved.src, /\.jpg$/);
  const download = await call(new URL(saved.src).pathname); assert.equal(download.headers.get("Content-Type"), "image/jpeg"); assert.ok(Buffer.from(await download.arrayBuffer()).equals(original));
});
test("failed uploads release storage only after object cleanup succeeds", async () => {
  for (const failure of ["put", "index", "index-and-cleanup"]) {
    let used = 0; let stored = false;
    const database = { prepare(sql) { const query = { bind() { return query; }, async run() {
      if (sql.startsWith("UPDATE storage_budget SET used_bytes = used_bytes +")) { used += 4; return { meta: { changes: 1 } }; }
      if (sql.startsWith("INSERT INTO media")) throw new Error("simulated index failure");
      if (sql.startsWith("UPDATE storage_budget SET used_bytes = MAX")) { used -= 4; return { meta: { changes: 1 } }; }
      assert.fail("Unexpected database statement");
    } }; return query; } };
    const storage = { async put() { if (failure === "put") throw new Error("simulated upload failure"); stored = true; }, async delete() { if (failure === "index-and-cleanup") throw new Error("simulated cleanup failure"); stored = false; } };
    const response = await service.fetch(new Request("https://local-service.test/admin/media", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4", "Content-Length": "4" }, body: "test" }), { DB: database, BUCKET: storage, SESSION_SECRET: secret, ADMIN_PASSWORD_HASH: passwordHash });
    assert.equal(response.status, 500); assert.equal(used, failure === "index-and-cleanup" ? 4 : 0); assert.equal(stored, failure === "index-and-cleanup");
  }
});
test("media size and storage limits refuse uploads before anything is written", async () => {
  for (const type of ["image/jpeg", "video/mp4"]) {
    const response = await service.fetch(new Request("https://local-service.test/admin/media", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": type, "Content-Length": String(64 * 1024 * 1024 + 1), "X-Media-Width": "1000", "X-Media-Height": "1000" }, body: "test" }), { DB: { prepare() { assert.fail("Oversized uploads must not reserve storage"); } }, BUCKET: { put() { assert.fail("Oversized uploads must not store an object"); } }, SESSION_SECRET: secret, ADMIN_PASSWORD_HASH: passwordHash });
    assert.equal(response.status, 413); assert.match((await response.json()).error, /64 MB/);
  }
  const before = (await bucket.list()).objects.length;
  await db.prepare("UPDATE storage_budget SET used_bytes=8000000000 WHERE id=1").run();
  assert.equal((await call("/admin/media", { auth: true, method: "POST", headers: { "Content-Type": "video/mp4", "Content-Length": "4" }, body: "test" })).status, 507);
  assert.equal((await bucket.list()).objects.length, before);
});


test("publishing canonicalizes old daily categories and preserves empty categories", () => {
  for (const [input, expected] of [["日常", "生活碎片"], ["生活碎片", "生活碎片"], ["旅行日记", "旅行日记"], ["", ""], ["无", ""]]) {
    const saved = parsePost(postContent(post({ category: input, body: "## 小标题\n\n原文。" })));
    assert.equal(saved.meta.category, expected);
    assert.equal(saved.body.trim(), "## 小标题\n\n原文。");
  }
});
