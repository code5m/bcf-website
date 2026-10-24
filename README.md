# BCF Web

面向用户的 BFC（Bilibili Favorites Curator）Web 入口。

本仓库承载工作台的 Web 展示层：专题视频库、分类导航和本地工作台入口。完整的本地数据管理与安全读取仍由 [bfc-workbench](https://github.com/code5m/bfc-workbench) 提供，后端接口由 `bfc-backend` 提供。

## 使用

这是可直接托管的静态 Web 资源。部署时将本目录作为站点根目录，并通过同源反向代理提供工作台 API；不要把个人收藏清单、Cookie、Token 或数据库快照放入仓库。

## 关联项目

- Web：`https://github.com/code5m/bcf-website`
- 工作台：`https://github.com/code5m/bfc-workbench`
- 后端：`https://github.com/code5m/bfc-backend`
