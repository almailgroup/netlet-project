import CryptoKit
import Foundation

/// Today's public shelves, kept on the phone — the web's `lib/shelfMemory.ts`.
///
/// The app opened on grey outlines every time, for as long as the server took
/// to answer from across the world, while the web opened on what it had shown
/// earlier in the day. So the answers to the procedures that are the same for
/// everybody — the catalogue's first page, Bestsellers, the departments'
/// counts, the stores, the brands and the shop's contact details — are kept as
/// the server sent them, and the home page draws them at once and asks again
/// behind them (`HomeShelf.load`).
///
/// **For the Kuwaiti day they were read on and no longer**, because a store's
/// discount permit ends with the day and a remembered saving must not outlive
/// it; the web keeps the same rule. Nothing about the shopper is kept here —
/// no bag, order, account or search — because none of these procedures
/// answers anything personal.
final class ShelfMemory: @unchecked Sendable {
    static let shared = ShelfMemory()

    /// The procedures whose answers are kept, named by the app's own list of them.
    static let procedures: Set<String> = [
        API.products.path, API.bestsellers.path, API.departmentCounts.path,
        API.stores.path, API.brands.path, API.contact.path,
    ]

    private let folder: URL?
    private let now: @Sendable () -> Date
    private let lock = NSLock()

    init(folder: URL? = ShelfMemory.defaultFolder(), now: @escaping @Sendable () -> Date = { Date() }) {
        self.folder = folder
        self.now = now
        if let folder { try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true) }
    }

    static func defaultFolder() -> URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("NetLetShelves")
    }

    /// The Kuwaiti day a moment falls on: Kuwait is UTC+3 all year.
    static func kuwaitDay(_ date: Date) -> String {
        let shifted = date.addingTimeInterval(3 * 60 * 60)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let parts = calendar.dateComponents([.year, .month, .day], from: shifted)
        func padded(_ value: Int?, _ width: Int) -> String {
            let text = String(value ?? 0)
            return String(repeating: "0", count: max(0, width - text.count)) + text
        }
        return "\(padded(parts.year, 4))-\(padded(parts.month, 2))-\(padded(parts.day, 2))"
    }

    /// Whether a request is for one of the kept procedures.
    static func keeps(_ request: URLRequest) -> Bool {
        guard request.httpMethod == "GET", let path = request.url?.path else { return false }
        return procedures.contains { path.hasSuffix("/api/trpc/\($0)") }
    }

    func remember(_ data: Data, for request: URLRequest) {
        guard Self.keeps(request), let file = file(for: request) else { return }
        var stored = Data((Self.kuwaitDay(now()) + "\n").utf8)
        stored.append(data)
        lock.lock()
        defer { lock.unlock() }
        try? stored.write(to: file, options: .atomic)
    }

    /// The answer kept today for this request, or nil.
    func recall(_ request: URLRequest) -> Data? {
        guard Self.keeps(request), let file = file(for: request) else { return nil }
        lock.lock()
        let stored = try? Data(contentsOf: file)
        lock.unlock()
        guard let stored, let newline = stored.firstIndex(of: UInt8(ascii: "\n")) else { return nil }
        let day = String(decoding: stored[..<newline], as: UTF8.self)
        guard day == Self.kuwaitDay(now()) else { return nil }
        return Data(stored[stored.index(after: newline)...])
    }

    private func file(for request: URLRequest) -> URL? {
        guard let folder, let address = request.url?.absoluteString else { return nil }
        let name = SHA256.hash(data: Data(address.utf8)).map { String(format: "%02x", $0) }.joined()
        return folder.appendingPathComponent(name)
    }
}
