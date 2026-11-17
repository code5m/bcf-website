import Foundation

// Native contract test against the same real-shaped v3 fixture used by Node.
do {
    guard CommandLine.arguments.count==2 else { throw NSError(domain:"Args",code:1) }
    let source=try Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1]))
    let decoded=try JSONDecoder().decode(PortableArchive.self,from:source)
    precondition(decoded.type=="tongpin_private_library")
    precondition(decoded.videos.count==2)
    precondition(decoded.videos[0].progress==67.5)
    precondition(decoded.videos[1].progress==0)
    precondition(decoded.videos[0].notes=="我的私人笔记，不得公开")
    precondition(decoded.videos[0].sourceFolders==["原收藏夹A"])
    precondition(decoded.topics[0].chapters==["构思","拍摄","后期"])
    precondition(decoded.showcaseDraft.count==1)
    precondition(decoded.showcaseDraft[0].url == nil)
    let exported=try JSONEncoder().encode(decoded)
    let restored=try JSONDecoder().decode(PortableArchive.self,from:exported)
    precondition(restored.videos[0].progress==67.5)
    precondition(restored.videos[0].notes==decoded.videos[0].notes)
    precondition(restored.showcaseDraft[0].bvid==decoded.showcaseDraft[0].bvid)
    print("PASS: Swift native v3 JSON import/export, progress, private notes, chapters, and URL-less showcase")
} catch {
    fputs("Portable contract failure: \(error)\n",stderr)
    exit(1)
}
