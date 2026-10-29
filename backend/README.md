# 嘴哥的记录服务

博客页面继续由 GitHub Pages 托管。这个服务运行在用户自己的 Cloudflare 账号，提供登录、保存记录、原图存储、短视频播放和昵称邮箱留言。未配置时，网页后台会明确提示未连接，博客不会显示不可用的评论表单。

2026-10-15：现有服务已接入 `zuige-blog-media` R2 标准存储桶，绑定为 `BUCKET`。管理入口与两个现有 Secrets 沿用原配置；维护此项目不需要重新创建数据库或重新签发入口。

2026-10-17：部分网络不能连接现有 `workers.dev` 图片入口。已启用 R2 托管公开地址作为过渡的图片读取入口，网页通过 `src/data/services.json` 的 `mediaBase` 映射旧媒体链接；`apiBase`、原图文件、文章中保存的地址和私密管理入口保持不变。`r2.dev` 是官方限流的开发入口，不应视作长期生产域名；后续绑定自有媒体域名后，只需更换 `mediaBase`。公开地址不提供存储桶目录列表，原图本身仍是公开媒体。官方说明：https://developers.cloudflare.com/r2/buckets/public-buckets/ 。

## 首次接入

1. 在 https://dash.cloudflare.com/sign-up 注册，验证邮箱，登录。博客已有 GitHub 地址，可以跳过添加域名。
2. 需要照片存储时，在 **Storage & databases → R2 → Overview** 开通 R2。Cloudflare 会要求完成订阅结算流程；账户绑定和支付资料由本人填写。R2 有每月免费用量，超过额度可能收费，详情见 https://developers.cloudflare.com/r2/pricing/ 。不需要升级 Workers 为付费计划。
3. 在本目录运行 `npm ci`，再运行 `npx wrangler login`，在自己的浏览器中授权。
4. 使用 `npx wrangler d1 create zuige-blog-data` 创建数据库，把返回的数据库 ID 加入 `wrangler.jsonc` 的 `d1_databases`，绑定名为 `DB`，数据库名为 `zuige-blog-data`，迁移目录为 `migrations`。
5. 使用 `npx wrangler r2 bucket create zuige-blog-media` 创建存储桶，在 `r2_buckets` 增加绑定名 `BUCKET`、存储桶名 `zuige-blog-media`。存储桶无需开启 r2.dev 公开访问，公开媒体由本服务提供。
6. 使用 `npx wrangler d1 migrations apply zuige-blog-data --remote` 应用数据库结构。这是新建数据库的初始化，不会填入示例评论或旅行记录。
7. 配置下面的三个 secrets，再运行 `npm run deploy`。将返回的 HTTPS 服务地址写入博客的 `src/data/services.json` 的 `apiBase`，提交到 GitHub，等待 Pages 发布。已有项目不要重建数据库、存储桶或覆盖既有的 `GITHUB_TOKEN`、`SESSION_SECRET`。

配置示例（数据库 ID 要替换成实际值）：

```json
"d1_databases": [{ "binding": "DB", "database_name": "zuige-blog-data", "database_id": "实际数据库ID", "migrations_dir": "migrations" }],
"r2_buckets": [{ "binding": "BUCKET", "bucket_name": "zuige-blog-media" }]
```

## 凭据

- `GITHUB_TOKEN`：GitHub fine-grained personal access token。只选择 `mouthbig324-ai.github.io` 这个仓库，给予 **Contents: Read and write**；不需要其他仓库、管理权限或 workflow 写权限。发布功能只写文章、相册和友链文件。令牌过期后需更新。
- `SESSION_SECRET`：至少 32 字节的独立随机值，用于签发登录会话和保护限流、浏览去重标识。沿用现有值，不因切换密码登录而更换。
- `ADMIN_PASSWORD_HASH`：密码的 PBKDF2-SHA256 加盐校验值，格式为 `pbkdf2-sha256:100000:base64url盐:base64url校验值`。使用密码的 UTF-8 字节、随机至少 16 字节盐和 32 字节派生值，不裁剪密码空格。只通过 Cloudflare Secret 保存，不保存明文密码，不放进前端、仓库或日志。

用 `npx wrangler secret put 凭据名` 的本地交互输入或标准输入配置，不把原值写入代码、文档、公开仓库或聊天。GitHub 的电脑登录凭据不能直接当作第三方服务的仓库令牌。

2026-10-29 起使用密码登录：`POST /admin/login` 经 HTTPS 接收密码，只在 Worker 内校验。单一来源每十分钟最多尝试 8 次，限流标识经过 HMAC，不存原始 IP。成功返回有效期 7 天的签名会话，响应不缓存。浏览器保存会话，不保存密码；无法写本地存储时仅在当前页面保留会话。

