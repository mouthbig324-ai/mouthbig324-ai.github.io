import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mediaRoot = path.join(projectRoot, "public", "media");
const albumRoot = path.join(projectRoot, "src", "data", "albums");
const supported = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".tif", ".tiff"]);
const help = [
  "用法：pnpm import-photos <照片文件或文件夹> <相册标识> [选项]",
  "",
  "相册标识：小写英文字母、数字和短横线，例如 hangzhou-2026。",
  "选项：",
  "  --title <标题>        相册显示名称，默认使用相册标识",
  "  --date <YYYY-MM-DD>  拍摄日期，默认使用北京时间今天",
  "  --description <文字> 相册简介",
  "  --help               显示帮助",
  "",
  "只读取文件夹第一层的 JPEG、PNG、WebP、AVIF、TIFF 文件。",
  "生成最长边 1920 像素的 WebP 和最长边 640 像素的缩略图；不会放大小图。",
  "原件不变；生成的图片不保留 EXIF、GPS 等元数据。已有相册不会被覆盖。",
].join("\n");

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

async function exists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function parseArgs(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (!["--title", "--date", "--description"].includes(arg)) throw new Error("未知选项：" + arg);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(arg + " 后需要填写内容。");
    if (options[arg.slice(2)] !== undefined) throw new Error("选项重复：" + arg);
    options[arg.slice(2)] = value;
  }
  if (positional.length !== 2) throw new Error(help);
  const [source, slug] = positional;
  if (slug.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("相册标识只能使用小写英文字母、数字和分隔用的短横线，最多 64 个字符。");
  }
  const date = options.date || new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
  const parsedDate = new Date(date + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new Error("日期必须是真实的 YYYY-MM-DD 日期，例如 2026-10-13。");
  }
  return { source, slug, title: options.title || slug, date, description: options.description || "" };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return console.log(help);
  const { slug, title, date, description } = options;
  const source = await fs.realpath(path.resolve(options.source));
  const sourceStat = await fs.stat(source);
  if (!sourceStat.isFile() && !sourceStat.isDirectory()) throw new Error("请选择照片文件或文件夹。");
  const outputDir = path.join(mediaRoot, slug);
  const jsonPath = path.join(albumRoot, slug + ".json");
  if (inside(mediaRoot, source) || (sourceStat.isDirectory() && inside(source, outputDir))) {
    throw new Error("照片来源不能位于网站的 public/media 内，也不能包含本次输出目录。请选择本地原片文件夹。");
  }
  if (await exists(outputDir) || await exists(jsonPath)) {
    throw new Error("相册 " + slug + " 已存在。请使用新的相册标识，避免覆盖已有照片和描述。");
  }

  const candidates = sourceStat.isDirectory()
    ? (await fs.readdir(source, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && supported.has(path.extname(entry.name).toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }))
        .map((entry) => path.join(source, entry.name))
    : supported.has(path.extname(source).toLowerCase()) ? [source] : [];
  if (candidates.length === 0) throw new Error("没有找到支持的照片。请使用 JPEG、PNG、WebP、AVIF 或 TIFF；HEIC 请先导出为 JPEG。");
  if (candidates.length > 500) throw new Error("一次最多导入 500 张，请按日期或地点分成多个相册。");

  await fs.mkdir(mediaRoot, { recursive: true });
  await fs.mkdir(albumRoot, { recursive: true });
  const staging = await fs.mkdtemp(path.join(mediaRoot, ".import-"));
  const copied = [];
  let createdOutput = false;
  let complete = false;
  try {
    const photos = [];
    let totalBytes = 0;
    for (let index = 0; index < candidates.length; index++) {
      const filename = String(index + 1).padStart(3, "0") + ".webp";
      const thumbnailName = String(index + 1).padStart(3, "0") + "-thumb.webp";
      // Sharp strips metadata by default. rotate() applies EXIF orientation before resize.
      const original = sharp(candidates[index], { limitInputPixels: 100_000_000 }).rotate();
      const large = await original.clone().resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(staging, filename));
      const thumbnail = await original.clone().resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).webp({ quality: 76 }).toFile(path.join(staging, thumbnailName));
      totalBytes += large.size + thumbnail.size;
      photos.push({
        src: "/media/" + slug + "/" + filename,
        thumbnail: "/media/" + slug + "/" + thumbnailName,
        alt: title + " · 第 " + (index + 1) + " 张照片",
        width: large.width,
        height: large.height,
      });
      console.log("已压缩 " + (index + 1) + "/" + candidates.length);
    }

    // mkdir and exclusive writes prevent accidental replacement, including concurrent imports.
    await fs.mkdir(outputDir);
    createdOutput = true;
    for (const name of await fs.readdir(staging)) {
      const destination = path.join(outputDir, name);
      await fs.copyFile(path.join(staging, name), destination, constants.COPYFILE_EXCL);
      copied.push(destination);
    }
    await fs.writeFile(jsonPath, JSON.stringify({ title, date, description, photos }, null, 2) + "\n", { flag: "wx" });
    complete = true;
    console.log("\n完成：" + photos.length + " 张照片，网页图片与缩略图共 " + (totalBytes / 1024 / 1024).toFixed(2) + " MB。");
    console.log("相册信息：src/data/albums/" + slug + ".json");
    console.log("照片目录：public/media/" + slug + "/");
    console.log("请补充相册信息中的图片描述，预览确认后再提交发布。原片保持不变。");
  } finally {
    if (!complete && createdOutput) {
      for (const destination of copied) await fs.unlink(destination).catch(() => {});
      await fs.rmdir(outputDir).catch(() => {});
    }
    // Only remove this run's staging directory, after checking its absolute location.
    if (inside(mediaRoot, staging) && path.basename(staging).startsWith(".import-")) {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error("导入失败：" + error.message);
  process.exitCode = 1;
});
