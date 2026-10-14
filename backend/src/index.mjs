import { parse as parseYaml } from "yaml";

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const json = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
const encoder = new TextEncoder();
const now = () => new Date().toISOString();
function b64(bytes) { let binary = ""; for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768)); return btoa(binary); }
const b64url = bytes => b64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
function unbase64(value) { return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0)); }
async function sign(value, secret) { const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))); }
function same(a, b) { if (a.length !== b.length) return false; let diff = 0; for (let index = 0; index < a.length; index++) diff |= a[index] ^ b[index]; return diff === 0; }
function configured(env) { if (!env.DB) fail(503, "服务尚未完成连接。"); }
async function owner(request, env) {
  if (!env.SESSION_SECRET) fail(503, "管理入口尚未完成设置。");
  const value = request.headers.get("Authorization")?.replace(/^Bearer /, "") || "";
  try {
    const [payload, signature, extra] = value.split(".");
    if (!payload || !signature || extra !== undefined || !same(await sign(payload, env.SESSION_SECRET), unbase64(signature))) fail(401, "请使用自己的专用管理入口。");
    const data = JSON.parse(new TextDecoder().decode(unbase64(payload)));
    if (data.role !== "owner" || !Number.isFinite(data.expires) || data.expires < Date.now()) fail(401, "管理入口已过期，请更新专用入口。");
  } catch (error) { if (error instanceof HttpError) throw error; fail(401, "请使用自己的专用管理入口。"); }
}
async function bodyJson(request, limit = 250000) {
  const reader = request.body?.getReader(); if (!reader) fail(400, "缺少内容。");
  const decoder = new TextDecoder(); let length = 0; let value = "";
  for (;;) { const next = await reader.read(); if (next.done) break; length += next.value.byteLength; if (length > limit) { await reader.cancel(); fail(413, "内容过长，请分成多篇记录。"); } value += decoder.decode(next.value, { stream: true }); }
  value += decoder.decode();
  try { return JSON.parse(value); } catch { fail(400, "提交的内容格式不正确。"); }
}
async function rateLimit(request, env, scope, maximum, seconds) {
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const secret = env.SESSION_SECRET || env.RATE_LIMIT_SECRET;
  if (!secret) fail(503, "留言服务还未完成配置。");
  const hash = b64url(await sign(`${scope}:${request.headers.get("CF-Connecting-IP") || "local"}:${bucket}`, secret));
  const record = await env.DB.prepare("INSERT INTO request_limits(id, count, expires) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET count = count + 1 RETURNING count").bind(hash, (bucket + 1) * seconds).first();
  if (record.count > maximum) fail(429, "操作有些频繁，请稍后再试。");
}
function text(value, maximum, label, required = false) { if (typeof value !== "string" || value.length > maximum || (required && !value.trim())) fail(400, `${label}格式不正确。`); return value.trim(); }
function slug(value) { if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 64) fail(400, "记录标识只接受英文小写、数字和短横线。"); return value; }
function date(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) fail(400, "请填写有效日期。"); const parsed = new Date(value + "T00:00:00Z"); if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) fail(400, "请填写有效日期。"); return value; }
function httpsUrl(value) {
  try { const parsed = new URL(value); if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password || /[\s<>"\\]/.test(value)) throw new Error(); return value; }
  catch { fail(400, "请填写有效的 HTTPS 地址。"); }
}
function source(value) { if (typeof value !== "string" || value.length > 2000) fail(400, "图片或视频链接格式不正确。"); if (/^\/(?!\/)[^\s<>"\\]+$/.test(value)) return value; return httpsUrl(value); }
function photos(value) {
  if (!Array.isArray(value) || value.length > 100) fail(400, "每条记录最多放100张照片。");
  return value.map(photo => { if (!Number.isInteger(photo.width) || !Number.isInteger(photo.height) || photo.width < 1 || photo.height < 1 || photo.width > 20000 || photo.height > 20000) fail(400, "照片尺寸不正确。"); return { src: source(photo.src), ...(photo.thumbnail ? { thumbnail: source(photo.thumbnail) } : {}), alt: text(photo.alt || "", 300, "照片说明"), width: photo.width, height: photo.height }; });
}
function videos(value) { if (!Array.isArray(value) || value.length > 10) fail(400, "每条记录最多放10段视频。"); return value.map(video => ({ src: source(video.src), caption: text(video.caption || "", 300, "视频说明") })); }
function recordPath(kind, id) { const key = slug(id); if (kind === "album") return `src/data/albums/${key}.json`; if (kind === "post") return `src/content/posts/${key}.md`; if (kind === "friends" && key === "friends") return "src/data/friends.json"; fail(400, "不支持的记录类型。"); }
async function github(env, path, method = "GET", data, allow404 = false) {
  if (!env.GITHUB_TOKEN) fail(503, "发布权限尚未连接，请完成首次设置。");
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}${path}`, { method, headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "zuige-blog-editor", "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
  if (allow404 && response.status === 404) return null;
  const result = await response.json();
  if (!response.ok) { if (response.status === 409 || response.status === 422) fail(409, "这条记录已在别处修改，请重新打开后再保存。"); if (response.status === 401 || response.status === 403) fail(503, "仓库发布权限暂不可用，请检查首次连接设置。"); fail(502, "发布服务暂不可用，请稍后重试。"); }
  return result;
}
const contentRoute = path => "/contents/" + path.split("/").map(encodeURIComponent).join("/");
function decodeContent(result) { return new TextDecoder().decode(unbase64(result.content.replace(/\s/g, ""))); }
export function parsePost(raw) { const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/); if (!match) return { meta: {}, body: raw }; return { meta: parseYaml(match[1]) || {}, body: match[2].trim() }; }
export function postContent(data) {
  const title = text(data.title, 160, "标题", true); const published = date(data.date);
  const category = data.category === "旅行日记" ? "旅行日记" : "生活碎片";
  const tags = Array.isArray(data.tags) ? data.tags.slice(0, 20).map(tag => text(tag, 40, "标签", true)) : [];
  const meta = { title, published, updated: new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date()), description: text(data.description || "", 500, "摘要"), image: data.image ? source(data.image) : "", tags, category, draft: data.draft === true, featured: data.featured === true, photos: photos(data.photos || []), videos: videos(data.videos || []), lang: "zh_CN" };
  return "---\n" + Object.entries(meta).map(([key, value]) => `${key}: ${key === "published" || key === "updated" ? value : JSON.stringify(value)}`).join("\n") + "\n---\n\n" + text(data.body || "", 200000, "正文") + "\n";
}
async function listRecords(env, kind) {
  const prefix = kind === "album" ? "src/data/albums/" : "src/content/posts/";
  const suffix = kind === "album" ? ".json" : ".md";
  const tree = await github(env, "/git/trees/main?recursive=1");
  if (tree.truncated) fail(503, "记录列表过大，请联系管理员调整索引。");
  const cached = await env.DB.prepare("SELECT id, title, date, draft FROM record_index WHERE kind = ?").bind(kind).all();
  const titles = new Map(cached.results.map(item => [item.id, item]));
  try {
    const response = await fetch(`${env.BLOG_ORIGIN}/records.json`);
    if (response.ok) { const publicItems = await response.json(); for (const item of publicItems.filter(item => item.kind === kind)) if (!titles.has(item.id)) titles.set(item.id, item); }
  } catch { /* The repository remains usable if the public site is unavailable. */ }
  return tree.tree.filter(item => item.type === "blob" && item.path.startsWith(prefix) && item.path.endsWith(suffix) && !item.path.slice(prefix.length).includes("/")).map(item => {
    const id = item.path.slice(prefix.length, -suffix.length); return { ...(titles.get(id) || {}), id, sha: item.sha };
  }).sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.id.localeCompare(b.id));
}
async function indexRecord(env, kind, id, meta) {
  if (kind === "friends") return;
  await env.DB.prepare("INSERT INTO record_index(kind, id, title, date, draft) VALUES (?, ?, ?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET title=excluded.title, date=excluded.date, draft=excluded.draft").bind(kind, id, meta.title || id, String(meta.date || meta.published || "").slice(0, 10), meta.draft ? 1 : 0).run();
}
async function readRecord(env, kind, id) {
  const result = await github(env, contentRoute(recordPath(kind, id)) + "?ref=main", "GET", undefined, true);
  if (!result) fail(404, "记录不存在。"); const raw = decodeContent(result);
  const content = kind === "post" ? parsePost(raw) : { meta: JSON.parse(raw) };
  await indexRecord(env, kind, id, content.meta);
  return { id, sha: result.sha, ...content };
}
async function saveRecord(env, data) {
  const { kind } = data; const id = kind === "friends" ? "friends" : slug(data.id); const path = recordPath(kind, id);
  let raw;
  if (kind === "post") raw = postContent(data);
  else if (kind === "album") raw = JSON.stringify({ title: text(data.title, 160, "相册名称", true), date: date(data.date), description: text(data.description || "", 2000, "相册简介"), draft: data.draft === true, photos: photos(data.photos || []) }, null, 2) + "\n";
  else {
    if (!Array.isArray(data.items) || data.items.length > 100) fail(400, "友链格式不正确。");
    raw = JSON.stringify(data.items.map(friend => ({ name: text(friend.name, 80, "网站名称", true), url: httpsUrl(text(friend.url, 2000, "网站地址", true)), description: text(friend.description || "", 250, "简介"), note: text(friend.note || "", 250, "备注") })), null, 2) + "\n";
  }
  const existing = await github(env, contentRoute(path) + "?ref=main", "GET", undefined, true);
  if ((existing?.sha || "") !== (data.sha || "")) fail(409, "这条记录已经变化，请重新打开后再保存，避免覆盖内容。");
  const result = await github(env, contentRoute(path), "PUT", { message: `${data.draft ? "Save draft" : "Publish"} ${kind}: ${id}`, content: b64(encoder.encode(raw)), branch: "main", ...(existing ? { sha: existing.sha } : {}) });
  await indexRecord(env, kind, id, data).catch(() => {});
  return { id, sha: result.content.sha, commit: result.commit.sha, draft: data.draft === true, url: kind === "post" ? `${env.BLOG_ORIGIN}/posts/${id}/` : kind === "album" ? `${env.BLOG_ORIGIN}/albums/${id}/` : `${env.BLOG_ORIGIN}/friends/` };
}
async function upload(request, env, requestUrl) {
  if (!env.BUCKET) fail(503, "照片存储尚未开通。");
  const type = request.headers.get("Content-Type")?.split(";")[0];
  const extensions = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png", "image/avif": "avif", "video/mp4": "mp4", "video/webm": "webm" };
  if (!extensions[type]) fail(400, "目前支持常见照片，以及 MP4、WebM 视频。");
  const size = Number(request.headers.get("Content-Length")); const maximum = 64 * 1024 * 1024;
  if (!Number.isInteger(size) || size < 1 || size > maximum) fail(413, type.startsWith("image/") ? "照片超过64 MB，请选择较小的照片。" : "视频超过64 MB，请先压缩或使用已有视频链接。");
  const width = Math.max(0, Math.min(20000, Number(request.headers.get("X-Media-Width")) || 0)); const height = Math.max(0, Math.min(20000, Number(request.headers.get("X-Media-Height")) || 0));
  if (type.startsWith("image/") && (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)) fail(400, "照片尺寸缺失。");
  const budget = Number(env.MAX_STORAGE_BYTES || "10000000000");
  const reserved = await env.DB.prepare("UPDATE storage_budget SET used_bytes = used_bytes + ? WHERE id = 1 AND used_bytes + ? <= ?").bind(size, size, budget).run();
  if (!reserved.meta?.changes) fail(507, "存储空间接近设定上限，请整理后再上传。");
  const id = crypto.randomUUID(); const key = `media/${now().slice(0, 7).replace("-", "/")}/${id}.${extensions[type]}`;
  try {
    await env.BUCKET.put(key, request.body, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
    await env.DB.prepare("INSERT INTO media(id, object_key, type, size, width, height, created) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, key, type, size, width, height, now()).run();
  } catch (error) {
    const removed = await env.BUCKET.delete(key).then(() => true, () => false);
    // Keep the reservation when cleanup fails: the object may still occupy storage.
    if (removed) await env.DB.prepare("UPDATE storage_budget SET used_bytes = MAX(0, used_bytes - ?) WHERE id = 1").bind(size).run();
    throw error;
  }
  return { id, src: requestUrl.origin + "/" + key, type, size, width, height };
}
function mediaCondition(headers, object) {
  const modified = Math.floor(object.uploaded.getTime() / 1000) * 1000;
  const matches = (value, weak = false) => value.split(",").some(item => { const tag = item.trim(); return tag === "*" || (weak ? tag.replace(/^W\//, "") : tag) === object.httpEtag; });
  const match = headers.get("If-Match");
  if (match !== null) { if (!matches(match)) return 412; }
  else { const since = Date.parse(headers.get("If-Unmodified-Since")); if (Number.isFinite(since) && modified > since) return 412; }
  const none = headers.get("If-None-Match");
  if (none !== null) { if (matches(none, true)) return 304; }
  else { const since = Date.parse(headers.get("If-Modified-Since")); if (Number.isFinite(since) && modified <= since) return 304; }
  return 0;
}
function mediaRange(value, size) {
  const parts = value?.trim().match(/^bytes=(\d*)-(\d*)$/i);
  // Unsupported or malformed ranges fall back to the complete representation.
  if (!parts || (!parts[1] && !parts[2])) return null;
  if (!parts[1]) {
    const length = Math.min(Number(parts[2]), size);
    return length ? { offset: size - length, length } : { unsatisfiable: true };
  }
  const offset = Number(parts[1]); const end = parts[2] ? Number(parts[2]) : size - 1;
  if (parts[2] && end < offset) return null;
  if (offset >= size) return { unsatisfiable: true };
  return { offset, length: Math.min(end, size - 1) - offset + 1 };
}
async function serveMedia(request, env, url) {
  if (!env.BUCKET || !/^\/media\/\d{4}\/\d{2}\/[a-f0-9-]+\.(webp|jpg|png|avif|mp4|webm)$/.test(url.pathname)) fail(404, "文件不存在。");
  const key = url.pathname.slice(1); const metadataOnly = request.method === "HEAD" || request.headers.has("Range");
  const object = metadataOnly ? await env.BUCKET.head(key) : await env.BUCKET.get(key);
  if (!object) fail(404, "文件不存在。");
  const headers = new Headers({ "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" }); object.writeHttpMetadata(headers); headers.set("ETag", object.httpEtag); headers.set("Last-Modified", object.uploaded.toUTCString());
  const condition = mediaCondition(request.headers, object);
  if (condition) { if ("body" in object) await object.body.cancel(); return new Response(null, { status: condition, headers }); }
  if (request.method === "HEAD") { headers.set("Content-Length", String(object.size)); return new Response(null, { headers }); }
  const ifRange = request.headers.get("If-Range"); const modified = Math.floor(object.uploaded.getTime() / 1000) * 1000;
  const allowRange = !ifRange || ifRange === object.httpEtag || Date.parse(ifRange) === modified;
  const range = allowRange ? mediaRange(request.headers.get("Range"), object.size) : null;
  if (range?.unsatisfiable) { headers.set("Content-Range", `bytes */${object.size}`); return new Response(null, { status: 416, headers }); }
  const content = "body" in object ? object : await env.BUCKET.get(key, range ? { range } : undefined);
  if (!content) fail(404, "文件不存在。");
  headers.set("Content-Length", String(range ? range.length : object.size));
  if (range) headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
  return new Response(content.body, { status: range ? 206 : 200, headers });
}
function commentPath(value) { const result = text(value, 160, "留言位置", true); if (!/^\/(posts|albums)\/[a-z0-9-]+\/$/.test(result)) fail(400, "留言位置不正确。"); return result; }
async function route(request, env) {
  const url = new URL(request.url); const path = url.pathname;
  if (path === "/health") return json({ ok: true, comments: !!env.DB, storage: !!env.BUCKET, publishing: !!env.GITHUB_TOKEN, login: !!env.SESSION_SECRET, authMode: "private-link" });
  if (path.startsWith("/media/") && ["GET", "HEAD"].includes(request.method)) return serveMedia(request, env, url);
  configured(env);
  if (path === "/comments" && request.method === "GET") { const target = commentPath(url.searchParams.get("path")); const result = await env.DB.prepare("SELECT id, name, body, created, owner, parent_id FROM comments WHERE path = ? AND hidden = 0 ORDER BY created ASC LIMIT 300").bind(target).all(); return json({ comments: result.results }); }
  if (path === "/comments" && request.method === "POST") {
    await rateLimit(request, env, "comment", 8, 600); const data = await bodyJson(request, 12000);
    if (data.company) return json({ ok: true }); const target = commentPath(data.path); const name = text(data.name, 40, "昵称", true); const email = text(data.email, 160, "邮箱", true); const body = text(data.body, 3000, "留言", true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "邮箱格式不正确。");
    await env.DB.prepare("INSERT INTO comments(id, path, name, email, body, created) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), target, name, email, body, now()).run(); return json({ ok: true }, 201);
  }
  if (!path.startsWith("/admin/")) fail(404, "页面不存在。"); await owner(request, env);
  if (path === "/admin/status") { const budget = await env.DB.prepare("SELECT used_bytes FROM storage_budget WHERE id = 1").first(); return json({ storage: !!env.BUCKET, publishing: !!env.GITHUB_TOKEN, usedBytes: budget.used_bytes, maxBytes: Number(env.MAX_STORAGE_BYTES || "10000000000") }); }
  if (path === "/admin/records" && request.method === "GET") { const kind = url.searchParams.get("kind") === "album" ? "album" : "post"; return json({ items: await listRecords(env, kind) }); }
  if (path === "/admin/record" && request.method === "GET") return json(await readRecord(env, url.searchParams.get("kind"), url.searchParams.get("id")));
  if (path === "/admin/record" && request.method === "POST") return json(await saveRecord(env, await bodyJson(request)));
  if (path === "/admin/media" && request.method === "POST") return json(await upload(request, env, url), 201);
  if (path === "/admin/media" && request.method === "GET") { const result = await env.DB.prepare("SELECT * FROM media ORDER BY created DESC LIMIT 200").all(); return json({ items: result.results.map(item => ({ ...item, src: url.origin + "/" + item.object_key })) }); }
  if (path === "/admin/comments" && request.method === "GET") { const result = await env.DB.prepare("SELECT * FROM comments WHERE hidden = 0 ORDER BY created DESC LIMIT 200").all(); return json({ items: result.results }); }
  if (path === "/admin/comments/hide" && request.method === "POST") { const data = await bodyJson(request, 1000); const id = text(data.id, 64, "留言标识", true); await env.DB.prepare("UPDATE comments SET hidden = 1 WHERE id = ?").bind(id).run(); return json({ ok: true }); }
  if (path === "/admin/comments/reply" && request.method === "POST") { const data = await bodyJson(request, 12000); const parent = await env.DB.prepare("SELECT id, path FROM comments WHERE id = ? AND hidden = 0").bind(text(data.id, 64, "留言标识", true)).first(); if (!parent) fail(404, "原留言不存在。"); await env.DB.prepare("INSERT INTO comments(id, path, name, email, body, created, parent_id, owner) VALUES (?, ?, ?, '', ?, ?, ?, 1)").bind(crypto.randomUUID(), parent.path, "嘴哥", text(data.body, 3000, "回复", true), now(), parent.id).run(); return json({ ok: true }, 201); }
  fail(404, "页面不存在。");
}
export default {
  async scheduled(_event, env) { if (env.DB) await env.DB.prepare("DELETE FROM request_limits WHERE expires < ?").bind(Math.floor(Date.now() / 1000)).run(); },
  async fetch(request, env) {
    const origin = request.headers.get("Origin"); const allowed = [env.BLOG_ORIGIN, env.ALLOWED_DEV_ORIGIN].filter(Boolean);
    if (origin && !allowed.includes(origin)) return json({ error: "请求来源不受支持。" }, 403);
    const cors = { ...(origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {}), "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Media-Width, X-Media-Height", "Access-Control-Max-Age": "3600" };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let response;
    try { response = await route(request, env); } catch (error) { response = json({ error: error instanceof HttpError ? error.message : "服务暂时不可用，请稍后重试。" }, error instanceof HttpError ? error.status : 500); }
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  }
};
