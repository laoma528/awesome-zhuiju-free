# 公开仓库文件范围

GitHub 仓库只保存可公开的项目说明、资源数据、用户教程和维护脚本。本地工作目录可以保留更完整的资料。

以下资料仅留本地，由 `.gitignore` 排除，并由 `scripts/check-public-files.mjs` 检查：

- `app网盘文件分享/` 及 APK、AAB、IPA 安装包。
- 账号配置、环境变量、私钥、证书、浏览器登录状态和 Cookie。
- 浏览器快照、运行日志、测试输出、本地数据库和备份。
- `outreach/` 推广文案、运营计划、投稿与发布跟进记录。
- `skills/geo-article-writer/` 内部写作技能和平台策略。
- `docs/DESIGN-*.md` 设计草稿。
- `reports/navigation-sync.json` 导航后台基线和操作留痕。

`resources/` 中面向用户的公开资源链接、`blog/articles/` 中的公开教程，以及资源验证和可用性报告仍可公开。网盘分享链接的提取码属于下载信息，不是账号密码；账号密码不得使用公开项目名称、群名或其他公开信息。

## 本机推送检查

新克隆仓库后，在根目录启用推送前检查：

```sh
git config core.hooksPath .githooks
```

检查暂存区：

```sh
node scripts/check-public-files.mjs
```

检查某个提交：

```sh
node scripts/check-public-files.mjs --ref HEAD
```

推送钩子检查待推送的版本和新提交，包括“先加入私密文件、后删除”的中间提交。GitHub Actions 同时检查每次推送和拉取请求的当前版本。检查只报告文件名和问题类型，不打印凭据值。

`.gitignore` 不会让已跟踪文件自动退出仓库；需要保留本地文件时，应使用 `git rm --cached`，文件夹另加 `-r`。不要省略 `--cached`。

忽略规则、本机钩子和 Actions 都能被有权限的人绕过，不等于 GitHub 服务端的强制推送规则。凭据检测覆盖常见格式，人工审查仍有必要。

## 已公开资料的历史版本

普通删除提交只移除新版本中的文件；旧提交、其他分支、标签以及已下载的副本仍可能保留内容。清除历史需要单独评估并改写相关历史。已经泄露的密码或令牌应当更换，不能只删除文件。
