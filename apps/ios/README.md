# 同频 iOS 原生 APP

SwiftUI 原生个人收藏库（添加、导入 BFC JSON、搜索、删除、导出）+ 受信任 HTTPS 同频社交页。私人收藏以 iOS 文件保护模式存储在 App Support 中，无需服务即可使用。社交必须先在「发现同频」页填写可信的 HTTPS 服务域名。

项目配置通过 XcodeGen 的 `project.yml` 生成。GitHub Actions 在 macOS Runner 中构建 **iOS Simulator .app**，并作为 ZIP 工件上传；未配置 Apple Developer 签名，不能声称是已经上架或可直接装到真机的 IPA。

本地构建：`cd apps/ios && xcodegen generate && xcodebuild -project Tongpin.xcodeproj -scheme Tongpin -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build`。
