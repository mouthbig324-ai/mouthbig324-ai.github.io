import { draftPrefix, listLocalDrafts, writeLocalDraft, type LocalDraft, type LocalRecord } from "./local-drafts";

export function setupDraftRecovery(options: {
  capture: () => LocalRecord;
  restore: (record: LocalRecord) => Promise<void>;
  latest: (record: LocalRecord) => Promise<{ sha: string; body?: string; meta: Record<string, unknown> }>;
  isBusy: () => boolean;
  copyAsNew: () => void;
}) {
  const $ = (id: string) => document.getElementById(id)!;
  let ready = false;
  let baseline = "";
  let key = "";
  let lastWritten = "";
  let source: LocalDraft | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const serialize = () => JSON.stringify(options.capture());
  const dirty = () => ready && serialize() !== baseline;
  const say = (text: string, error = false) => { $("local-save-status").textContent = text; $("local-save-status").classList.toggle("error", error); };
  function removeSource() {
    if (source && localStorage.getItem(source.key) === JSON.stringify(source)) localStorage.removeItem(source.key);
    source = undefined;
  }
  function render() {
    const list = $("local-draft-list"); list.replaceChildren();
    try {
      const drafts = listLocalDrafts(localStorage);
      $("local-draft-count").textContent = `本机未提交的记录（${drafts.length}）`;
      for (const draft of drafts) {
        const row = document.createElement("div"); row.className = "local-draft-row";
        const title = document.createElement("span");
        title.textContent = `${draft.record.title || "未命名记录"} · ${draft.record.kind === "album" ? "相册" : "日记"} · ${new Date(draft.updated).toLocaleString("zh-CN")}`;
        const restore = document.createElement("button"); restore.type = "button"; restore.textContent = draft.key === key ? "正在编辑" : "恢复"; restore.disabled = draft.key === key;
        restore.addEventListener("click", async () => {
          if (options.isBusy() || !leave()) return;
          try {
            // Clone so subsequent edits cannot alter the saved recovery point.
            const record = structuredClone(draft.record);
            await options.restore(record);
            baseline = draft.baseline; source = draft; key = draftPrefix + crypto.randomUUID(); lastWritten = ""; ready = true;
            const stored = flush();
            if (stored) say("已恢复本机内容，尚未提交到网站。");
            if (record.sha) {
              try {
                const latest = await options.latest(record);
                if (ready && options.capture().id === record.id && options.capture().sha === record.sha && latest.sha !== record.sha) await showConflict(latest);
              } catch {
                if (stored && ready && options.capture().id === record.id) say("已恢复本机内容，暂时无法核对线上版本；提交时仍会检查冲突。", true);
              }
            }
          } catch { say("暂存恢复失败，原暂存仍保留，可先导出。", true); }
        });
        const download = document.createElement("button"); download.type = "button"; download.textContent = "导出";
        download.addEventListener("click", () => exportRecord(draft.record));
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "删除暂存";
        remove.addEventListener("click", () => {
          if (options.isBusy() || !confirm("删除这份本机暂存？不会删除网站文章或原图。")) return;
          try { localStorage.removeItem(draft.key); if (draft.key === key) lastWritten = ""; if (source?.key === draft.key) source = undefined; render(); }
          catch { say("无法删除本机暂存。", true); }
        });
        const actions = document.createElement("div"); actions.className = "actions"; actions.append(restore, download, remove); row.append(title, actions); list.append(row);
      }
      if (!drafts.length) list.textContent = "暂无未提交的本机暂存。";
    } catch { say("浏览器无法使用本机暂存，请及时手动保存或导出。", true); }
  }
  function flush() {
    clearTimeout(timer);
    if (!ready) return true;
    try {
      if (!dirty()) {
        if (lastWritten) { localStorage.removeItem(key); lastWritten = ""; render(); }
        return true;
      }
      const serialized = serialize();
      if (serialized === lastWritten) return true;
      writeLocalDraft(localStorage, { version: 1, key, updated: Date.now(), baseline, record: options.capture() });
      lastWritten = serialized;
      say(`本机已暂存 · ${new Date().toLocaleTimeString("zh-CN")} · 尚未提交`);
      render(); return true;
    } catch (error) {
      say(error instanceof Error && error.message.includes("本机暂存空间") ? error.message : "本机暂存失败，请及时手动保存或导出当前内容。", true);
      return false;
    }
  }
  function leave() { return flush() || confirm("本机暂存失败，离开可能丢失当前修改。建议取消并先导出。仍要离开吗？"); }
  function begin() {
    clearTimeout(timer); ready = ["post", "album"].includes(options.capture().kind);
    baseline = serialize(); key = draftPrefix + crypto.randomUUID(); lastWritten = ""; source = undefined;
    $("record-conflict").hidden = true; say("编辑时自动暂存到本机；不会自动发布。"); render();
  }
  function saved() {
    baseline = serialize();
    try { localStorage.removeItem(key); removeSource(); say("已提交，当前本机暂存已清理。"); }
    catch { say("已提交；旧暂存未能清理，可稍后手动删除。"); }
    lastWritten = ""; $("record-conflict").hidden = true; render();
  }
  async function showConflict(latest?: { body?: string; meta: Record<string, unknown> }) {
    flush(); $("record-conflict").hidden = false;
    const field = $("latest-record") as HTMLTextAreaElement;
    field.value = "正在读取线上最新内容…";
    try {
      const current = latest || await options.latest(options.capture());
      const meta = current.meta;
      field.value = [
        `标题：${meta.title || ""}`, `日期：${String(meta.published || meta.date || "").slice(0, 10)}`,
        `简介：${meta.description || ""}`, `类型：${meta.category || "无"}`,
        `旅行系列：${meta.series || "未加入"}`, `旅行日期：${meta.tripDate || "未填写"}`,
        `地点：${meta.location || "未填写"}`, `系列顺序：${meta.seriesOrder || "自动"}`,
        "", current.body || "",
        "", "附件照片：", ...(Array.isArray(meta.photos) ? meta.photos.map(photo => `${photo.alt || "未填写说明"}\n${photo.src}`) : []),
      ].join("\n");
    } catch { field.value = "暂时无法读取线上版本。你的本机修改仍在编辑框中，请先导出，稍后再核对。"; }
  }
  function exportRecord(record: LocalRecord) {
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `嘴哥-本机记录-${record.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  $("export-local-record").addEventListener("click", () => exportRecord(options.capture()));
  $("copy-local-record").addEventListener("click", () => {
    if (options.isBusy() || !leave()) return;
    options.copyAsNew(); baseline = ""; key = draftPrefix + crypto.randomUUID(); lastWritten = ""; source = undefined;
    $("record-conflict").hidden = true;
    if (flush()) say("已复制为新记录，原记录保持不变。检查标题后可保存或发布。");
  });
  $("reload-latest-record").addEventListener("click", () => { void showConflict(); });
  const schedule = () => { if (!ready) return; clearTimeout(timer); timer = setTimeout(flush, 500); };
  // Run after editor handlers, including photo insertion, reordering and removal.
  for (const event of ["input", "change", "click"]) $("record-form").addEventListener(event, schedule);
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("beforeunload", event => { flush(); if (dirty()) { event.preventDefault(); event.returnValue = ""; } });
  window.addEventListener("storage", event => { if (event.key?.startsWith(draftPrefix) || event.key === null) { lastWritten = ""; render(); } });
  return { begin, saved, flush, leave, showConflict, render, suspend() { ready = false; clearTimeout(timer); } };
}
