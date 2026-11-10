import SwiftUI
import UIKit

// MARK: - The calls

extension API {
    /// A maker's page read for the images it declares for its product
    /// (`media.scanPage`, 3.1.10).
    struct MakerPageInput: Encodable, Sendable {
        let url: String
    }

    struct MakerCandidate: Decodable, Hashable, Sendable {
        let url: String
        /// "product" for one the page lists as the product's image, "share" for its share image.
        let source: String
    }

    struct MakerScan: Decodable, Sendable {
        let page: String
        let title: String?
        let candidates: [MakerCandidate]
    }

    /// The maker's page found from the product's name (`media.findPages`).
    struct MakerSearchInput: Encodable, Sendable {
        let name: String
        var brand: String?
    }

    struct MakerPage: Decodable, Hashable, Sendable {
        let url: String
        let host: String
        let title: String
    }

    static let scanMakerPage = Procedure<MakerPageInput, MakerScan>(mutation: "media.scanPage")
    static let findMakerPages = Procedure<MakerSearchInput, [MakerPage]>(mutation: "media.findPages")
    /// Whether a model can be asked at all, so finding a page and cleaning a
    /// photo are drawn only where they work.
    static let mediaAIAvailable = Procedure<NoInput, Bool>(query: "media.aiAvailable")
}

/// A picture on its way onto a product, with where it came from.
struct PhotoIntake: Identifiable {
    let id = UUID()
    let data: Data
    /// The maker's address it was found at, for a maker's image.
    var source: String?
}

// MARK: - Which version

/// "Which version should go on the product?" — the web's before and after
/// (3.3.4), which the app's uploads never had: the photo as it was taken, the
/// same photo with the automatic fixes (`PhotoFixer`), and, where a model can
/// be asked, the photo put on white by AI, made only when it is pressed. The
/// seller looks at them side by side and one press adds the one they chose;
/// nothing is stored before that.
struct PhotoChoiceSheet: View {
    let intake: PhotoIntake
    /// The photo is uploaded: its stored address, and the JPEG that went up.
    let added: (UploadedPhoto, Data) -> Void

    private enum Version: String, Identifiable {
        case taken, fixed, cleaned

        var id: String { rawValue }
    }

