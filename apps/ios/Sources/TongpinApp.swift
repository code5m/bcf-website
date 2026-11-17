import SwiftUI
import WebKit
import UniformTypeIdentifiers

struct SavedVideo: Codable, Identifiable, Hashable {
    let bvid: String
    var title: String
    var tags: [String]
    var notes: String
    var id: String { bvid }
}

@MainActor final class PrivateLibrary: ObservableObject {
    @Published private(set) var videos: [SavedVideo] = []
    private var dataURL: URL {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return folder.appendingPathComponent("tongpin-private-videos.json")
    }
    init() {
        guard let data = try? Data(contentsOf: dataURL),
              let decoded = try? JSONDecoder().decode([SavedVideo].self, from: data) else { return }
        videos = decoded
    }
    func save(_ video: SavedVideo) throws {
        let item = SavedVideo(bvid: video.bvid, title: String(video.title.prefix(150)),
                              tags: Array(video.tags.prefix(12)), notes: String(video.notes.prefix(4000)))
        videos.removeAll { $0.bvid == item.bvid }
        videos.insert(item, at: 0)
        try persist()
    }
    func remove(_ video: SavedVideo) throws {
        videos.removeAll { $0.id == video.id }
        try persist()
    }
    func importJSON(_ data: Data) throws -> Int {
        let raw = try JSONSerialization.jsonObject(with: data)
        let rows: [[String: Any]]
        var categories: [String: String] = [:]
        if let direct = raw as? [[String: Any]] {
            rows = direct
        } else {
            var container: Any = raw
            if let dictionary = container as? [String: Any] {
                container = dictionary["state"] ?? dictionary
            }
            guard let obj = container as? [String: Any] else {
                throw NSError(domain:"Tongpin",code:1,userInfo:[NSLocalizedDescriptionKey:"不支持的 JSON 结构"])
            }
            let rawVideos = obj["videos"] ?? obj["records"] ?? obj["items"]
            if let array = rawVideos as? [[String: Any]] {
                rows = array
            } else if let dictionary = rawVideos as? [String: Any] {
                rows = dictionary.values.compactMap { $0 as? [String: Any] }
            } else {
                throw NSError(domain:"Tongpin",code:2,userInfo:[NSLocalizedDescriptionKey:"找不到视频记录"])
            }
            categories = (obj["library"] as? [String: Any])?["categories"] as? [String: String] ?? [:]
        }
        guard rows.count <= 30000 else {
            throw NSError(domain:"Tongpin",code:3,userInfo:[NSLocalizedDescriptionKey:"一次最多导入30000条"])
        }
        var byID = Dictionary(uniqueKeysWithValues: videos.map { ($0.bvid, $0) })
        var imported = 0
        for row in rows {
            let source = row["bvid"] as? String ?? row["url"] as? String ?? ""
            guard let id = Self.parseBV(source) else { continue }
            let title = row["title"] as? String ?? "视频 " + id
            let old = byID[id]
            let sourceTags = row["tags"] as? [String] ?? []
            let topic = categories[id] ?? (row["category"] as? String ?? "")
            let tags = Array(Set((old?.tags ?? []) + sourceTags + (topic.isEmpty ? [] : [topic]))).sorted().prefix(12)
            let notes = old?.notes ?? (row["notes"] as? String ?? "")
            byID[id] = SavedVideo(bvid:id,title:String(title.prefix(150)),tags:Array(tags),
                                  notes:String(notes.prefix(4000)))
            imported += 1
        }
        videos = byID.values.sorted { $0.title.localizedCompare($1.title) == .orderedAscending }
        try persist()
        return imported
    }
    private func persist() throws {
        let dir = dataURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at:dir, withIntermediateDirectories:true)
        let data = try JSONEncoder().encode(videos)
        try data.write(to:dataURL, options:[.atomic,.completeFileProtectionUnlessOpen])
    }
    static func parseBV(_ input:String) -> String? {
        guard let range = input.range(of:"BV[0-9A-Za-z]{10}", options:.regularExpression) else { return nil }
        return String(input[range])
    }
}