会话包含 `role`、`expires`、随机 `nonce` 和与当前密码校验值绑定的 `credential`，由现有 `SESSION_SECRET` 做 HMAC-SHA256 签名。旧免密码链接不再通过校验，网页也不再接受链接片段授权。更新 `ADMIN_PASSWORD_HASH` 会使旧会话失效，无须更换签名密钥。退出清除当前浏览器的会话，不删除本机暂存。

服务使用 SHA 检查阻止旧编辑器覆盖较新的文章。发布会触发现有 GitHub Actions，文章显示需要等待构建；“提交发布成功”并不等于 Pages 构建已完成。

## 使用与限制

直接打开 `/admin/` 输入管理密码，可以新建旅行日记、生活碎片或相册，上传照片、预览、保存草稿、发布，管理友链和回复、隐藏留言。新设备及会话到期后需要重新输入密码。

照片按原文件上传，不压缩、不生成缩略图、不移除原文件元数据；原件也保留在设备。支持 JPEG、PNG、WebP、AVIF，单张最多 64 MiB；HEIC/HEIF 请先在设备上导出为 JPEG。视频支持 MP4/WebM，每个最多 64 MiB，不自动转码。公开访问的媒体直链可以复用在多个记录中。

存储限制为 10,000,000,000 字节（10 GB）；这限制本后台的累计上传量，不是 Cloudflare 账单的绝对上限，读写次数、其他服务以及账户已有数据仍需在账单中查看。未发布或从记录中移除的附件仍占存储空间，避免误删其他文章使用的文件；可由账号所有者在 R2 清理，并校准数据库用量。上传失败时会尝试清理对象，确认清理后释放预算；清理失败会保留占用，防止漏计。

**草稿不在网站列表、搜索和订阅显示，但用户的 GitHub 仓库是公开的，草稿源文件仍可被查看。** 已上传的媒体链接也是公开访问；私人日记和原片请保留在本地。

留言邮箱只在已授权的管理后台显示；公开接口仅返回昵称、时间、正文及站主标记。访客内容以纯文本显示，不执行 HTML。留言有频率限制，机器人诱捕字段不入库。每日定时清理过期限流记录。

`/health` 用于检查服务配置。成功接入后应显示 comments、storage、publishing、login 均为 true，再实际检查上传、发布和留言。

## 本地验证

2026-10-19：文章和相册支持可选的 `series`（名称，最多 80 字符）、`tripDate`（旅行日期，YYYY-MM-DD）、`location`（地点，最多 80 字符）及 `seriesOrder`（1–9999 的整数或 null）。字段随文章或相册存入 GitHub，不新增 D1 表或 R2 文件。旧版编辑器省略这些字段时保留已有值，显式空值可退出系列。仍通过 SHA 检查阻止旧版本覆盖新内容。先部署支持这些字段的 Worker，再发布新版后台。

编辑器自动暂存只使用浏览器本地存储，不调用发布接口；成功提交后清理对应暂存，冲突时保留本机内容。浏览器流程验证须拦截全部服务请求或连接本地模拟服务，不使用真实文章做写入测试。

2026-10-18：新增 `0003_article_views.sql`，仅创建 `article_views` 累计表和 `view_visits` 去重表。更新已有服务时先执行 `wrangler d1 migrations apply zuige-blog-data --remote`，再部署 Worker，最后发布网页。`GET /views?path=/posts/文章标识/` 只读数量；`POST /views` 接受 path 和浏览器随机 visitor UUID，按北京时间当天、文章和浏览器去重。浏览器标识仅保存在本地；服务端用现有 SESSION_SECRET 做 HMAC，不保存原始 visitor 或 IP。D1 事务同时更新总数和去重记录，每日清理两天前的去重记录，累计总数保留。此统计不是严格的人数统计，也不能还原上线前的流量；不支持本地存储的浏览器只读数量。单个来源每十分钟最多调用统计写入 120 次。留言 POST 可选 parent_id，必须指向同一篇文章或相册的未隐藏留言；既有博主回复的 parent_id 可直接用于前台展示，无需改动旧评论数据。

```text
npm ci
npm test
npx wrangler deploy --dry-run
```

测试用本地 Workers、D1 和 R2，模拟 GitHub 写入，不会创建 Cloudflare 资源或发布测试数据。浏览器端可以用 `PUBLIC_BLOG_API` 环境变量连接本地服务；生产配置只使用真实 HTTPS 服务。

数据库可用 `wrangler d1 export zuige-blog-data --remote --output 指定备份路径` 导出；照片原件另行本地备份。长期使用应维护媒体备份、令牌续期以及 Cloudflare 用量提醒。
