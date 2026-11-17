import SwiftUI
import WebKit
import UniformTypeIdentifiers

struct SavedVideo: Codable, Identifiable, Hashable {
    let bvid: String
    var title: String
    var tags: [String]
    var notes: String
    var author: String
    var topics: [String]
    var sourceFolders: [String]
    var watched: Bool
    var progress: Double?
    var metadataMissing: Bool
    var id: String { bvid }

    init(bvid: String, title: String, tags: [String], notes: String,
         author: String = "", topics: [String] = [], sourceFolders: [String] = [],
         watched: Bool = false, progress: Double? = nil, metadataMissing: Bool = false) {
        self.bvid=bvid;self.title=title;self.tags=tags;self.notes=notes
        self.author=author;self.topics=topics;self.sourceFolders=sourceFolders
        self.watched=watched;self.progress=progress;self.metadataMissing=metadataMissing
    }
    init(from decoder:Decoder) throws {
        let c=try decoder.container(keyedBy:CodingKeys.self)
        bvid=try c.decode(String.self,forKey:.bvid)
        title=try c.decodeIfPresent(String.self,forKey:.title) ?? "待补齐标题 · "+bvid
        tags=try c.decodeIfPresent([String].self,forKey:.tags) ?? []
        notes=try c.decodeIfPresent(String.self,forKey:.notes) ?? ""
        author=try c.decodeIfPresent(String.self,forKey:.author) ?? ""
        topics=try c.decodeIfPresent([String].self,forKey:.topics) ?? []
        sourceFolders=try c.decodeIfPresent([String].self,forKey:.sourceFolders) ?? []
        watched=try c.decodeIfPresent(Bool.self,forKey:.watched) ?? false
        progress=try c.decodeIfPresent(Double.self,forKey:.progress)
        metadataMissing=try c.decodeIfPresent(Bool.self,forKey:.metadataMissing) ?? false
    }
}
struct PortableTopic: Codable {
    var name: String
    var description: String
    var notes: String
    var chapters: [String]
    var items: [String]
    var sections: [String:String]
    init(name:String,description:String="",notes:String="",chapters:[String]=[],
         items:[String]=[],sections:[String:String]=[:]) {
        self.name=name;self.description=description;self.notes=notes
        self.chapters=chapters;self.items=items;self.sections=sections
    }
    init(from decoder:Decoder) throws {
        let c=try decoder.container(keyedBy:CodingKeys.self)
        name=try c.decode(String.self,forKey:.name)
        description=try c.decodeIfPresent(String.self,forKey:.description) ?? ""
        notes=try c.decodeIfPresent(String.self,forKey:.notes) ?? ""
        chapters=try c.decodeIfPresent([String].self,forKey:.chapters) ?? []
        items=try c.decodeIfPresent([String].self,forKey:.items) ?? []
        sections=try c.decodeIfPresent([String:String].self,forKey:.sections) ?? [:]
    }
}
struct CuratedVideo: Codable {
    var bvid:String
    var title:String
    var tags:[String]
    var caption:String
    var url:String
}
struct PortableArchive: Codable {
    var type: String = "tongpin_private_library"
    var version: Int = 3
    var videos: [SavedVideo]
    var topics: [PortableTopic] = []
    var showcaseDraft: [CuratedVideo] = []
}