struct ExportArchive: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var videos: [SavedVideo]
    init(videos:[SavedVideo]) { self.videos=videos }
    init(configuration:ReadConfiguration) throws {
        let data=configuration.file.regularFileContents ?? Data()
        videos=try JSONDecoder().decode([SavedVideo].self,from:data)
    }
    func fileWrapper(configuration:WriteConfiguration) throws -> FileWrapper {
        let full = try JSONEncoder().encode(videos)
        return FileWrapper(regularFileWithContents:full)
    }
}

struct AddVideoSheet: View {
    @Environment(\.dismiss) private var dismiss
    var onSave:(SavedVideo)->Void
    @State private var bvid=""
    @State private var title=""
    @State private var tags=""
    @State private var notes=""
    var body:some View {
        NavigationStack {
            Form {
                TextField("BV号或B站链接", text:$bvid).textInputAutocapitalization(.never)
                TextField("视频标题",text:$title)
                TextField("标签，以逗号分隔",text:$tags)
                TextField("私人笔记",text:$notes,axis:.vertical).lineLimit(3...7)
                Text("视频内容仍在 B站播放；这里只保存你自己的整理信息。").font(.footnote).foregroundStyle(.secondary)
            }
            .navigationTitle("添加私人收藏")
            .toolbar {
                ToolbarItem(placement:.cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement:.confirmationAction) {
                    Button("保存") {
                        guard let id=PrivateLibrary.parseBV(bvid), !title.trimmingCharacters(in:.whitespaces).isEmpty else { return }
                        let topics=Array(Set(tags.split(separator:",").map { String($0.trimmingCharacters(in:.whitespaces)) }.filter{!$0.isEmpty})).prefix(12)
                        onSave(SavedVideo(bvid:id,title:title,tags:Array(topics),notes:notes))
                        dismiss()
                    }.disabled(PrivateLibrary.parseBV(bvid) == nil || title.trimmingCharacters(in:.whitespaces).isEmpty)
                }
            }
        }
    }
}

struct SocialWebView: UIViewRepresentable {
    let url:URL
    func makeCoordinator()->Coordinator { Coordinator(allowedHost:url.host ?? "") }
    func makeUIView(context:Context)->WKWebView {
        let config=WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let view=WKWebView(frame:.zero,configuration:config)
        view.navigationDelegate=context.coordinator
        view.allowsBackForwardNavigationGestures=true
        view.load(URLRequest(url:url))
        return view
    }
    func updateUIView(_ webView:WKWebView,context:Context) {
        if webView.url?.host != url.host {
            context.coordinator.allowedHost = url.host ?? ""
            webView.load(URLRequest(url:url))
        }
    }
    final class Coordinator:NSObject,WKNavigationDelegate {
        var allowedHost:String
        init(allowedHost:String){self.allowedHost=allowedHost}
        func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,
                     decisionHandler:@escaping(WKNavigationActionPolicy)->Void) {
            guard let target=navigationAction.request.url else {decisionHandler(.cancel);return}
            if target.scheme=="https", target.host==allowedHost,
               target.port==webView.url?.port {decisionHandler(.allow);return}
            if target.scheme=="about" {decisionHandler(.allow);return}
            if target.scheme=="https" {UIApplication.shared.open(target)}
            decisionHandler(.cancel)
        }
    }
}

