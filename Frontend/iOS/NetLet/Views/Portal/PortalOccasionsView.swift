import PhotosUI
import SwiftUI

/// NetLet's occasions desk — the web's `/admin/occasions`: NetLet's own
/// occasions, each with where it stands today and whether it has enough to
/// be drawn, and the calendar's ten, each with what stands over it. Hiding a
/// calendar occasion asks first, since it takes a section off the home page.
struct PortalOccasionsView: View {
    @State private var desk: OccasionDesk?
    @State private var failed: APIError?
    /// The calendar occasion being hidden, by its address.
    @State private var hiding: String?
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    /// The home page's floor and ceiling (`MIN_SHELF_PRODUCTS`, `MAX_OCCASIONS`).
    private let floor = HomeShelf.floor
    private let most = HomeShelf.mostOccasions

    var body: some View {
        PortalScreen(title: l.t("occasions.title"), intro: l.t("occasions.note"), refresh: { await load() }) {
            NavigationLink(value: Route.portal("/admin/occasions/new")) {
                Label(l.t("occasions.new"), systemImage: "plus")
            }
            .buttonStyle(PortalSmallButtonStyle(kind: .primary))
            if let desk {
                if !desk.ready {
                    PortalNotice(text: l.t("occasions.unavailable"), tone: .warning)
                } else {
                    PortalNotice(text: l.t("occasions.capNote", ["most": "\(most)", "floor": "\(floor)"]))
                    mine(desk)
                    calendar(desk)
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task { await load() }
        .confirmationDialog(
            l.t("occasions.hideTitle", ["name": hiding.flatMap { ReferenceData.shared.occasion(slug: $0) }.map { l.t($0.label) } ?? ""]),
            isPresented: Binding(get: { hiding != nil }, set: { if !$0 { hiding = nil } }),
            titleVisibility: .visible
        ) {
            Button(l.t("occasions.hide"), role: .destructive) {
                if let hiding { Task { await hide(hiding) } }
            }
            Button(l.t("common.cancel"), role: .cancel) { hiding = nil }
        } message: {
            Text(l.t("occasions.hideBody"))
        }
    }

    // MARK: Lists

    @ViewBuilder
    private func mine(_ desk: OccasionDesk) -> some View {
        // A calendar occasion switched off is in the calendar's list alone.
        let rows = desk.rows.filter { $0.status != "hidden" }
        Text(l.t("occasions.yours")).font(.inter(17, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader).padding(.top, 8)
        if rows.isEmpty {
            PortalEmpty(text: l.t("occasions.yoursNone"))
        } else {
            ForEach(rows) { row in
                NavigationLink(value: Route.portal("/admin/occasions/\(row.id)")) { card(row) }
                    .buttonStyle(PressFillStyle(cornerRadius: 14))
            }
        }
    }

    private func card(_ row: AdminOccasion) -> some View {
        let has = row.live + (row.includeTagged ? row.tagged : 0)
        return PortalCard {
            HStack(alignment: .top, spacing: 12) {
                Group {
                    if let image = row.imageUrl {
                        Brand.tint.aspectRatio(3, contentMode: .fit).overlay { RemoteImage(reference: image) }
                    } else {
                        Image(systemName: "calendar").font(.system(size: 18, weight: .semibold)).foregroundStyle(Brand.navy)
                            .frame(maxWidth: .infinity).aspectRatio(3, contentMode: .fit).background(Brand.tint)
                    }
                }
                .frame(width: 96)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 6) {
                    Text(row.name(l.current)).font(.inter(15, .semibold)).foregroundStyle(Brand.navy).multilineTextAlignment(.leading)
                    FlowLayout(spacing: 6) {
                        StatusPill(label: l.t(OccasionRules.statusKey(row.status)), tone: .portal(OccasionRules.statusTone(row.status)))
                        OccasionSeasonPill(season: row.season, startsOn: row.startsOn, endsOn: row.endsOn)
                    }
                    Text(runs(row) + " · " + l.t("occasions.counts", ["chosen": "\(row.chosen)", "tagged": "\(row.includeTagged ? row.tagged : 0)"]))
                        .font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                    if has < floor {
                        Text(l.t("occasions.needsMore", ["have": "\(has)", "floor": "\(floor)"]))
                            .font(.inter(12, .semibold)).foregroundStyle(Brand.accentInk).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.forward").font(.system(size: 13, weight: .semibold)).foregroundStyle(Brand.chevron).flipsForRightToLeftLayoutDirection(true)
            }
        }
    }

    private func runs(_ row: AdminOccasion) -> String {
        guard let from = row.startsOn, let to = row.endsOn else { return l.t("occasions.followsCalendar") }
        return l.t("occasions.runs", ["from": OrderWording.day(from, language: l.current), "to": OrderWording.day(to, language: l.current)])
    }

    @ViewBuilder
    private func calendar(_ desk: OccasionDesk) -> some View {
        Text(l.t("occasions.calendarTitle")).font(.inter(17, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader).padding(.top, 12)
        Text(l.t("occasions.calendarNote")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
        ForEach(desk.calendar) { entry in
            if let occasion = ReferenceData.shared.occasion(slug: entry.slug) {
                calendarCard(entry, name: l.t(occasion.label), mine: entry.row.flatMap { row in desk.rows.first { $0.id == row.id } })
            }
        }
    }

    private func calendarCard(_ entry: OccasionCalendarEntry, name: String, mine: AdminOccasion?) -> some View {
        let status = entry.row?.status
        let state = status == "hidden" ? "occasions.switchedOff"
            : status == "published" ? "occasions.customised"
            : status == "draft" ? "occasions.customDraft" : "occasions.asBuilt"
        return PortalCard {
            VStack(alignment: .leading, spacing: 6) {
                FlowLayout(spacing: 6) {
                    Text(name).font(.inter(15, .semibold)).foregroundStyle(Brand.navy)
                    if status == "hidden" {
                        StatusPill(label: l.t("occasions.status.hidden"), tone: .portal("warning"))
                    } else if status == "published", let mine {
                        // Taken over, it runs on NetLet's days, so that is the season to say.
                        OccasionSeasonPill(season: mine.season, startsOn: mine.startsOn, endsOn: mine.endsOn)
                    } else {
                        StatusPill(label: l.t(entry.on ? "occasions.seasonOn" : "occasions.seasonOut"), tone: .portal(entry.on ? "good" : "neutral"))
                    }
                }
                Text(l.t(state) + " · " + l.t("occasions.taggedCount", ["count": "\(entry.tagged)"]))
                    .font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                FlowLayout(spacing: 8) {
                    if let row = entry.row {
                        NavigationLink(value: Route.portal("/admin/occasions/\(row.id)")) { Text(l.t("occasions.edit")) }
                            .buttonStyle(PortalSmallButtonStyle())
                            .accessibilityLabel("\(l.t("occasions.edit")): \(name)")
                    } else {
                        NavigationLink(value: Route.portal("/admin/occasions/new?from=\(entry.slug)")) { Text(l.t("occasions.customise")) }
                            .buttonStyle(PortalSmallButtonStyle())
                            .accessibilityLabel("\(l.t("occasions.customise")): \(name)")
                    }
                    if status == "hidden", let row = entry.row {
                        Button { Task { await showAgain(row.id) } } label: { Text(l.t("occasions.showAgain")) }
                            .buttonStyle(PortalSmallButtonStyle())
                            .disabled(busy)
                            .accessibilityLabel("\(l.t("occasions.showAgain")): \(name)")
                    } else {
                        Button { hiding = entry.slug } label: { Label(l.t("occasions.hide"), systemImage: "eye.slash") }
                            .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                            .disabled(busy)
                            .accessibilityLabel("\(l.t("occasions.hide")): \(name)")
                    }
                }
            }
        }
    }

    // MARK: Work

    private func load() async {
        do {
            desk = try await app.services.api.call(API.occasionDesk)
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, desk == nil { failed = failure }
        }
    }

    private func hide(_ slug: String) async {
        busy = true
        defer { busy = false }
        hiding = nil
        if await app.attempt(done: "occasions.hiddenToast", fallback: "admin.saveFailed", { _ = try await app.services.api.call(API.occasionHide, .init(slug: slug)) }) {
            await load()
        }
    }

    private func showAgain(_ id: Int) async {
        busy = true
        defer { busy = false }
        if await app.attempt(done: "occasions.shownAgain", fallback: "admin.saveFailed", { _ = try await app.services.api.call(API.occasionSetStatus, .init(id: id, status: "draft")) }) {
            await load()
        }
    }
}

/// Where an occasion stands today, as a pill (`SeasonPill`): running, still
/// to come, over, or out of the calendar's season.
struct OccasionSeasonPill: View {
    let season: OccasionSeason
    let startsOn: String?
    let endsOn: String?
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        switch season.state {
        case "on":
            StatusPill(label: l.t("occasions.seasonOn"), tone: .portal("good"))
        case "upcoming" where startsOn != nil:
            StatusPill(label: l.t("occasions.seasonUpcoming", ["date": OrderWording.day(startsOn!, language: l.current)]), tone: .portal("navy"))
        case "ended" where endsOn != nil:
            StatusPill(label: l.t("occasions.seasonEnded", ["date": OrderWording.day(endsOn!, language: l.current)]), tone: .portal("neutral"))
        default:
            StatusPill(label: l.t("occasions.seasonOut"), tone: .portal("neutral"))
        }
    }
}

/// One of NetLet's occasions — the web's `OccasionEditor`: its two names, its
/// address, a banner picture, its days, the products chosen for it in order,
/// and whether what the stores tagged follows. Nothing is kept until Save and
/// nothing reaches a shopper until Publish; what is wrong is said under its
/// box when Save is pressed (`OccasionRules.problems`, the server's rule).
/// Opened from "Customise" (`?from=winter`) it starts as that calendar
/// occasion and is still nothing until it is saved.
struct PortalOccasionEditorView: View {
    /// Nil for a new one.
    let occasionId: Int?
    /// The calendar occasion a new one starts from.
    var from: String?
    @State private var id: Int?
    @State private var loaded = false
    @State private var failed: APIError?
    @State private var draft = OccasionDraft()
    @State private var chosen: [OccasionDetail.Chosen] = []
    @State private var status = "draft"
    @State private var season: OccasionSeason?
    @State private var tagged = 0
    /// Days of its own, or the calendar's — only a calendar occasion can follow the calendar.
    @State private var follow = false
    @State private var slugTyped = false
    @State private var tried = false
    @State private var busy = false
    @State private var deleting = false
    @State private var picked: PhotosPickerItem?
    @State private var uploading = false
    @State private var search = ""
    @State private var found: [SellerProduct] = []
    @State private var searching = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss

    private var limits: PortalRules.OccasionLimits { OccasionRules.limits }
    private var calendar: Bool { OccasionRules.isCalendar(draft.slug) }
    private var following: Bool { calendar && follow }
    /// Once public, the address is what a shared link holds; taking a calendar occasion over keeps its own.
    private var slugLocked: Bool { status != "draft" || from != nil }

    /// What Save sends: an occasion following the calendar has no days of its own.
    private var sending: OccasionDraft {
        var next = draft
        next.productIds = chosen.map(\.id)
        if following {
            next.startsOn = nil
            next.endsOn = nil
        }
        return next
    }

    private var problems: [OccasionRules.Field: String] {
        var found = OccasionRules.problems(sending)
        // Told not to follow the calendar and given no days: the rule would take that as following it.
        if calendar, !following, sending.startsOn == nil, sending.endsOn == nil { found[.startsOn] = "occasions.needDates" }
        return found
    }

    private var dirty: Bool { sending != savedSending }
    @State private var savedSending = OccasionDraft()

    private var missing: Bool {
        if case .server(let code, _, _)? = failed { return code == "NOT_FOUND" }
        return false
    }

    var body: some View {
        PortalScreen(title: name.isEmpty ? l.t("occasions.new") : name) {
            if loaded {
                if id != nil {
                    FlowLayout(spacing: 8) {
                        StatusPill(label: l.t(OccasionRules.statusKey(status)), tone: .portal(OccasionRules.statusTone(status)))
                        if let season { OccasionSeasonPill(season: season, startsOn: draft.startsOn, endsOn: draft.endsOn) }
                        if status == "published" {
                            Button { app.open(.occasion(slug: draft.slug)) } label: { Label(l.t("occasions.viewPage"), systemImage: "arrow.up.forward.square") }
                                .buttonStyle(PortalSmallButtonStyle())
                        }
                    }
                }
                namesCard
                pictureCard
                datesCard
                productsCard
                publishCard
            } else if missing {
                PortalEmpty(text: l.t("occasions.notFound"))
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task { if !loaded { await load() } }
        .onChange(of: picked) { Task { await upload() } }
        .task(id: search) { await find() }
        .confirmationDialog(l.t("occasions.deleteTitle", ["name": name]), isPresented: $deleting, titleVisibility: .visible) {
            Button(l.t("occasions.delete"), role: .destructive) { Task { await delete() } }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(l.t(calendar ? "occasions.deleteBodyCalendar" : "occasions.deleteBody"))
        }
    }

    private var name: String {
        let arabic = draft.titleAr.trimmingCharacters(in: .whitespaces)
        return l.current == .ar && !arabic.isEmpty ? draft.titleAr : draft.title.isEmpty ? draft.titleAr : draft.title
    }

    private func said(_ field: OccasionRules.Field) -> String? {
        tried ? problems[field].map { l.t($0) } : nil
    }

    // MARK: Cards

    private var namesCard: some View {
        PortalCard {
            Text(l.t("occasions.names")).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            LabeledField(label: l.t("occasions.nameEn"), text: Binding(get: { draft.title }, set: { value in
                let title = String(value.prefix(limits.titleMax))
                draft.title = title
                if !slugTyped, !slugLocked { draft.slug = title.trimmingCharacters(in: .whitespaces).isEmpty ? "" : OccasionRules.slug(title) }
            }), problem: said(.title))
            .environment(\.layoutDirection, .leftToRight)
            LabeledField(label: l.t("occasions.nameAr"), text: Binding(get: { draft.titleAr }, set: { draft.titleAr = String($0.prefix(limits.titleMax)) }), problem: said(.titleAr))
                .environment(\.layoutDirection, .rightToLeft)
            LabeledField(
                label: l.t("occasions.slug"),
                text: Binding(get: { draft.slug }, set: { value in
                    slugTyped = true
                    draft.slug = String(value.lowercased().prefix(limits.slugMax))
                }),
                hint: calendar
                    ? l.t("occasions.slugCalendar", ["name": ReferenceData.shared.occasion(slug: draft.slug).map { l.t($0.label) } ?? ""])
                    : slugLocked ? l.t("occasions.slugLocked") : l.t("occasions.slugHint"),
                problem: said(.slug),
                keyboard: .asciiCapable,
                leftToRight: true
            )
            .disabled(slugLocked)
        }
    }

    private var pictureCard: some View {
        PortalCard {
            Text(l.t("occasions.picture")).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t("occasions.pictureHint")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            if let image = draft.imageUrl {
                OccasionBanner(reference: image).accessibilityHidden(true)
            }
            FlowLayout(spacing: 8) {
                PhotosPicker(selection: $picked, matching: .images) {
                    if uploading {
                        Label(l.t("occasions.pictureUploading"), systemImage: "hourglass")
                    } else {
                        Label(l.t(draft.imageUrl == nil ? "occasions.choosePicture" : "occasions.changePicture"), systemImage: "photo.badge.plus")
                    }
                }
                .buttonStyle(PortalSmallButtonStyle())
                .disabled(uploading)
                if draft.imageUrl != nil {
                    Button { draft.imageUrl = nil } label: { Label(l.t("occasions.removePicture"), systemImage: "xmark") }
                        .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                        .disabled(uploading)
                }
            }
            if let problem = said(.imageUrl) { problemLine(problem) }
        }
    }

    private var datesCard: some View {
        PortalCard {
            Text(l.t("occasions.dates")).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t("occasions.datesHint")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            if calendar {
                Toggle(isOn: $follow) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(l.t("occasions.followCalendar")).font(.inter(14, .semibold)).foregroundStyle(Brand.ink)
                        Text(l.t("occasions.followCalendarHint")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .tint(Brand.navy)
            }
            if !following {
                dayField(l.t("occasions.startsOn"), day: $draft.startsOn, problem: said(.startsOn))
                dayField(l.t("occasions.endsOn"), day: $draft.endsOn, problem: said(.endsOn))
            }
        }
    }

    /// A day box: "Choose" until a day is picked, then the system's picker in Kuwait's days.
    @ViewBuilder
    private func dayField(_ label: String, day: Binding<String?>, problem: String?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
            if let value = day.wrappedValue, let date = Self.date(value) {
                HStack {
                    DatePicker(label, selection: Binding(get: { date }, set: { day.wrappedValue = StoreRules.kuwaitDay($0) }), displayedComponents: .date)
                        .labelsHidden()
                        .kuwaitDays()
                    Spacer(minLength: 0)
                    Button { day.wrappedValue = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Brand.muted) }
                        .buttonStyle(.tap)
                        .accessibilityLabel(l.t("occasions.clearDay", ["day": label]))
                }
            } else {
                Button { day.wrappedValue = StoreRules.kuwaitDay(Date()) } label: { Label(l.t("occasions.chooseDay"), systemImage: "calendar") }
                    .buttonStyle(PortalSmallButtonStyle())
            }
            if let problem { problemLine(problem) }
        }
    }

    private var productsCard: some View {
        let has = Set(chosen.map(\.id))
        let full = chosen.count >= limits.maxProducts
        let words = tagWords
        return PortalCard {
            Text(l.t("occasions.products")).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t("occasions.productsHint")).font(.inter(13)).foregroundStyle(Brand.muted)
            Text(l.t("occasions.productsCount", ["count": "\(chosen.count)", "max": "\(limits.maxProducts)"])).font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
            if chosen.isEmpty {
                Text(l.t("occasions.productsNone")).font(.inter(13)).foregroundStyle(Brand.muted)
            } else {
                ForEach(Array(chosen.enumerated()), id: \.element.id) { index, product in
                    chosenRow(product, index: index)
                }
            }
            LabeledField(label: l.t("occasions.productsSearch"), text: $search)
            if searching, found.isEmpty {
                ProgressView().tint(Brand.navy)
            } else if found.isEmpty {
                Text(l.t("occasions.searchNone")).font(.inter(13)).foregroundStyle(Brand.muted)
            } else {
                ForEach(found) { product in
                    HStack(spacing: 10) {
                        thumb(product.cover)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(product.displayTitle(l.current)).font(.inter(14, .semibold)).foregroundStyle(Brand.navy).lineLimit(2)
                            HStack(spacing: 6) {
                                if let store = product.vendorName { Text(store).font(.inter(12)).foregroundStyle(Brand.muted) }
                                if product.status != "published" { Text(l.t("occasions.notLive")).font(.inter(12, .semibold)).foregroundStyle(Brand.accentInk) }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Button {
                            chosen.append(.init(id: product.id, title: product.title, titleAr: product.titleAr, vendorName: product.vendorName, imageUrl: product.cover, live: product.status == "published"))
                        } label: {
                            if has.contains(product.id) { Text(l.t("occasions.added")) } else { Label(l.t("occasions.add"), systemImage: "plus") }
                        }
                        .buttonStyle(PortalSmallButtonStyle())
                        .disabled(has.contains(product.id) || full)
                        .accessibilityLabel(has.contains(product.id) ? l.t("occasions.added") : l.t("occasions.addNamed", ["name": product.displayTitle(l.current)]))
                    }
                }
            }
            Toggle(isOn: $draft.includeTagged) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(l.t("occasions.includeTagged")).font(.inter(14, .semibold)).foregroundStyle(Brand.ink)
                    if !words.isEmpty {
                        Text(l.t("occasions.includeTaggedHint", ["words": words.joined(separator: l.current == .ar ? "، " : ", ")]))
                            .font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                    }
                    if id != nil, draft.includeTagged {
                        Text(l.t("occasions.taggedCount", ["count": "\(tagged)"])).font(.inter(12)).foregroundStyle(Brand.muted)
                    }
                }
            }
            .tint(Brand.navy)
            .padding(.top, 4)
        }
    }

    /// The words a store can tag a product with for it, each said once however it is spelled.
    private var tagWords: [String] {
        let all = [draft.title, draft.titleAr] + (ReferenceData.shared.occasion(slug: draft.slug)?.tags ?? [])
        var seen = Set<String>()
        return all.map { $0.trimmingCharacters(in: .whitespaces) }.filter { word in
            let folded = Occasion.fold(word)
            return !folded.isEmpty && seen.insert(folded).inserted
        }
    }

    private func chosenRow(_ product: OccasionDetail.Chosen, index: Int) -> some View {
        let label = product.name(l.current)
        return HStack(spacing: 10) {
            thumb(product.imageUrl)
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.inter(14, .semibold)).foregroundStyle(Brand.navy).lineLimit(2)
                HStack(spacing: 6) {
                    if let store = product.vendorName { Text(store).font(.inter(12)).foregroundStyle(Brand.muted) }
                    if !product.live { Text(l.t("occasions.notLive")).font(.inter(12, .semibold)).foregroundStyle(Brand.accentInk) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 4) {
                Button { move(index, by: -1) } label: { Image(systemName: "arrow.up") }
                    .buttonStyle(PortalSmallButtonStyle())
                    .disabled(index == 0)
                    .accessibilityLabel(l.t("occasions.moveUp", ["name": label]))
                Button { move(index, by: 1) } label: { Image(systemName: "arrow.down") }
                    .buttonStyle(PortalSmallButtonStyle())
                    .disabled(index == chosen.count - 1)
                    .accessibilityLabel(l.t("occasions.moveDown", ["name": label]))
                Button { chosen.removeAll { $0.id == product.id } } label: { Image(systemName: "xmark") }
                    .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                    .accessibilityLabel(l.t("occasions.removeNamed", ["name": label]))
            }
        }
    }

    private func thumb(_ reference: String?) -> some View {
        Brand.tint
            .frame(width: 44, height: 44)
            .overlay { if let reference { RemoteImage(reference: reference) } }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .accessibilityHidden(true)
    }

    private var publishCard: some View {
        let has = chosen.filter(\.live).count + (draft.includeTagged ? tagged : 0)
        let short = id != nil && has < HomeShelf.floor
        let note = id == nil ? "occasions.saveFirst" : status == "published" ? "occasions.publishedNote" : status == "hidden" ? "occasions.hiddenNote" : "occasions.publishNote"
        return PortalCard {
            Text(l.t("occasions.publish")).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t(note)).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            if short {
                PortalNotice(text: l.t("occasions.needsMore", ["have": "\(has)", "floor": "\(HomeShelf.floor)"]), tone: .warning)
            }
            if status == "draft", calendar {
                PortalNotice(text: l.t("occasions.customDraft"))
            }
            FlowLayout(spacing: 8) {
                if id != nil {
                    Button { deleting = true } label: { Label(l.t("occasions.delete"), systemImage: "trash") }
                        .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                        .disabled(busy)
                }
                Button { Task { await save() } } label: {
                    if busy { ProgressView() } else { Label(l.t("occasions.save"), systemImage: "square.and.arrow.down") }
                }
                .buttonStyle(PortalSmallButtonStyle())
                .disabled(busy || (!dirty && id != nil))
                if id != nil, status == "published" {
                    Button { Task { await setStatus("draft") } } label: { Text(l.t("occasions.takeDown")) }
                        .buttonStyle(PortalSmallButtonStyle())
                        .disabled(busy)
                }
                if id != nil, status == "hidden" {
                    Button { Task { await setStatus("draft") } } label: { Text(l.t("occasions.showAgain")) }
                        .buttonStyle(PortalSmallButtonStyle())
                        .disabled(busy)
                }
                if id != nil, status != "published" {
                    Button { Task { await publish() } } label: { Label(l.t("occasions.publish"), systemImage: "checkmark.circle") }
                        .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                        .disabled(busy)
                }
            }
        }
    }

    private func problemLine(_ text: String) -> some View {
        Label(text, systemImage: "exclamationmark.circle")
            .font(.inter(12, .semibold))
            .foregroundStyle(Brand.danger)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: Products

    private func move(_ index: Int, by offset: Int) {
        guard chosen.indices.contains(index), chosen.indices.contains(index + offset) else { return }
        chosen.swapAt(index, index + offset)
    }

    /// The products page's own search, over every store, asked once typing pauses.
    private func find() async {
        try? await Task.sleep(for: .milliseconds(300))
        if Task.isCancelled { return }
        searching = true
        defer { searching = false }
        let words = search.trimmingCharacters(in: .whitespaces)
        if let page = try? await app.services.api.call(API.sellerProducts, .init(pageSize: 20, query: words.isEmpty ? nil : words)) {
            found = page.rows
        }
    }

    // MARK: Work

    nonisolated static func date(_ day: String) -> Date? {
        let reader = DateFormatter()
        reader.calendar = Calendar(identifier: .gregorian)
        reader.locale = Locale(identifier: "en_US_POSIX")
        reader.timeZone = TimeZone(identifier: "Asia/Kuwait")
        reader.dateFormat = "yyyy-MM-dd"
        return reader.date(from: day)
    }

    private func adopt(_ detail: OccasionDetail) {
        let row = detail.occasion
        id = row.id
        status = row.status
        season = row.season
        tagged = row.tagged
        draft = OccasionDraft(slug: row.slug, title: row.title, titleAr: row.titleAr, imageUrl: row.imageUrl, startsOn: row.startsOn, endsOn: row.endsOn, includeTagged: row.includeTagged)
        chosen = detail.products
        follow = row.calendar && row.startsOn == nil && row.endsOn == nil
        slugTyped = true
        savedSending = sending
    }

    private func load() async {
        guard let occasionId else {
            // A new one, or one of the calendar's to take over: its address and the dictionary's names.
            if let from, let occasion = ReferenceData.shared.occasion(slug: from) {
                draft = OccasionDraft(slug: occasion.slug, title: Phrasebook.shared.text(occasion.label, language: .en), titleAr: Phrasebook.shared.text(occasion.label, language: .ar))
                follow = true
                slugTyped = true
            }
            loaded = true
            return
        }
        do {
            adopt(try await app.services.api.call(API.occasionGet, .init(id: occasionId)))
            loaded = true
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled { failed = failure }
        }
    }

    /// Whether the form can go: says what is wrong under its box when it cannot.
    private func ready() -> Bool {
        guard OccasionRules.first(problems) != nil else { return true }
        tried = true
        Haptics.refused()
        return false
    }

    @discardableResult
    private func save() async -> Bool {
        guard ready() else { return false }
        busy = true
        defer { busy = false }
        let request = API.OccasionSave(id: OrNull(id), occasion: sending)
        var answer: OccasionDetail?
        let ok = await app.attempt(done: "occasions.saved", fallback: "admin.saveFailed") {
            answer = try await app.services.api.call(API.occasionSave, request)
        }
        if let answer {
            adopt(answer)
            tried = false
        }
        return ok
    }

    private func publish() async {
        if dirty, !(await save()) { return }
        guard ready() else { return }
        await setStatus("published")
    }

    private func setStatus(_ next: String) async {
        guard let id else { return }
        busy = true
        defer { busy = false }
        let done = next == "published" ? "occasions.publishedToast" : status == "hidden" ? "occasions.shownAgain" : "occasions.takenDown"
        var answer: OccasionDetail?
        _ = await app.attempt(done: done, fallback: "admin.saveFailed") {
            answer = try await app.services.api.call(API.occasionSetStatus, .init(id: id, status: next))
        }
        if let answer { adopt(answer) }
    }

    private func delete() async {
        guard let id else { return }
        busy = true
        defer { busy = false }
        if await app.attempt(done: "occasions.deleted", fallback: "admin.saveFailed", { _ = try await app.services.api.call(API.occasionDelete, .init(id: id)) }) {
            dismiss()
        }
    }

    /// The largest 3:1 box the picture holds, centred — the home banners' own
    /// crop (`prepareBanner`), so what the editor shows is what the home page draws.
    private func upload() async {
        guard let picked else { return }
        uploading = true
        defer {
            uploading = false
            self.picked = nil
        }
        let rules = WarehouseRules.shared.ads
        guard let data = try? await picked.loadTransferable(type: Data.self), let image = UIImage(data: data) else { return app.toast(l.t("media.notAnImage")) }
        let aspect = rules.bannerAspect
        let pixels = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        let wide = pixels.width / pixels.height >= aspect
        let crop = CGSize(width: wide ? pixels.height * aspect : pixels.width, height: wide ? pixels.height : pixels.width / aspect)
        let width = min(crop.width, CGFloat(rules.bannerMaxWidth)).rounded()
        guard width >= CGFloat(rules.bannerMinWidth) else { return app.toast(l.t("ads.bannerTooSmall")) }
        let target = CGSize(width: width, height: (width / aspect).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let drawn = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            let scale = target.width / crop.width
            let origin = CGPoint(x: -(pixels.width - crop.width) / 2 * scale, y: -(pixels.height - crop.height) / 2 * scale)
            image.draw(in: CGRect(origin: origin, size: CGSize(width: pixels.width * scale, height: pixels.height * scale)))
        }
        guard let jpeg = drawn.jpegData(compressionQuality: 0.86) else { return app.toast(l.t("media.notAnImage")) }
        do {
            draft.imageUrl = try await app.services.seller.upload(jpeg: jpeg).url
        } catch {
            let key = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
            app.toast(l.t(key == "error.serverProblem" ? "media.failed" : key))
        }
    }
}
