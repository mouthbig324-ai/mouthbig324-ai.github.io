import MarkdownIt from "markdown-it";
import { RecordComposer } from "./record-composer";
import { unplacedMedia } from "../utils/inline-media-utils";
type Photo = { src: string; thumbnail?: string; alt: string; width: number; height: number };
type Video = { src: string; caption: string };
type Friend = { name: string; url: string; description: string; note?: string };
const parser = new MarkdownIt({ html: false, linkify: true, breaks: true });
const api = document.body.dataset.editorApi || "";
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const value = (id: string) => ($<HTMLInputElement | HTMLTextAreaElement>(id)).value;
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
const tokenKey = "zuige-owner-access";
function readEntry() {
  const incoming = new URLSearchParams(location.hash.slice(1)).get("access");
  if (!incoming || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(incoming) || incoming.length >= 2000) return null;
  localStorage.setItem(tokenKey, incoming);
  history.replaceState(null, "", location.pathname + location.search);
  return incoming;
}
readEntry();
sessionStorage.removeItem("zuige-admin-session");
let token = localStorage.getItem(tokenKey) || "";
let mode = "post"; let id = ""; let sha = ""; let cover = ""; let photoItems: Photo[] = []; let videoItems: Video[] = [];
let friendItems: Friend[] = []; let friendSha = ""; let busy = false; let storageReady = false;
const recordComposer = new RecordComposer($<HTMLTextAreaElement>("record-body"), $("body-editor"), {
  photoChanged(src, alt) { for (const photo of photoItems) if (photo.src === src) photo.alt = alt; recordComposer.updatePhotoAlt(src, alt); renderMedia(); },
  photoRemoved(src) { if (!recordComposer.hasPhoto(src)) { photoItems = photoItems.filter(photo => photo.src !== src); if (cover === src) cover = ""; } renderMedia(); },
});
function status(target: string, message: string, error = false) { const element = $(target); element.replaceChildren(); element.textContent = message; element.classList.toggle("error", error); }
async function request(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers); if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(api + path, { ...options, headers }); const data = await response.json();
  if (response.status === 401) { token = ""; localStorage.removeItem(tokenKey); showLogin(); }
  if (!response.ok) throw new Error(data.error || "操作未完成，请稍后再试。"); return data;
}
const send = (path: string, data: unknown) => request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
function showLogin() { $("login-panel").hidden = false; $("editor-panel").hidden = true; $("logout").hidden = true; }
async function showEditor() {
  const state = await request("/admin/status");
  storageReady = state.storage === true;
  $("storage-status").textContent = state.storage ? `照片存储：${(state.usedBytes / 1e9).toFixed(2)} / ${(state.maxBytes / 1e9).toFixed(0)} GB` : "照片存储尚未连接";
  $("choose-media").classList.toggle("unavailable", !storageReady);
  $("choose-media").setAttribute("aria-disabled", String(!storageReady));
  $("login-panel").hidden = true; $("editor-panel").hidden = false; $("logout").hidden = false;
  await selectMode("post");
}
$("logout").addEventListener("click", () => { token = ""; localStorage.removeItem(tokenKey); showLogin(); });
const message = (error: unknown) => error instanceof Error ? error.message : "操作未完成，请稍后再试。";
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) button.addEventListener("click", () => { selectMode(button.dataset.mode!).catch(error => status("save-status", message(error), true)); });
async function selectMode(next: string) {
  if (busy) return;
  busy = true; setBusy(true);
  try {
  mode = next; for (const button of document.querySelectorAll<HTMLElement>("[data-mode]")) button.classList.toggle("active", button.dataset.mode === mode);
  $("record-layout").hidden = !["post", "album"].includes(mode); $("friends-panel").hidden = mode !== "friends"; $("comments-panel").hidden = mode !== "comments";
  if (mode === "friends") return await loadFriends(); if (mode === "comments") return await loadComments();
  for (const element of document.querySelectorAll<HTMLElement>(".post-only")) element.hidden = mode === "album";
  $("title-label").textContent = mode === "album" ? "相册名称" : "标题"; $("description-label").textContent = mode === "album" ? "相册简介" : "简短介绍";
  $("new-record").textContent = mode === "album" ? "＋ 新建相册" : "＋ 新建记录";
  $("media-note").textContent = storageReady ? (mode === "album" ? "照片按原图上传，不压缩、不改动设备上的原件。每张最多64 MB。" : "照片上传后插在正文光标位置，原图不压缩。下方列表用于管理附件；视频显示在正文后。每个文件最多64 MB。") : mode === "album" ? "云存储尚未开通，暂时不能上传照片。" : "附件上传尚未开通。可以先写文字，或添加已有的视频直链。";
  reset(); await loadRecords();
  } finally { busy = false; setBusy(false); }
}
function reset() {
  id = `${mode}-${today().replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6)}`; sha = ""; cover = ""; photoItems = []; videoItems = [];
  $<HTMLFormElement>("record-form").reset(); recordComposer.setBody("", []); input("record-date").value = today(); $("preview").hidden = true; status("save-status", ""); status("upload-status", ""); renderMedia();
}
$("new-record").addEventListener("click", reset);
async function loadRecords() {
  const list = $("record-list"); list.textContent = "正在加载记录…";
  try {
    const data = await request(`/admin/records?kind=${mode}`); list.replaceChildren();
    if (!data.items.length) list.textContent = "还没有记录。";
    for (const item of data.items as { id: string; title?: string; draft?: boolean }[]) { const button = document.createElement("button"); button.textContent = (item.draft ? "草稿 · " : "") + (item.title || item.id); button.addEventListener("click", () => openRecord(item.id).catch(error => status("save-status", message(error), true))); list.append(button); }
  } catch (error) { list.textContent = message(error); }
}
async function openRecord(key: string) {
  if (busy) return; busy = true; setBusy(true);
  try {
  const data = await request(`/admin/record?kind=${mode}&id=${encodeURIComponent(key)}`); reset(); id = data.id; sha = data.sha;
  const meta = data.meta; input("record-title").value = meta.title || ""; input("record-date").value = String(mode === "album" ? meta.date : meta.published).slice(0, 10); $<HTMLTextAreaElement>("description").value = meta.description || "";
  $<HTMLTextAreaElement>("record-body").value = data.body || ""; $<HTMLSelectElement>("category").value = meta.category || ""; input("featured").checked = !!meta.featured;
  input("tags").value = (meta.tags || []).join("、"); photoItems = meta.photos || []; videoItems = meta.videos || []; cover = meta.image || ""; recordComposer.setBody(data.body || "", photoItems); renderMedia();
  status("save-status", meta.draft ? "这条记录目前是草稿。" : "这条记录已发布。");
  } finally { busy = false; setBusy(false); }
}
function renderMedia() {
  const list = $("media-list"); list.replaceChildren();
  photoItems.forEach((photo, index) => {
    const card = document.createElement("div"); card.className = "media-item";
    const image = document.createElement("img"); image.src = photo.thumbnail || photo.src; image.alt = photo.alt;
    const caption = document.createElement("input"); caption.placeholder = "照片说明（可选）"; caption.value = photo.alt; caption.maxLength = 300; caption.disabled = busy; caption.addEventListener("input", () => { photo.alt = caption.value; recordComposer.updatePhotoAlt(photo.src, caption.value); });
    const controls = document.createElement("div"); controls.className = "media-controls";
    if (mode === "post") { const insert = document.createElement("button"); insert.type = "button"; insert.textContent = recordComposer.hasPhoto(photo.src) ? "再次插入正文" : "插入正文"; insert.disabled = busy; insert.addEventListener("click", () => { recordComposer.insertPhoto(photo); renderMedia(); }); controls.append(insert); }
    for (const [label, action] of [["←", () => { if (index > 0) [photoItems[index - 1], photoItems[index]] = [photoItems[index], photoItems[index - 1]]; renderMedia(); }], ["→", () => { if (index < photoItems.length - 1) [photoItems[index + 1], photoItems[index]] = [photoItems[index], photoItems[index + 1]]; renderMedia(); }], [cover === photo.src ? "已作封面" : "设为封面", () => { cover = photo.src; renderMedia(); }], ["移除", () => { photoItems.splice(index, 1); recordComposer.removePhoto(photo.src); if (cover === photo.src) cover = ""; renderMedia(); }]] as [string, () => void][]) { const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.disabled = busy; button.addEventListener("click", action); controls.append(button); }
    card.append(image, caption, controls); list.append(card);
  });
  videoItems.forEach((video, index) => {
    const card = document.createElement("div"); card.className = "media-item"; const player = document.createElement("video"); player.src = video.src; player.controls = true; player.preload = "metadata";
    const caption = document.createElement("input"); caption.placeholder = "视频说明（可选）"; caption.value = video.caption; caption.disabled = busy; caption.addEventListener("input", () => { video.caption = caption.value; });
    const button = document.createElement("button"); button.textContent = "移除"; button.type = "button"; button.disabled = busy; button.addEventListener("click", () => { videoItems.splice(index, 1); renderMedia(); }); card.append(player, caption, button); list.append(card);
  });
}
async function photoDimensions(file: File) {
  let image: ImageBitmap;
  try { image = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { throw new Error("这张照片暂时无法读取，请先导出为 JPG 或 PNG。"); }
  try {
    return { width: image.width, height: image.height };
  } finally { image.close(); }
}
async function upload(blob: Blob, width = 0, height = 0) { return request("/admin/media", { method: "POST", headers: { "Content-Type": blob.type, "X-Media-Width": String(width), "X-Media-Height": String(height) }, body: blob }); }
$("insert-photo").addEventListener("click", () => { if (busy || !storageReady) return; input("media-files").accept = "image/jpeg,image/png,image/webp,image/avif"; input("media-files").click(); });
$("choose-media").addEventListener("click", () => { input("media-files").accept = mode === "album" ? "image/jpeg,image/png,image/webp,image/avif" : "image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm"; });
input("media-files").addEventListener("change", async () => {
  if (busy) return; const files = [...(input("media-files").files || [])]; if (!files.length) return; busy = true; setBusy(true);
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index]; status("upload-status", `正在处理 ${index + 1}/${files.length}：${file.name}`);
      if (file.type.startsWith("image/")) { if (file.size > 64 * 1024 * 1024) throw new Error("照片超过64 MB，请选择较小的原图。"); const dimensions = await photoDimensions(file); const saved = await upload(file, dimensions.width, dimensions.height); const photo = { src: saved.src, alt: "", width: saved.width, height: saved.height }; photoItems.push(photo); if (mode === "post") recordComposer.insertPhoto(photo); }
      else { if (mode === "album") throw new Error("相册目前收录照片，视频请放入日记或生活碎片。"); if (file.size > 64 * 1024 * 1024) throw new Error("视频超过64 MB，请先压缩或使用已有视频链接。"); const saved = await upload(file); videoItems.push({ src: saved.src, caption: "" }); }
      renderMedia();
    }
    status("upload-status", "已上传，准备好后可以保存草稿或发布。");
  } catch (error) { status("upload-status", message(error), true); }
  finally { busy = false; setBusy(false); input("media-files").value = ""; if (mode === "post") recordComposer.focusCursor(); }
});
$("add-video").addEventListener("click", () => { const src = value("video-url").trim(); if (!/^https:\/\/[^\s]+$/.test(src)) return status("upload-status", "请填写有效的 HTTPS 视频链接。", true); videoItems.push({ src, caption: "" }); input("video-url").value = ""; renderMedia(); });
function setBusy(state: boolean) { for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement>("#editor-panel button, #editor-panel input, #editor-panel textarea, #editor-panel select")) control.disabled = state; recordComposer.setDisabled(state); input("media-files").disabled = state || !storageReady; $<HTMLButtonElement>("insert-photo").disabled = state || !storageReady; }
async function save(draft: boolean) {
  if (busy || !$<HTMLFormElement>("record-form").reportValidity()) return; busy = true; setBusy(true); status("save-status", "正在保存…");
  try {
    const result = await send("/admin/record", { kind: mode, id, sha, title: value("record-title"), date: value("record-date"), description: value("description"), body: value("record-body"), category: value("category"), tags: value("tags").split(/[,，、]/).map(tag => tag.trim()).filter(Boolean), image: cover, draft, featured: input("featured").checked, photos: photoItems, videos: videoItems });
    sha = result.sha; status("save-status", draft ? "草稿已保存。" : "已提交发布，网站正在自动更新。");
    if (!draft) { const link = document.createElement("a"); link.href = result.url; link.target = "_blank"; link.rel = "noopener"; link.textContent = " 查看记录 ↗"; $("save-status").append(link); }
    await loadRecords();
  } catch (error) { status("save-status", message(error), true); }
  finally { busy = false; setBusy(false); }
}
$("record-form").addEventListener("submit", event => { event.preventDefault(); void save(false); }); $("save-draft").addEventListener("click", () => { void save(true); });
$("preview-toggle").addEventListener("click", () => {
  $("preview").hidden = !$("preview").hidden; $("preview-title").textContent = value("record-title"); $("preview-body").innerHTML = parser.render(mode === "album" ? value("description") : value("record-body"));
  const target = $("preview-media"); target.replaceChildren();
  const attachments = mode === "album" ? { photos: photoItems, videos: videoItems } : unplacedMedia(value("record-body"), photoItems, videoItems);
  for (const photo of attachments.photos) { const image = document.createElement("img"); image.src = photo.thumbnail || photo.src; image.alt = photo.alt; image.style.width = "100%"; image.style.borderRadius = "10px"; target.append(image); }
  for (const video of attachments.videos) { const player = document.createElement("video"); player.src = video.src; player.controls = true; player.style.width = "100%"; target.append(player); }
  if (!$("preview").hidden) $("preview").scrollIntoView({ behavior: "smooth", block: "start" });
});
async function loadFriends() { try { const data = await request("/admin/record?kind=friends&id=friends"); friendItems = data.meta; friendSha = data.sha; renderFriends(); } catch (error) { status("friends-status", message(error), true); } }
function renderFriends() {
  const list = $("friend-list"); list.replaceChildren();
  friendItems.forEach((friend, index) => {
    const row = document.createElement("div"); row.className = "friend-row";
    const heading = document.createElement("div"); heading.className = "friend-row-heading";
    const title = document.createElement("strong"); title.textContent = friend.name || `友链 ${index + 1}`;
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "移除友链";
    remove.addEventListener("click", () => { friendItems.splice(index, 1); renderFriends(); });
    heading.append(title, remove); row.append(heading);
    for (const [field, label, placeholder, maximum] of [
      ["name", "网站名称", "例如 Clairis", 80],
      ["url", "网站地址", "https://example.com/", 2000],
      ["description", "网站简介", "这里主要分享什么内容？", 250],
      ["note", "嘴哥备注（公开显示）", "例如：认识的朋友，或者想记住的一句话", 250],
    ] as [keyof Friend, string, string, number][]) {
      const wrapper = document.createElement("label"); wrapper.className = `friend-field friend-field-${field}`;
      const caption = document.createElement("span"); caption.textContent = label;
      const control = field === "note" || field === "description" ? document.createElement("textarea") : document.createElement("input");
      if (control instanceof HTMLTextAreaElement) control.rows = 2;
      if (control instanceof HTMLInputElement && field === "url") control.type = "url";
      control.placeholder = placeholder; control.value = friend[field] || ""; control.maxLength = maximum;
      control.addEventListener("input", () => { friend[field] = control.value; if (field === "name") title.textContent = control.value || `友链 ${index + 1}`; });
      wrapper.append(caption, control); row.append(wrapper);
    }
    list.append(row);
  });
}
$("add-friend").addEventListener("click", () => { friendItems.push({ name: "", url: "", description: "", note: "" }); renderFriends(); });
$("save-friends").addEventListener("click", async () => { status("friends-status", "正在保存…"); try { const result = await send("/admin/record", { kind: "friends", id: "friends", sha: friendSha, items: friendItems }); friendSha = result.sha; status("friends-status", "友链已保存，网站正在更新。"); } catch (error) { status("friends-status", message(error), true); } });
async function loadComments() {
  const list = $("admin-comment-list"); list.textContent = "正在加载留言…";
  try {
    const data = await request("/admin/comments"); list.replaceChildren(); if (!data.items.length) list.textContent = "还没有留言。";
    for (const item of data.items as { id: string; name: string; email: string; path: string; body: string; created: string }[]) {
      const card = document.createElement("article"); card.className = "admin-comment"; const title = document.createElement("strong"); title.textContent = `${item.name} · ${new Date(item.created).toLocaleString("zh-CN")}`;
      const context = document.createElement("p"); context.className = "muted small"; context.textContent = `${item.path} · ${item.email}`; const body = document.createElement("p"); body.textContent = item.body;
      const reply = document.createElement("textarea"); reply.rows = 2; reply.placeholder = "回复这条留言…"; const actions = document.createElement("div"); actions.className = "actions";
      const submit = document.createElement("button"); submit.textContent = "回复"; submit.className = "primary"; submit.addEventListener("click", async () => { try { await send("/admin/comments/reply", { id: item.id, body: reply.value }); reply.value = ""; status("comments-status", "回复已发表。"); await loadComments(); } catch (error) { status("comments-status", message(error), true); } });
      const hide = document.createElement("button"); hide.textContent = "隐藏"; hide.addEventListener("click", async () => { try { await send("/admin/comments/hide", { id: item.id }); await loadComments(); } catch (error) { status("comments-status", message(error), true); } });
      actions.append(submit, hide); card.append(title, context, body, reply, actions); list.append(card);
    }
  } catch (error) { list.textContent = message(error); }
}
if (!api) { status("login-status", "管理服务还未连接。完成账户接入后，即可开始记录。"); }
else if (token) showEditor().catch(error => { showLogin(); status("login-status", message(error), true); });
window.addEventListener("hashchange", () => {
  const incoming = readEntry(); if (!incoming || !api) return;
  token = incoming; status("login-status", "正在打开记录管理…");
  showEditor().catch(error => { showLogin(); status("login-status", message(error), true); });
});
