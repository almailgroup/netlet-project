import PhotosUI
import SwiftUI
import UIKit

extension API {
    /// One subcategory's picture to draw, in its department's style (`reference`, the art's own bytes).
    struct SubcategoryPictureDraw: Encodable, Sendable {
        struct Reference: Encodable, Sendable {
            let mimeType: String
            let data: String
        }

        let department: String
        let slug: String
        let reference: Reference?

        private enum CodingKeys: String, CodingKey { case department, slug, reference }

        /// A missing style is sent as null, which the server's schema asks for by name.
        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(department, forKey: .department)
            try container.encode(slug, forKey: .slug)
            try container.encode(reference, forKey: .reference)
        }
    }

    /// A picture kept for a subcategory, or null to take it off.
    struct SubcategoryPictureSet: Encodable, Sendable {
        let department: String
        let slug: String
        let path: String?

        private enum CodingKeys: String, CodingKey { case department, slug, path }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(department, forKey: .department)
            try container.encode(slug, forKey: .slug)
            try container.encode(path, forKey: .path)
        }
    }

    static let subcategoryPicturesDrawable = Procedure<NoInput, Bool>(query: "subcategoryPictures.drawable")
    static let drawSubcategoryPicture = Procedure<SubcategoryPictureDraw, DrawnPicture>(mutation: "subcategoryPictures.draw")
    static let setSubcategoryPicture = Procedure<SubcategoryPictureSet, [String: String]>(mutation: "subcategoryPictures.set")
}

/// The subcategories' pictures — the web's `/admin/subcategory-pictures`
/// (`Shared/commerce/subcategoryPictures.ts`), on the owner's word: one card
/// a department, a row a subcategory, showing what the shop shows now — the
/// picture kept here, or the subcategory's original, carried in the app
/// (`WebAssets.subcategory`) — and, beside it, what was just drawn, which
/// goes nowhere until Keep is pressed. Removing a kept picture brings the
/// original back. Each drawing is sent the department's own art as the style
/// to match; a picture can also be chosen from the phone's photos, which is
/// how the page works with no gateway. "Draw the missing ones" went when the
/// owner sent a picture for every subcategory: nothing is missing, and a
/// button nobody can press is a dead control.
struct PortalSubcategoryPicturesView: View {
    /// The edge a kept picture is made, square (`SUBCATEGORY_PICTURE_EDGE`).
    static let edge = 384

    private struct Drawn {
        let jpeg: Data
        let image: UIImage
    }

