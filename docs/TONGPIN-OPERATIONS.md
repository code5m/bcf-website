# 同频：自托管部署和运营交付

**状态：可在自有服务器执行的部署包，未实际对公网开放。**

## 首次安装
1. 拥有可管理的 Linux 服务器、DNS 和域名，在 DNS 将域名指向服务器，允许 TCP 80/443。安装 Docker Engine 和 Docker Compose。
2. 复制配置文件：cp .env.example .env。
3. 设置 TONGPIN_DOMAIN；运行 openssl rand -hex 32 生成强随机 TONGPIN_ADMIN_TOKEN。不要把 .env 提交 GitHub。
4. 在服务器执行 docker compose up -d --build。Caddy 通过域名自动申请 TLS。
5. 访问 https://域名/tongpin/；后台审核 https://域名/tongpin/admin.html。
6. 通过 GET /api/social/health 核验服务可用、浏览器测试注册/登录及举报；未完成法务和运维审核前不可公开招募用户。

## 数据归属与备份
- 私人收藏库默认在浏览器 IndexedDB，不自动上传服务。
- 社交数据写入服务器的 social.sqlite（Node.js 24 内置 SQLite，WAL）；运行目录使用具名 Docker 卷 tongpin_runtime。
- SQLite 热备份需使用 SQLite 官方 backup API；否则先停服务再复制数据库和 WAL/SHM，不可运行中直接仅复制主数据库。
- 正式使用需制定备份留存和请求删除的清理策略。删除账户仅移除当前数据状态，离线备份还需独立清理。
- 社交消息未端到端加密，服务运营者技术上能够读取；必须真实告知用户。

## 运营治理
- 私人资料默认不可被发现，只有主动公开的收藏进入匹配。
- 举报进入人工队列，管理员密钥控制审核；可以标记处理、驳回或临时封禁7天。
- 生产仍需增加实名/邮箱验证（按实际法律与风险）、验证码或防机器人、申诉、每日审计、滥用阈值、安全测试、数据保护评估、内容合规和事故响应。

## 没有实际凭据不能自动完成的外部动作
- 真实服务器、域名和 DNS；Android 正式签名及 Play Console 发布；Apple Developer/签名/TestFlight/App Store 发布；商业主体、支付商户及法域审批。
- GitHub Actions 产出的 Android debug APK 与 iOS simulator 包仅证明开发/测试版本构建成功，不代表正式应用商店包，也不能用于公网上线安全背书。

## 内测邀请
生产 Docker 配置默认 TONGPIN_INVITE_ONLY=1。首次部署由管理员在 /tongpin/admin.html 生成一次性邀请码（7天有效），由邀请的成年人注册；禁止无邀请码公开注册。发送邀请码前需要核实受邀用户身份与同意政策。管理员报告列表可标记、驳回或暂停被举报账号，仍需要真实的人负责管理。
