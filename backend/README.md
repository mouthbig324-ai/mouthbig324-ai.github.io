# 嘴哥的记录服务

博客页面继续由 GitHub Pages 托管。这个服务运行在用户自己的 Cloudflare 账号，提供登录、保存记录、压缩照片的存储、短视频播放和昵称邮箱留言。未配置时，网页后台会明确提示未连接，博客不会显示不可用的评论表单。

## 首次接入

1. 在 https://dash.cloudflare.com/sign-up 注册，验证邮箱，登录。博客已有 GitHub 地址，可以跳过添加域名。
2. 需要照片存储时，在 **Storage & databases → R2 → Overview** 开通 R2。Cloudflare 会要求完成订阅结算流程；账户绑定和支付资料由本人填写。R2 有每月免费用量，超过额度可能收费，详情见 https://developers.cloudflare.com/r2/pricing/ 。不需要升级 Workers 为付费计划。
3. 在本目录运行 `npm ci`，再运行 `npx wrangler login`，在自己的浏览器中授权。
4. 使用 `npx wrangler d1 create zuige-blog-data` 创建数据库，把返回的数据库 ID 加入 `wrangler.jsonc` 的 `d1_databases`，绑定名为 `DB`，数据库名为 `zuige-blog-data`，迁移目录为 `migrations`。
5. 使用 `npx wrangler r2 bucket create zuige-blog-media` 创建存储桶，在 `r2_buckets` 增加绑定名 `BUCKET`、存储桶名 `zuige-blog-media`。存储桶无需开启 r2.dev 公开访问，公开媒体由本服务提供。
6. 使用 `npx wrangler d1 migrations apply zuige-blog-data --remote` 应用数据库结构。这是新建数据库的初始化，不会填入示例评论或旅行记录。
7. 配置下面的三个 secrets，再运行 `npm run deploy`。将返回的 HTTPS 服务地址写入博客的 `src/data/services.json` 的 `apiBase`，提交到 GitHub，等待 Pages 发布。

配置示例（数据库 ID 要替换成实际值）：

```json
"d1_databases": [{ "binding": "DB", "database_name": "zuige-blog-data", "database_id": "实际数据库ID", "migrations_dir": "migrations" }],
"r2_buckets": [{ "binding": "BUCKET", "bucket_name": "zuige-blog-media" }]
```

## 凭据

- `GITHUB_TOKEN`：GitHub fine-grained personal access token。只选择 `mouthbig324-ai.github.io` 这个仓库，给予 **Contents: Read and write**；不需要其他仓库、管理权限或 workflow 写权限。发布功能只写文章、相册和友链文件。令牌过期后需更新。
- `ADMIN_PASSWORD_HASH`：至少 20 个随机字符的管理密码的 SHA-256 十六进制摘要。可以由本地密码管理器生成并保存。此服务使用随机高强度密码，不适合简单的自选短密码。
- `SESSION_SECRET`：至少 32 字节的独立随机值，用于签发 12 小时管理会话和保护留言限流标识。

用 `npx wrangler secret put 凭据名` 的本地交互输入配置，不把原值写入代码、文档、公开仓库或聊天。管理密码的原值由用户保存，GitHub 的电脑登录凭据不能直接当作第三方服务的仓库令牌。

服务使用 SHA 检查阻止旧编辑器覆盖较新的文章。发布会触发现有 GitHub Actions，文章显示需要等待构建；“提交发布成功”并不等于 Pages 构建已完成。

## 使用与限制

打开博客 `/admin/` 登录，可以新建旅行日记、生活碎片或相册，上传照片、预览、保存草稿、发布，管理友链和回复、隐藏留言。

照片在浏览器中生成 1920 像素 WebP 和 640 像素缩略图，移除元数据；原件留在设备。视频支持 MP4/WebM，每个最多 64 MiB，不自动转码。公开访问的媒体直链可以复用在多个记录中。

存储默认限制为 8,000,000,000 字节，预留免费用量空间；这不是 Cloudflare 账单的绝对上限，读写次数、其他服务以及账户已有数据仍需在账单中查看。未发布、失败或从记录中移除的附件仍占存储空间，避免误删其他文章使用的文件；可由账号所有者在 R2 清理，并校准数据库用量。

**草稿不在网站列表、搜索和订阅显示，但用户的 GitHub 仓库是公开的，草稿源文件仍可被查看。** 已上传的媒体链接也是公开访问；私人日记和原片请保留在本地。

留言邮箱只在登录后的管理后台显示；公开接口仅返回昵称、时间、正文及站主标记。访客内容以纯文本显示，不执行 HTML。登录和留言有频率限制，机器人诱捕字段不入库。每日定时清理过期限流记录。

`/health` 用于检查服务配置。成功接入后应显示 comments、storage、publishing、login 均为 true，再实际检查上传、发布和留言。

## 本地验证

```text
npm ci
npm test
npx wrangler deploy --dry-run
```

测试用本地 Workers、D1 和 R2，模拟 GitHub 写入，不会创建 Cloudflare 资源或发布测试数据。浏览器端可以用 `PUBLIC_BLOG_API` 环境变量连接本地服务；生产配置只使用真实 HTTPS 服务。

数据库可用 `wrangler d1 export zuige-blog-data --remote --output 指定备份路径` 导出；照片原件另行本地备份。长期使用应维护媒体备份、令牌续期以及 Cloudflare 用量提醒。
