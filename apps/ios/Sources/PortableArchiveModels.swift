import Foundation

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
    // Web creates locally curated drafts without url. Reconstruct it from bvid on use.
    // A missing URL must never make the entire portable archive fail to decode.
    var url:String?
}
struct PortableArchive: Codable {
    var type: String = "tongpin_private_library"
    var version: Int = 3
    var videos: [SavedVideo]
    var topics: [PortableTopic] = []
    var showcaseDraft: [CuratedVideo] = []
    private enum CodingKeys:String,CodingKey {case type,version,videos,topics,showcaseDraft}
    init(videos:[SavedVideo],topics:[PortableTopic]=[],showcaseDraft:[CuratedVideo]=[]) {
        self.videos=videos; self.topics=topics; self.showcaseDraft=showcaseDraft
    }
    init(from decoder:Decoder) throws {
        let c=try decoder.container(keyedBy:CodingKeys.self)
        type=try c.decodeIfPresent(String.self,forKey:.type) ?? "tongpin_private_library"
        version=try c.decodeIfPresent(Int.self,forKey:.version) ?? 3
        videos=try c.decode([SavedVideo].self,forKey:.videos)
        topics=try c.decodeIfPresent([PortableTopic].self,forKey:.topics) ?? []
        showcaseDraft=try c.decodeIfPresent([CuratedVideo].self,forKey:.showcaseDraft) ?? []
    }
}

