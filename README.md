# BCF Web

面向用户的 BFC（Bilibili Favorites Curator）Web 入口。

本仓库承载工作台的 Web 展示层：专题视频库、分类导航和本地工作台入口。完整的本地数据管理与安全读取仍由 [bfc-workbench](https://github.com/code5m/bfc-workbench) 提供，后端接口由 `bfc-backend` 提供。

## 使用

本地预览：`npm start` → `http://127.0.0.1:4173/`。启动后根路径就是用户体验入口，不需要先打开 GitHub。

这是可直接托管的静态 Web 资源。部署时将本目录作为站点根目录，并通过同源反向代理提供工作台 API；没有后端时会展示安全的示例内容。不要把个人收藏清单、Cookie、Token 或数据库快照放入仓库。

## 关联项目

- Web：`https://github.com/code5m/bcf-website`
- 工作台：`https://github.com/code5m/bfc-workbench`
- 后端：`https://github.com/code5m/bfc-backend`


## 同频 · 因收藏而相识（新功能）

新产品入口：启动本仓库服务后访问 http://127.0.0.1:4173/tongpin/ 。

- 私人收藏保存在浏览器 IndexedDB，支持手动添加、BFC JSON 导入、去重、标签、搜索与个人备份。
- 公开橱窗需本人手动精选并确认发布，且默认关闭可发现性；私人笔记和完整收藏不会上传社交 API。
- 已实现受控用户注册、邀请码、双向同意交友、消息、拉黑、举报和独立的管理员审核队列。
- 社交服务使用 Node.js 24 内置 SQLite，生产部署配置在 compose.yaml、Dockerfile、deploy/Caddyfile。
- Android 原生容器源码：apps/android，CI 输出调试 APK；iOS SwiftUI 源码：apps/ios，CI 输出模拟器应用 ZIP。
- 业务与商业方案：docs/TONGPIN-BUSINESS-PLAN.md；运维和上线限制：docs/TONGPIN-OPERATIONS.md。
- GitHub Actions 的「Build Tongpin Android and iOS」成功记录包含可获取的安装工件。

注意：这不是 B站官方产品。这里**不会**自动下载、绕过保护读取、移动或删除 B站收藏。安卓调试包可用于设备验证；没有 Apple 签名、正式商店上架或真实线上服务器。本地演示不等于社交平台已经可以向公众运营。