    @State private var taken: PreparedPhoto?
    @State private var fixed: PreparedPhoto?
    @State private var cleaned: PreparedPhoto?
    @State private var chosen: Version = .taken
    @State private var preparing = true
    @State private var cleaning = false
    @State private var uploading = false
    /// A message key said under the pictures.
    @State private var problem: String?
    @State private var aiOn = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if preparing {
                        HStack(spacing: 10) {
                            ProgressView()
                            Text(l.t("media.preparing")).font(.inter(15)).foregroundStyle(Brand.body)
                        }
                        .frame(maxWidth: .infinity, minHeight: 160)
                    } else if taken == nil {
                        Text(l.t(problem ?? "media.notAnImage"))
                            .font(.inter(15))
                            .foregroundStyle(Brand.danger)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, minHeight: 120)
                    } else {
                        versions
                        note
                        if aiOn, cleaned == nil { cleanButton }
                        if let problem {
                            Text(l.t(problem))
                                .font(.inter(13))
                                .foregroundStyle(Brand.danger)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Button {
                            Task { await add() }
                        } label: {
                            if uploading {
                                HStack(spacing: 8) { ProgressView().tint(.white); Text(l.t("media.add")) }
                            } else {
                                Text(l.t("media.add"))
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(uploading || cleaning)
                    }
                }
                .padding(16)
            }
            .background(Brand.ground)
            .navigationTitle(l.t("media.chooseTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    BarButton(l.t("media.cancel")) { dismiss() }
                }
            }
        }
        .languageDirection()
        .interactiveDismissDisabled(uploading)
        .task { await prepare() }
    }

    /// The versions there are to choose between, in the order they were made.
    private var offered: [Version] {
        var list: [Version] = [.taken]
        if fixed?.changed == true { list.append(.fixed) }
        if cleaned != nil { list.append(.cleaned) }
        return list
    }

    private func photo(_ version: Version) -> PreparedPhoto? {
        switch version {
        case .taken: return taken
        case .fixed: return fixed
        case .cleaned: return cleaned
        }
    }

    private func name(_ version: Version) -> String {
        switch version {
        case .taken: return l.t(intake.source == nil ? "media.useTaken" : "media.useOriginal")
        case .fixed: return l.t("media.useFixed")
        case .cleaned: return l.t("media.useAi")
        }
    }

    private var versions: some View {
        HStack(alignment: .top, spacing: 10) {
            ForEach(offered) { version in
                let on = chosen == version
                Button {
                    chosen = version
                } label: {
                    VStack(spacing: 8) {
                        Color.white
                            .aspectRatio(1, contentMode: .fit)
                            .overlay {
                                if let jpeg = photo(version)?.jpeg, let image = UIImage(data: jpeg) {
                                    Image(uiImage: image).resizable().scaledToFit()
                                }
                            }
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(on ? Brand.navy : Brand.cardLine, lineWidth: on ? 2 : 1))
                        HStack(spacing: 6) {
                            Image(systemName: on ? "largecircle.fill.circle" : "circle")
                                .font(.system(size: 16))
                                .foregroundStyle(on ? Brand.navy : Brand.chevron)
                            Text(name(version))
                                .font(.inter(13, on ? .bold : .semibold))
                                .foregroundStyle(Brand.navy)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.tap)
                .accessibilityLabel(name(version))
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }

    /// What the chosen version is: which fixes it got, or that it needed none,
    /// and for the model's version whose it is and what to check.
    @ViewBuilder
    private var note: some View {
        if chosen == .cleaned {
            Text(l.t("media.aiNote")).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
        } else if let fixed, fixed.changed {
            let names = fixed.fixes.map { l.t($0.labelKey) }.joined(separator: l.current == .ar ? "، " : ", ")
            Text(l.t("media.fixedThese", ["fixes": names]))
                .font(.inter(13))
                .foregroundStyle(Brand.body)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            Text(l.t("media.nothingToFix")).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
        }
    }

    private var cleanButton: some View {
        Button {
            Task { await clean() }
        } label: {
            if cleaning {
                HStack(spacing: 8) { ProgressView(); Text(l.t("media.aiCleaning")) }
            } else {
                Label(l.t("media.aiClean"), systemImage: "sparkles")
            }
        }
        .buttonStyle(SecondaryButtonStyle())
        .disabled(cleaning || uploading)
    }

    // MARK: Doing it

    /// Off the main thread: it reads every pixel of the working copy.
    private static func ready(_ data: Data, fix: Bool, rules: Rules.Media) async throws -> PreparedPhoto {
        let minEdge = rules.minEdge, maxEdge = rules.maxEdge, maxBytes = rules.maxUploadBytes
        return try await Task.detached(priority: .userInitiated) {
            try PhotoFixer.prepare(try PhotoFixer.image(from: data), fix: fix, minEdge: minEdge, maxEdge: maxEdge, maxBytes: maxBytes)
        }.value
    }

    private func prepare() async {
        let rules = ReferenceData.shared.rules.media
        do {
            let plain = try await Self.ready(intake.data, fix: false, rules: rules)
            taken = plain
            // The fixes are an offer: a photo they cannot be made for keeps its plain copy.
            fixed = try? await Self.ready(intake.data, fix: true, rules: rules)
            chosen = fixed?.changed == true ? .fixed : .taken
        } catch ImagePreparation.Problem.tooSmall {
            problem = intake.source == nil ? "media.tooSmall" : "manufacturer.tooSmall"
        } catch {
            problem = intake.source == nil ? "media.notAnImage" : "manufacturer.notAnImage"
        }
        preparing = false
        aiOn = (try? await app.services.api.call(API.mediaAIAvailable)) ?? false
    }

    private func clean() async {
        guard let taken, !cleaning else { return }
        cleaning = true
        problem = nil
        defer { cleaning = false }
        do {
            // The route takes a little over a megabyte; a heavier photo goes lighter.
            let small = taken.jpeg.count <= 1_000_000 ? taken.jpeg : (UIImage(data: taken.jpeg)?.jpegData(compressionQuality: 0.6) ?? taken.jpeg)
            let drawn = try await app.services.seller.cleanUpPhoto(jpeg: small)
            cleaned = try await Self.ready(drawn, fix: false, rules: ReferenceData.shared.rules.media)
            chosen = .cleaned
        } catch {
            let key = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
            problem = key == "error.serverProblem" || key == "error.invalidInput" ? "drawing.failed" : key
        }
    }

    private func add() async {
        guard let photo = photo(chosen), !uploading else { return }
        uploading = true
        problem = nil
        defer { uploading = false }
        do {
            let uploaded = try await app.services.seller.upload(jpeg: photo.jpeg, source: intake.source)
            Haptics.succeeded()
            added(uploaded, photo.jpeg)
            dismiss()
        } catch {
            let key = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
            problem = key == "error.serverProblem" ? "media.failed" : key
        }
    }
}

// MARK: - From the maker's page

/// "From the manufacturer's page" (3.1.10), the web's panel: paste the
/// product's page on the maker's own site — or, where a model can be asked,
/// have it found from the product's name — and NetLet's server reads the
/// images the maker declares for the product. Each is fetched through NetLet,
/// so the phone never contacts the maker, and the one chosen goes through the
/// same before and after as a photo from the library, noted with where it
/// came from.
struct MakerImagesSheet: View {
    /// The product's name, for "Find it for me".
    let productName: String
    /// A picture was chosen: it goes on to `PhotoChoiceSheet`.
    let chosen: (PhotoIntake) -> Void

    @State private var address = ""
    @State private var scanning = false
    @State private var searching = false
    @State private var scan: API.MakerScan?
    @State private var pages: [API.MakerPage]?
    /// The candidates' pictures as they arrive, by address; a failed one is nil inside.
    @State private var previews: [String: Data?] = [:]
    @State private var problem: String?
    @State private var aiOn = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(l.t("manufacturer.hint")).font(.inter(14)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                    LabeledField(label: l.t("manufacturer.urlLabel"), text: $address, placeholder: "https://", keyboard: .URL, content: .URL, leftToRight: true)
                    Button {
                        Task { await read(address) }
                    } label: {
                        if scanning {
                            HStack(spacing: 8) { ProgressView().tint(.white); Text(l.t("manufacturer.finding")) }
                        } else {
                            Label(l.t("manufacturer.find"), systemImage: "photo.stack")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(scanning || address.trimmingCharacters(in: .whitespaces).isEmpty)
                    if aiOn { search }
                    if let problem {
                        Text(l.t(problem)).font(.inter(13)).foregroundStyle(Brand.danger).fixedSize(horizontal: false, vertical: true)
                    }
                    if let scan { found(scan) }
                    Text(l.t("manufacturer.rights")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
                .padding(16)
            }
            .background(Brand.ground)
            .navigationTitle(l.t("manufacturer.open"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    BarButton(l.t("manufacturer.close")) { dismiss() }
                }
            }
        }
        .languageDirection()
        .task { aiOn = (try? await app.services.api.call(API.mediaAIAvailable)) ?? false }
    }

    /// "Find it for me": the pages a search actually read, for the seller to pick the maker's own.
    @ViewBuilder
    private var search: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                Task { await findPages() }
            } label: {
                if searching {
                    HStack(spacing: 8) { ProgressView(); Text(l.t("manufacturer.searching")) }
                } else {
                    Label(l.t("manufacturer.search"), systemImage: "sparkle.magnifyingglass")
                }
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(searching || scanning)
            Text(l.t("manufacturer.searchHint")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            if let pages, !pages.isEmpty {
                Text(l.t("manufacturer.searchResults")).font(.inter(13, .bold)).foregroundStyle(Brand.navy).padding(.top, 4)
                ForEach(pages, id: \.url) { page in
                    Button {
                        address = page.url
                        Task { await read(page.url) }
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(page.title.isEmpty ? page.host : page.title)
                                .font(.inter(14, .semibold))
                                .foregroundStyle(Brand.navy)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                            Text(page.host)
                                .font(.inter(12))
                                .foregroundStyle(Brand.muted)
                                .environment(\.layoutDirection, .leftToRight)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                    }
                    .buttonStyle(PressFillStyle(cornerRadius: 12))
                    .accessibilityHint(l.t("manufacturer.choose"))
                }
            }
        }
    }

    @ViewBuilder
    private func found(_ scan: API.MakerScan) -> some View {
        if scan.candidates.isEmpty {
            Text(l.t("manufacturer.noneFound")).font(.inter(14)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Text(l.t("manufacturer.foundSome", ["count": "\(scan.candidates.count)"])).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                if let title = scan.title, !title.isEmpty {
                    Text(l.t("manufacturer.foundOn") + " " + title).font(.inter(13)).foregroundStyle(Brand.body).lineLimit(2)
                }
            }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 12) {
                ForEach(Array(scan.candidates.enumerated()), id: \.element.url) { index, candidate in
                    tile(candidate, number: index + 1)
                }
            }
        }
    }

    private func tile(_ candidate: API.MakerCandidate, number: Int) -> some View {
        let loaded = previews[candidate.url]
        let bytes = loaded ?? nil
        return VStack(alignment: .leading, spacing: 8) {
            Color.white
                .aspectRatio(1, contentMode: .fit)
                .overlay {
                    if let bytes, let image = UIImage(data: bytes) {
                        Image(uiImage: image).resizable().scaledToFit()
                            .accessibilityLabel(l.t("manufacturer.previewAlt", ["n": "\(number)"]))
                    } else if loaded == nil {
                        ProgressView().accessibilityLabel(l.t("manufacturer.loadingPreview"))
                    } else {
                        Image(systemName: "photo").font(.title2).foregroundStyle(Brand.chevron)
                            .accessibilityLabel(l.t("manufacturer.notAnImage"))
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            Text(l.t(candidate.source == "share" ? "manufacturer.sourceShare" : "manufacturer.sourceProduct"))
                .font(.inter(12))
                .foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
            Button(l.t("manufacturer.use")) {
                guard let bytes else { return }
                chosen(PhotoIntake(data: bytes, source: candidate.url))
                dismiss()
            }
            .buttonStyle(CompactPrimaryStyle())
            .disabled(bytes == nil)
        }
        .task(id: candidate.url) { await preview(candidate.url) }
    }

    // MARK: Asking

    private func key(for error: Error, fallback: String) -> String {
        let key = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
        return key == "error.serverProblem" || key == "error.invalidInput" ? fallback : key
    }

    private func read(_ url: String) async {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !scanning else { return }
        scanning = true
        problem = nil
        scan = nil
        previews = [:]
        defer { scanning = false }
        do {
            scan = try await app.services.api.call(API.scanMakerPage, .init(url: trimmed))
        } catch {
            problem = key(for: error, fallback: "manufacturer.unreachable")
        }
    }

    private func findPages() async {
        let name = productName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard name.count >= 3 else {
            problem = "manufacturer.needName"
            return
        }
        searching = true
        problem = nil
        defer { searching = false }
        do {
            let list = try await app.services.api.call(API.findMakerPages, .init(name: name))
            pages = list
            if list.isEmpty { problem = "manufacturer.searchNone" }
        } catch {
            problem = key(for: error, fallback: "manufacturer.searchFailed")
        }
    }

    /// One candidate's picture, through NetLet's server, once.
    private func preview(_ url: String) async {
        guard previews[url] == nil else { return }
        let bytes = try? await app.services.seller.remoteImage(url: url)
        // A picture this phone cannot draw is as good as none.
        if let bytes, UIImage(data: bytes) != nil {
            previews[url] = .some(bytes)
        } else {
            previews[url] = .some(nil)
        }
    }
}