    @State private var pictures: [String: String]?
    @State private var drawable = false
    @State private var failed: APIError?
    @State private var drafts: [String: Drawn] = [:]
    @State private var busy: [String: String] = [:]
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("subpics.title"), intro: l.t("subpics.intro"), refresh: { await load() }) {
            if let pictures {
                if !drafts.isEmpty {
                    Button {
                        Task { await keepAll() }
                    } label: {
                        Label(l.t("subpics.keepDrawn"), systemImage: "photo.badge.plus")
                    }
                    .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                }
                if !drawable {
                    PortalNotice(text: l.t("subpics.offNote"), tone: .warning)
                }
                ForEach(ReferenceData.shared.departments.filter { !$0.subs.isEmpty }, id: \.slug) { department in
                    PortalCard {
                        HStack(spacing: 10) {
                            BundledImage(image: WebAssets.department(department.slug))
                                .frame(width: 44, height: 33)
                                .accessibilityHidden(true)
                            Text(l.t(department.label))
                                .font(.inter(16, .bold))
                                .foregroundStyle(Brand.navy)
                                .accessibilityAddTraits(.isHeader)
                        }
                        ForEach(department.subs) { subcategory in
                            row(department: department.slug, subcategory: subcategory, kept: pictures["\(department.slug)/\(subcategory.slug)"])
                        }
                    }
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task { await load() }
    }

    private func row(department: String, subcategory: Department.Subcategory, kept: String?) -> some View {
        let key = "\(department)/\(subcategory.slug)"
        let name = subcategory.shown(l.current)
        let draft = drafts[key]
        let working = busy[key] != nil
        return VStack(alignment: .leading, spacing: 8) {
            Text(name).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
            HStack(alignment: .top, spacing: 12) {
                tile(caption: l.t(kept == nil ? "subpics.original" : "subpics.onShop")) {
                    if let kept {
                        RemoteImage(reference: kept, contentMode: .fit, label: l.t("subpics.keptAlt", ["name": name]))
                    } else if let original = WebAssets.subcategory(department, subcategory.slug) {
                        Image(uiImage: original).resizable().scaledToFit()
                            .accessibilityLabel(l.t("subpics.keptAlt", ["name": name]))
                    } else {
                        Image(systemName: subcategory.symbol)
                            .font(.system(size: 26))
                            .foregroundStyle(Brand.muted)
                            .accessibilityHidden(true)
                    }
                }
                if draft != nil || busy[key] == "drawing" {
                    tile(caption: l.t(draft == nil ? "subpics.drawing" : "subpics.drawn"), dashed: true) {
                        if let draft {
                            Image(uiImage: draft.image).resizable().scaledToFit()
                                .accessibilityLabel(l.t("subpics.draftAlt", ["name": name]))
                        } else {
                            ProgressView().tint(Brand.navy)
                        }
                    }
                }
            }
            FlowLayout(spacing: 8) {
                if draft != nil {
                    Button(l.t("subpics.keep")) { Task { await keep(department: department, subcategory: subcategory) } }
                        .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                        .accessibilityLabel(l.t("subpics.keepName", ["name": name]))
                    Button(l.t("subpics.drawAgain")) { Task { _ = await draw(department: department, subcategory: subcategory) } }
                        .buttonStyle(PortalSmallButtonStyle(kind: .secondary))
                        .disabled(!drawable)
                        .accessibilityLabel(l.t("subpics.drawAgainName", ["name": name]))
                    Button(l.t("subpics.discard")) { drafts[key] = nil }
                        .buttonStyle(PortalSmallButtonStyle(kind: .secondary))
                        .accessibilityLabel(l.t("subpics.discardName", ["name": name]))
                } else {
                    Button(l.t(kept == nil ? "subpics.draw" : "subpics.drawAgain")) { Task { _ = await draw(department: department, subcategory: subcategory) } }
                        .buttonStyle(PortalSmallButtonStyle(kind: .secondary))
                        .disabled(!drawable)
                        .accessibilityLabel(l.t(kept == nil ? "subpics.drawName" : "subpics.drawAgainName", ["name": name]))
                    PhotoChoice(label: l.t("subpics.upload"), name: l.t("subpics.uploadName", ["name": name])) { data in
                        await upload(data, department: department, subcategory: subcategory)
                    }
                    if kept != nil {
                        Button(l.t("subpics.remove")) { Task { await remove(department: department, subcategory: subcategory) } }
                            .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                            .accessibilityLabel(l.t("subpics.removeName", ["name": name]))
                    }
                }
            }
            .disabled(working)
        }
        .padding(.vertical, 6)
    }

    private func tile<Content: View>(caption: String, dashed: Bool = false, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            content()
                .frame(width: 88, height: 88)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Brand.cardLine, style: StrokeStyle(lineWidth: 1, dash: dashed ? [4, 3] : []))
                )
            Text(caption).font(.inter(12)).foregroundStyle(Brand.muted)
        }
    }

    private func load() async {
        do {
            pictures = try await app.services.api.call(API.subcategoryPictures)
            drawable = (try? await app.services.api.call(API.subcategoryPicturesDrawable)) ?? false
            failed = nil
        } catch {
            failed = APIError.from(error)
        }
    }

    /// Draws one; answers the refusal's key when it was refused, nil when it worked.
    private func draw(department: String, subcategory: Department.Subcategory) async -> String? {
        let key = "\(department)/\(subcategory.slug)"
        busy[key] = "drawing"
        defer { busy[key] = nil }
        let reference = WebAssets.departmentFile(department).map { API.SubcategoryPictureDraw.Reference(mimeType: "image/webp", data: $0.base64EncodedString()) }
        do {
            let answer = try await app.services.api.call(API.drawSubcategoryPicture, .init(department: department, slug: subcategory.slug, reference: reference))
            guard let bytes = Data(base64Encoded: answer.data), let image = UIImage(data: bytes) else { throw ImagePreparation.Problem.unreadable }
            let square = try prepare(image)
            drafts[key] = Drawn(jpeg: square.data, image: square.image)
            return nil
        } catch {
            let refusal = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
            Haptics.refused()
            app.toast("\(subcategory.shown(l.current)): \(l.t(refusal == "error.serverProblem" ? "drawing.failed" : refusal))")
            return refusal
        }
    }

    private func prepare(_ image: UIImage) throws -> (data: Data, image: UIImage) {
        let rules = ReferenceData.shared.rules
        return try ImagePreparation.squareJPEG(from: image, edge: Self.edge, minEdge: rules.media.minEdge, maxBytes: rules.media.maxUploadBytes)
    }

    private func keep(department: String, subcategory: Department.Subcategory, picture: Drawn? = nil) async {
        let key = "\(department)/\(subcategory.slug)"
        guard let chosen = picture ?? drafts[key] else { return }
        busy[key] = "keeping"
        defer { busy[key] = nil }
        let worked = await app.attempt(fallback: "media.failed") {
            let uploaded = try await app.services.seller.upload(jpeg: chosen.jpeg)
            pictures = try await app.services.api.call(API.setSubcategoryPicture, .init(department: department, slug: subcategory.slug, path: uploaded.url))
        }
        if worked {
            if picture == nil { drafts[key] = nil }
            app.toast(l.t("subpics.kept", ["name": subcategory.shown(l.current)]))
        }
    }

    private func remove(department: String, subcategory: Department.Subcategory) async {
        // Asks first, on the owner's word.
        let name = "\u{2068}\(subcategory.shown(l.current))\u{2069}"
        guard await RemovalQuestion.ask(l, title: l.t("remove.pictureTitle"), message: l.t("remove.pictureBody", ["name": name])) else { return }
        let key = "\(department)/\(subcategory.slug)"
        busy[key] = "removing"
        defer { busy[key] = nil }
        let worked = await app.attempt(fallback: "media.failed") {
            pictures = try await app.services.api.call(API.setSubcategoryPicture, .init(department: department, slug: subcategory.slug, path: nil))
        }
        if worked { app.toast(l.t("subpics.removed", ["name": subcategory.shown(l.current)])) }
    }

    private func upload(_ data: Data, department: String, subcategory: Department.Subcategory) async {
        guard let image = UIImage(data: data), let square = try? prepare(image) else {
            Haptics.refused()
            app.toast(l.t("media.notAnImage"))
            return
        }
        await keep(department: department, subcategory: subcategory, picture: Drawn(jpeg: square.data, image: square.image))
    }

    private func keepAll() async {
        for department in ReferenceData.shared.departments {
            for subcategory in department.subs where drafts["\(department.slug)/\(subcategory.slug)"] != nil {
                await keep(department: department.slug, subcategory: subcategory)
            }
        }
    }
}

/// "Upload": the phone's own photo picker, handing back the chosen picture's bytes.
private struct PhotoChoice: View {
    let label: String
    let name: String
    let chosen: (Data) async -> Void
    @State private var item: PhotosPickerItem?

    var body: some View {
        PhotosPicker(selection: $item, matching: .images) {
            Text(label)
        }
        .buttonStyle(PortalSmallButtonStyle(kind: .secondary))
        .accessibilityLabel(name)
        .onChange(of: item) {
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) { await chosen(data) }
                self.item = nil
            }
        }
    }
}
