# 同频 Android

这是本项目的正式 Android WebView 容器源码，使用 AndroidX WebViewAssetLoader 在应用内运行 Web 私人收藏功能。

首次打开默认为离线私人模式；手机可以通过右上角菜单「连接 HTTPS 同频服务」接入自托管后端，完整社交互动依赖用户信任且部署好的 HTTPS 服务。切换来源前务必导出收藏备份。

GitHub Actions 通过 Gradle 编译 `assembleDebug`，产出 **调试 APK** 作为工件。未配置正式发布签名，不是 Google Play 正式上架包。

构建：在 apps/android 中执行 `gradle assembleDebug`。依赖 JDK17、Android SDK35、Gradle 8.9。Web Assets 编译时从 `../../tongpin` 自动复制。