@MainActor final class PrivateLibrary: ObservableObject {
    @Published private(set) var videos: [SavedVideo] = []
    @Published private(set) var topics: [PortableTopic] = []
    private(set) var drafts: [CuratedVideo] = []
    private var dataURL:URL {
        let folder=FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0]
        return folder.appendingPathComponent("tongpin-private-videos.json")
    }
    init(){
        guard let data=try? Data(contentsOf:dataURL) else{return}
        if let archive=try? JSONDecoder().decode(PortableArchive.self,from:data){
            videos=archive.videos;topics=archive.topics;drafts=archive.showcaseDraft
        }else if let legacy=try? JSONDecoder().decode([SavedVideo].self,from:data){
            videos=legacy
        }
    }
    private func persist(_ archive:PortableArchive) throws {
        let folder=dataURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        let data=try JSONEncoder().encode(archive)
        try data.write(to:dataURL,options:[.atomic,.completeFileProtectionUnlessOpen])
    }
    func save(_ item:SavedVideo) throws {
        let cleaned=SavedVideo(bvid:item.bvid,title:String(item.title.prefix(150)),
            tags:Array(item.tags.prefix(12)),notes:String(item.notes.prefix(4000)),
            author:item.author,topics:item.topics,sourceFolders:item.sourceFolders,
            watched:item.watched,progress:item.progress,metadataMissing:item.metadataMissing)
        var next=videos.filter{$0.bvid != item.bvid}
        next.insert(cleaned,at:0)
        try persist(PortableArchive(videos:next,topics:topics,showcaseDraft:drafts))
        videos=next
    }
    func remove(_ item:SavedVideo) throws {
        let next=videos.filter{$0.id != item.id}
        try persist(PortableArchive(videos:next,topics:topics,showcaseDraft:drafts))
        videos=next
    }
    func importJSON(_ data:Data) throws -> Int {
        let raw=try JSONSerialization.jsonObject(with:data)
        if let archive=try? JSONDecoder().decode(PortableArchive.self,from:data) {
            try merge(archive)
            return archive.videos.count
        }
        if let simple=try? JSONDecoder().decode([SavedVideo].self,from:data) {
            try merge(PortableArchive(videos:simple))
            return simple.count
        }
        guard var root=raw as? [String:Any] else {
            throw NSError(domain:"Tongpin",code:1,userInfo:[NSLocalizedDescriptionKey:"备份 JSON 结构无法识别"])
        }
        if let state=root["state"] as? [String:Any]{root=state}
        let lib=root["library"] as? [String:Any] ?? [:]
        let categories=lib["categories"] as? [String:String] ?? [:]
        let notes=lib["notes"] as? [String:String] ?? [:]
        let watched=lib["watched"] as? [String:Bool] ?? [:]
        let entries=root["videos"] ?? root["records"] ?? root["items"]
        let rows:[[String:Any]]
        if let list=entries as? [[String:Any]]{rows=list}
        else if let map=entries as? [String:Any]{
            rows=map.map{key,value in
                var obj=value as? [String:Any] ?? [:]
                if obj["bvid"] == nil{obj["bvid"]=key}
                return obj
            }
        }else{rows=[]}
        let sourceTopics=(lib["topics"] ?? root["topics"]) as? [[String:Any]] ?? []
        if rows.count>30000 || sourceTopics.count>30000{
            throw NSError(domain:"Tongpin",code:2,userInfo:[NSLocalizedDescriptionKey:"导入记录数量超过限制"])
        }
        var newTopics:[PortableTopic]=[]
        var group:[String:[String]]=[:]
        for rawTopic in sourceTopics{
            guard let name=rawTopic["name"] as? String,!name.isEmpty else{continue}
            let items=(rawTopic["items"] as? [String] ?? []).compactMap{Self.parseBV($0)}
            let chapters=rawTopic["chapters"] as? [String] ?? []
            let item=PortableTopic(name:name,description:rawTopic["description"] as? String ?? "",
                notes:rawTopic["notes"] as? String ?? "",chapters:chapters,items:items,
                sections:rawTopic["sections"] as? [String:String] ?? [:])
            newTopics.append(item)
            for id in items{group[id,default:[]].append(name)}
        }
        var byID=Dictionary(uniqueKeysWithValues:videos.map{($0.bvid,$0)})
        let additional=Set(group.keys).union(categories.keys).union(notes.keys).union(watched.keys)
        let combined=rows+additional.map{["bvid":$0]}
        for row in combined{
            let rawVideo=row["raw"] as? [String:Any] ?? [:]
            let source=row["bvid"] as? String ?? rawVideo["bvid"] as? String ??
                row["url"] as? String ?? ""
            guard let id=Self.parseBV(source) else{continue}
            let old=byID[id]
            let incomingTitle=row["title"] as? String ?? rawVideo["title"] as? String ?? ""
            let title=(!incomingTitle.isEmpty && !incomingTitle.hasPrefix("待补齐标题"))?
                String(incomingTitle.prefix(150)):(old?.title ?? "待补齐标题 · "+id)
            let rawTags=row["tags"] as? [String] ?? []
            let topic=categories[id] ?? row["category"] as? String ?? ""
            let tags=Array(Set((old?.tags ?? [])+rawTags+(topic.isEmpty ? []:[topic])+(group[id] ?? [])))
                .sorted().prefix(12)
            let note=old?.notes.isEmpty == false ? old!.notes :
                notes[id] ?? row["notes"] as? String ?? ""
            let folders=row["sourceFolders"] as? [String] ??
                row["originalFolders"] as? [String] ?? rawVideo["originalFolders"] as? [String] ?? []
            let allFolders=Array(Set((old?.sourceFolders ?? [])+folders)).sorted()
            let allTopics=Array(Set((old?.topics ?? [])+(group[id] ?? []))).sorted()
            byID[id]=SavedVideo(bvid:id,title:title,tags:Array(tags),notes:String(note.prefix(4000)),
                author:old?.author ?? row["author"] as? String ?? "",
                topics:allTopics,sourceFolders:allFolders,
                watched:(old?.watched ?? false)||(watched[id] ?? false)||(row["watched"] as? Bool ?? false),
                progress:old?.progress ?? (row["progress"] as? Double),
                metadataMissing:title.hasPrefix("待补齐标题"))
        }
        if byID.count>30000{
            throw NSError(domain:"Tongpin",code:3,userInfo:[NSLocalizedDescriptionKey:"私人收藏超过30000条"])
        }
        let archive=PortableArchive(videos:Array(byID.values),
            topics:newTopics,showcaseDraft:drafts)
        try merge(archive)
        return rows.count
    }
    private func merge(_ archive:PortableArchive)throws{
        var byID=Dictionary(uniqueKeysWithValues:videos.map{($0.bvid,$0)})
        for item in archive.videos{
            guard Self.parseBV(item.bvid)==item.bvid else{continue}
            if let previous=byID[item.bvid]{
                var merged=previous
                if previous.metadataMissing && !item.metadataMissing{
                    merged.title=item.title;merged.metadataMissing=false
                }
                merged.tags=Array(Set(previous.tags+item.tags)).sorted()
                merged.topics=Array(Set(previous.topics+item.topics)).sorted()
                merged.sourceFolders=Array(Set(previous.sourceFolders+item.sourceFolders)).sorted()
                merged.watched=previous.watched||item.watched
                if merged.notes.isEmpty{merged.notes=item.notes}
                byID[item.bvid]=merged
            }else{byID[item.bvid]=item}
        }
        var names=Dictionary(uniqueKeysWithValues:topics.map{($0.name,$0)})
        for topic in archive.topics{
            if let old=names[topic.name]{
                names[topic.name]=PortableTopic(name:old.name,
                    description:old.description.isEmpty ? topic.description:old.description,
                    notes:old.notes.isEmpty ? topic.notes:old.notes,
                    chapters:Array(Set(old.chapters+topic.chapters)),
                    items:Array(Set(old.items+topic.items)),
                    sections:topic.sections.merging(old.sections){_,existing in existing})
            }else{names[topic.name]=topic}
        }
        let all=Array(byID.values).sorted{$0.title.localizedCompare($1.title)==.orderedAscending}
        let allTopics=Array(names.values)
        let draft=drafts.isEmpty ? archive.showcaseDraft:drafts
        try persist(PortableArchive(videos:all,topics:allTopics,showcaseDraft:draft))
        videos=all;topics=allTopics;drafts=draft
    }
    static func parseBV(_ input:String)->String?{
        guard let r=input.range(of:"BV[0-9A-Za-z]{10}",options:.regularExpression)else{return nil}
        return String(input[r])
    }
}

struct ExportArchive:FileDocument {
    static var readableContentTypes:[UTType]{[.json]}
    var archive:PortableArchive
    init(videos:[SavedVideo],topics:[PortableTopic],drafts:[CuratedVideo]){
        archive=PortableArchive(videos:videos,topics:topics,showcaseDraft:drafts)
    }
    init(configuration:ReadConfiguration)throws{
        let data=configuration.file.regularFileContents ?? Data()
        archive=try JSONDecoder().decode(PortableArchive.self,from:data)
    }
    func fileWrapper(configuration:WriteConfiguration)throws->FileWrapper{
        FileWrapper(regularFileWithContents:try JSONEncoder().encode(archive))
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
        if webView.url?.scheme != url.scheme || webView.url?.host != url.host || webView.url?.port != url.port {
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
                .fileExporter(isPresented:$exportFile,document:ExportArchive(videos:library.videos,topics:library.topics,drafts:library.drafts),
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