struct TongpinHome:View {
    @StateObject private var library=PrivateLibrary()
    @AppStorage("tongpin.server") private var serverOrigin=""
    @State private var serverInput=""
    @State private var showServerSettings=false
    @State private var search=""
    @State private var showAdd=false
    @State private var importFile=false
    @State private var exportFile=false
    @State private var alertText=""
    @State private var showAlert=false
    private var visibleVideos:[SavedVideo] {
        guard !search.isEmpty else {return library.videos}
        return library.videos.filter{
            ($0.title+" "+$0.bvid+" "+$0.tags.joined(separator:" ")).localizedCaseInsensitiveContains(search)
        }
    }
    private var validRemoteURL:URL? {
        guard let url=URL(string:serverOrigin+"/tongpin/"), url.scheme=="https",
              url.host != nil else {return nil}
        return url
    }
    var body:some View {
        TabView {
            NavigationStack {
                List {
                    Section {
                        Text("本地优先 · 你的收藏、标签与笔记只保存在设备。发布社交橱窗须你在联网服务中另行确认。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(visibleVideos) { v in
                        VStack(alignment:.leading,spacing:7) {
                            Text(v.title).font(.headline)
                            Text(v.bvid).font(.caption).foregroundStyle(.secondary)
                            if !v.tags.isEmpty {Text(v.tags.joined(separator:" · ")).font(.caption)}
                            if !v.notes.isEmpty {Text(v.notes).lineLimit(2).font(.footnote).foregroundStyle(.secondary)}
                            Link("前往 B站观看 ↗",destination:URL(string:"https://www.bilibili.com/video/"+v.bvid)!)
                                .font(.footnote)
                        }.padding(.vertical,5)
                    }.onDelete { offsets in
                        for index in offsets {try? library.remove(visibleVideos[index])}
                    }
                }
                .searchable(text:$search,prompt:"搜索本地收藏")
                .navigationTitle("我的收藏")
                .toolbar {
                    ToolbarItemGroup(placement:.topBarTrailing) {
                        Button {importFile=true} label: {Image(systemName:"square.and.arrow.down")}
                        Button {exportFile=true} label: {Image(systemName:"square.and.arrow.up")}
                        Button {showAdd=true} label: {Image(systemName:"plus")}
                    }
                }
                .sheet(isPresented:$showAdd) {
                    AddVideoSheet { video in
                        do {try library.save(video)}
                        catch {report(error.localizedDescription)}
                    }
                }
                .fileImporter(isPresented:$importFile,allowedContentTypes:[.json]) { result in
                    do {
                        let url=try result.get()
                        let access=url.startAccessingSecurityScopedResource()
                        defer {if access {url.stopAccessingSecurityScopedResource()}}
                        let count=try library.importJSON(Data(contentsOf:url))
                        report("导入了 \(count) 条可识别的本地视频记录。")
                    } catch {report("导入失败："+error.localizedDescription)}
                }
                .fileExporter(isPresented:$exportFile,document:ExportArchive(videos:library.videos),
                              contentType:.json,defaultFilename:"tongpin-private-videos") { result in
                    if case .failure(let error)=result {report("导出失败："+error.localizedDescription)}
                }
            }.tabItem {Label("我的收藏",systemImage:"square.stack.3d.up")}
            NavigationStack {
                Group {
                    if !showServerSettings,let url=validRemoteURL {
                        SocialWebView(url:url)
                    } else {
                        Form {
                            Section("连接可信的 HTTPS 同频服务器") {
                                TextField("https://example.com",text:$serverInput)
                                    .textInputAutocapitalization(.never).keyboardType(.URL)
                                Button("保存并连接") {
                                    let cleaned=serverInput.trimmingCharacters(in:.whitespacesAndNewlines).trimmingCharacters(in:CharacterSet(charactersIn:"/"))
                                    guard let parsed=URLComponents(string:cleaned),parsed.scheme=="https",
                                          parsed.host != nil,parsed.user==nil,parsed.password==nil,
                                          parsed.path.isEmpty,parsed.query==nil,parsed.fragment==nil
                                    else {report("仅允许完整的 HTTPS 服务域名");return}
                                    serverOrigin=cleaned
                                    showServerSettings=false
                                }.disabled(serverInput.isEmpty)
                            }
                            Section {
                                Text("没有服务器时，本机私人收藏仍然可用。交友、聊天和公开橱窗需要你自己部署或连接已获信任的服务。不要将私人收藏导入未知网站。")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .navigationTitle("同频交友")
                .toolbar {
                    ToolbarItem(placement:.topBarTrailing) {
                        Button(showServerSettings ? "取消" : "服务器") {
                            serverInput=serverOrigin
                            showServerSettings.toggle()
                        }
                    }
                }
            }.tabItem {Label("发现同频",systemImage:"person.2")}
        }
        .alert("同频",isPresented:$showAlert) {
            Button("确定",role:.cancel){}
        } message: {
            Text(alertText)
        }
    }
    private func report(_ message:String) {
        alertText=message
        showAlert=true
    }
}

@main struct TongpinApp:App {
    var body:some Scene { WindowGroup {TongpinHome()} }
}
