import SwiftUI

/// A store's logo, or its initials on the portal's pale navy (`StoreAvatar`).
struct StoreAvatar: View {
    let name: String
    let logoUrl: String?
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous).fill(Brand.tint)
            if let logoUrl, !logoUrl.isEmpty {
                RemoteImage(reference: logoUrl, contentMode: .fit).padding(size * 0.1)
            } else {
                Text(initials).font(.inter(size * 0.36, .bold)).foregroundStyle(Brand.navy)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
        .accessibilityHidden(true)
    }

    private var initials: String {
        let letters = name.split(separator: " ").prefix(2).compactMap { $0.first.map(String.init) }.joined().uppercased()
        return letters.isEmpty ? "·" : letters
    }
}

/// "10.00" as "10%", the way the web prints a rate.
private func rateText(_ percent: String) -> String { latin("\(ApplicationModel.trimmedRate(percent))%") }

// MARK: - The list

/// Every store — the web's `/admin/vendors`: searched and filtered on the
/// server, each status saying how many stores it holds before it is pressed,
/// and each row its shelf, its team, its rate and what it still lacks.
struct PortalStoresView: View {
    @State private var page = 1
    @State private var search = ""
    @State private var filter = "all"
    @State private var list: StoreListPage?
    @State private var failed: APIError?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("admin.vendors"), intro: l.t("admin.vendorsIntro"), refresh: { await load() }) {
            if app.session.seller?.can("platform.manageUsers") == true {
                Button { app.open(.portal("/admin/vendors/new")) } label: { Label(l.t("admin.openStoreButton"), systemImage: "storefront") }
                    .buttonStyle(PrimaryButtonStyle())
            }
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(Brand.muted)
                TextField("\(l.t("admin.searchStores")) — \(l.t("admin.searchStoresHint"))", text: $search)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .font(.inter(15))
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
            PortalSegmented(label: l.t("admin.filterStatus"), value: $filter, options: ["all", "approved", "pending", "suspended"].map { ($0, label($0)) })
            if let list {
                if list.rows.isEmpty {
                    PortalEmpty(text: l.t(search.trimmingCharacters(in: .whitespaces).isEmpty && filter == "all" ? "admin.noVendors" : "admin.noMatches"))
                } else {
                    ForEach(list.rows) { row in rowCard(row) }
                    PortalPager(page: list.page, pageSize: list.pageSize, total: list.total) { next in
                        page = next
                        Task { await load() }
                    }
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task(id: "\(filter)|\(search)") {
            // The first load is at once; a search waits for typing to pause.
            if list != nil {
                try? await Task.sleep(nanoseconds: 300_000_000)
                guard !Task.isCancelled else { return }
                page = 1
            }
            await load()
        }
    }

    private func label(_ option: String) -> String {
        let name = option == "all" ? l.t("admin.statusAll") : l.t(StoreRules.statusKey(option))
        guard let count = list?.counts[option] else { return name }
        return "\(name) \(count)"
    }

    private func rowCard(_ row: StoreListRow) -> some View {
        Button {
            app.open(.portal("/admin/vendors/\(row.id)"))
        } label: {
            PortalCard {
                HStack(spacing: 12) {
                    StoreAvatar(name: row.name, logoUrl: row.logoUrl)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.name).font(.inter(15, .bold)).foregroundStyle(Brand.navy).multilineTextAlignment(.leading)
                        Text(latin("/\(row.slug)")).font(.inter(12)).foregroundStyle(Brand.muted)
                    }
                    Spacer(minLength: 6)
                    StatusPill(label: l.t(StoreRules.statusKey(row.status)), tone: .portal(StoreRules.statusTone(row.status)))
                }
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 4) {
                    fact("admin.columnProducts", row.productCount == 0 ? l.t("admin.productsNone") : l.t("admin.productsLiveOf", ["live": "\(row.liveCount)", "total": "\(row.productCount)"]))
                    fact("admin.columnTeam", row.memberCount == 0 ? l.t("admin.teamNone") : l.t("admin.teamCount", ["count": "\(row.memberCount)"]))
                    fact("admin.columnCommission", rateText(row.commissionPercent))
                    GridRow {
                        Text(l.t("admin.columnDetails")).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
                        details(row.missing.count)
                    }
                }
            }
        }
        .buttonStyle(PressFillStyle(cornerRadius: 14))
    }

    private func fact(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(l.t(label)).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
            Text(value).font(.inter(13)).foregroundStyle(Brand.ink)
        }
    }

    @ViewBuilder
    private func details(_ missing: Int) -> some View {
        if missing == 0 {
            Label(l.t("admin.complete"), systemImage: "checkmark.circle.fill").font(.inter(13, .semibold)).foregroundStyle(Brand.success)
        } else {
            Label(l.t(missing == 1 ? "admin.incomplete" : "admin.incompletePlural", ["count": "\(missing)"]), systemImage: "exclamationmark.circle.fill")
                .font(.inter(13, .semibold)).foregroundStyle(Brand.accentInk)
        }
    }

    private func load() async {
        do {
            let term = search.trimmingCharacters(in: .whitespaces)
            list = try await app.services.api.call(API.storeList, .init(page: page, query: term.isEmpty ? nil : term, status: filter == "all" ? nil : filter))
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, list == nil { failed = failure }
        }
    }
}

// MARK: - Opening a store

/// Opening a store — the web's `/admin/vendors/new`: the store, its first
/// login and its terms in one call, so a store is never left that nobody can
/// sign in to. The owner is optional; a store recorded today whose owner
/// arrives next week is a real case.
struct PortalNewStoreView: View {
    @State private var name = ""
    @State private var nameAr = ""
    @State private var slug = ""
    @State private var slugTouched = false
    @State private var logoUrl = ""
    @State private var contactEmail = ""
    @State private var contactPhone = ""
    @State private var governorate: String?
    @State private var addressLine = ""
    @State private var licenceNumber = ""
    @State private var payoutIban = ""
    @State private var description = ""
    @State private var descriptionAr = ""
    @State private var ownerName = ""
    @State private var ownerEmail = ""
    @State private var ownerPassword = ""
    @State private var ownerRole = "owner"
    @State private var status = "approved"
    @State private var commissionPercent: String
    @State private var commissionFixed = ""
    @State private var autoPublish = false
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    init() {
        _commissionPercent = State(initialValue: SiteContent.shared?.selling.defaultCommission ?? "10")
    }

    private var shownSlug: String { slugTouched ? slug : StoreRules.slug(name) }
    private var phoneProblem: String? {
        contactPhone.trimmingCharacters(in: .whitespaces).isEmpty || StoreRules.isValidKuwaitPhone(contactPhone) ? nil : l.t("admin.invalidPhone")
    }
    private var ibanProblem: String? {
        payoutIban.trimmingCharacters(in: .whitespaces).isEmpty || StoreRules.isValidIban(payoutIban) ? nil : l.t("admin.invalidIban")
    }

    /// "Saved as KW75NBOK…" when the bank code was typed with a 0 or a 1.
    private func ibanRead(_ raw: String) -> String? {
        guard StoreRules.isValidIban(raw), let read = StoreRules.ibanReadAs(raw) else { return nil }
        return l.t("admin.ibanReadAs", ["iban": read])
    }
    private var wantsOwner: Bool { !ownerEmail.trimmingCharacters(in: .whitespaces).isEmpty || !ownerPassword.isEmpty }
    private var ready: Bool {
        let ownerReady = !wantsOwner || (!ownerEmail.trimmingCharacters(in: .whitespaces).isEmpty && ownerPassword.count >= ReferenceData.shared.rules.passwordFloor)
        return !name.trimmingCharacters(in: .whitespaces).isEmpty && !shownSlug.isEmpty && ownerReady && phoneProblem == nil && ibanProblem == nil
    }

    var body: some View {
        PortalScreen(title: l.t("admin.openStoreButton"), intro: l.t("admin.newStoreIntro")) {
            step(1, "admin.storeDetails") {
                LabeledField(label: l.t("admin.storeName"), text: $name)
                LabeledField(label: l.t("admin.storeNameAr"), text: $nameAr)
                LabeledField(label: l.t("admin.storeSlug"), text: Binding(get: { shownSlug }, set: { slugTouched = true; slug = $0 }),
                             hint: l.t("admin.storeSlugHint"), keyboard: .asciiCapable, leftToRight: true)
                LabeledField(label: l.t("admin.logoUrl"), text: $logoUrl, placeholder: "https://", keyboard: .URL, leftToRight: true)
                LabeledField(label: l.t("admin.contactEmail"), text: $contactEmail, keyboard: .emailAddress, content: .emailAddress, leftToRight: true)
                LabeledField(label: l.t("admin.contactPhone"), text: $contactPhone, problem: phoneProblem, keyboard: .phonePad, content: .telephoneNumber, leftToRight: true)
                ChoiceField(label: l.t("admin.governorate"), current: governorate ?? "", placeholder: l.t("admin.notSet"), options: governorates) { governorate = $0 }
                LabeledField(label: l.t("admin.addressLine"), text: $addressLine)
                LabeledField(label: l.t("admin.licenceNumber"), text: $licenceNumber, leftToRight: true)
                LabeledField(label: l.t("admin.payoutIban"), text: $payoutIban, hint: ibanRead(payoutIban), problem: ibanProblem, keyboard: .asciiCapable, leftToRight: true)
                LabeledField(label: l.t("admin.storeDescription"), text: $description, axis: .vertical)
                LabeledField(label: l.t("admin.storeDescriptionAr"), text: $descriptionAr, axis: .vertical)
            }
            step(2, "admin.ownerAccount", note: "admin.ownerAccountNote") {
                LabeledField(label: l.t("admin.ownerName"), text: $ownerName, content: .name)
                ChoiceField(label: l.t("admin.ownerRole"), current: ownerRole, placeholder: l.t("admin.ownerRole"), options: roles) { ownerRole = $0 ?? "owner" }
                LabeledField(label: l.t("admin.ownerEmail"), text: $ownerEmail, keyboard: .emailAddress, content: .emailAddress, leftToRight: true)
                LabeledField(label: l.t("admin.ownerPassword"), text: $ownerPassword, hint: l.t("admin.ownerPasswordHint"), content: .newPassword, secure: true, leftToRight: true)
            }
            step(3, "admin.commercialTerms") {
                ChoiceField(label: l.t("admin.vendorStatus"), hint: l.t("admin.statusHint"), current: status, placeholder: l.t("admin.vendorStatus"),
                            options: StoreRules.statuses.map { ($0, l.t(StoreRules.statusKey($0))) }) { status = $0 ?? "approved" }
                Toggle(isOn: $autoPublish) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(l.t("admin.autoPublishLabel")).font(.inter(14, .semibold)).foregroundStyle(Brand.ink)
                        Text(l.t("admin.autoPublishHint")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .tint(Brand.navy)
                LabeledField(label: l.t("admin.commissionPercent"), text: $commissionPercent, hint: l.t("admin.commissionPercentHint"), keyboard: .decimalPad, leftToRight: true)
                LabeledField(label: l.t("admin.commissionFixed"), text: $commissionFixed, placeholder: "0.000", keyboard: .decimalPad, leftToRight: true)
            }
            Button {
                Task { await create() }
            } label: {
                HStack(spacing: 8) {
                    if busy { ProgressView().tint(.white) } else { Image(systemName: "storefront") }
                    Text(l.t("admin.createStore"))
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!ready || busy)
        }
    }

    private var governorates: [(String, String)] {
        [("", l.t("admin.notSet"))] + ReferenceData.shared.governorates.map { ($0.id, $0.name(l.current)) }
    }

    private var roles: [(String, String)] {
        ["owner", "manager", "staff"].map { ($0, l.t(TeamWords.role($0))) }
    }

    private func step<Content: View>(_ number: Int, _ title: String, note: String? = nil, @ViewBuilder _ content: @escaping () -> Content) -> some View {
        PortalCard {
            HStack(spacing: 8) {
                Text("\(number)").font(.inter(13, .bold)).foregroundStyle(.white).frame(width: 24, height: 24).background(Circle().fill(Brand.navy))
                Text(l.t(title)).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            }
            if let note { Text(l.t(note)).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true) }
            content()
        }
    }

    private func create() async {
        busy = true
        defer { busy = false }
        func blank(_ value: String) -> String? {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        let defaultRate = SiteContent.shared?.selling.defaultCommission ?? "10"
        let request = API.NewStore(
            name: name.trimmingCharacters(in: .whitespaces),
            slug: shownSlug,
            status: status,
            commissionPercent: blank(PhoneNumber.foldDigits(commissionPercent)) ?? defaultRate,
            commissionFixed: blank(PhoneNumber.foldDigits(commissionFixed)),
            autoPublish: autoPublish,
            nameAr: blank(nameAr),
            contactEmail: blank(contactEmail),
            contactPhone: blank(contactPhone),
            governorate: governorate,
            addressLine: blank(addressLine),
            licenceNumber: blank(licenceNumber),
            payoutIban: blank(payoutIban),
            description: blank(description),
            descriptionAr: blank(descriptionAr),
            logoUrl: blank(logoUrl),
            owner: wantsOwner ? .init(email: ownerEmail.trimmingCharacters(in: .whitespaces), password: ownerPassword, name: blank(ownerName), role: ownerRole) : nil
        )
        var created: CreatedStore?
        guard await app.attempt(fallback: "admin.saveFailed", {
            created = try await app.services.api.call(API.createStore, request)
        }), let created else { return }
        app.toast(l.t("admin.storeOpened"))
        app.replace(with: .portal("/admin/vendors/\(created.vendor.id)"))
    }
}

// MARK: - One store

/// The boxes of a store's page, filled once from the server, so saving one
/// section never puts back what somebody was typing in another.
private struct StoreDraft {
    var name = ""
    var nameAr = ""
    var logoUrl = ""
    var description = ""
    var descriptionAr = ""
    var contactEmail = ""
    var contactPhone = ""
    var governorate: String?
    var addressLine = ""
    var licenceNumber = ""
    var underPlatformLicence = false
    var discountLicenceNumber = ""
    var expires: Date?
    var deliverySpeed: String?
    var deliveryFlat = ""
    var deliveryFreeOver = ""
    var deliveryProvider = ""
    var fastDeliveryFee = ""
    var fastDeliverySpeed: String?
    var ownDelivery = false
    var deliveryCourierId: Int?
    var acceptsCod = true
    var codCeiling = ""
    var subscriptionPercent = ""
    var payoutIban = ""
    var percent = ""
    var fixed = ""

    init() {}

    init(_ store: StoreDetail) {
        name = store.name
        nameAr = store.nameAr ?? ""
        logoUrl = store.logoUrl ?? ""
        description = store.description ?? ""
        descriptionAr = store.descriptionAr ?? ""
        contactEmail = store.contactEmail ?? ""
        contactPhone = store.contactPhone ?? ""
        governorate = store.governorate
        addressLine = store.addressLine ?? ""
        licenceNumber = store.licenceNumber ?? ""
        underPlatformLicence = store.underPlatformLicence ?? false
        discountLicenceNumber = store.discountLicenceNumber ?? ""
        expires = store.discountLicenceExpiresAt
        deliverySpeed = store.deliverySpeed
        deliveryFlat = store.deliveryFlat ?? ""
        deliveryFreeOver = store.deliveryFreeOver ?? ""
        deliveryProvider = store.deliveryProvider ?? ""
        fastDeliveryFee = store.fastDeliveryFee ?? ""
        fastDeliverySpeed = store.fastDeliverySpeed
        ownDelivery = store.deliveryMode == "own"
        deliveryCourierId = store.deliveryCourierId
        acceptsCod = store.acceptsCod ?? true
        codCeiling = store.codCeiling ?? ""
        subscriptionPercent = store.subscriptionPercent ?? ""
        payoutIban = store.payoutIban ?? ""
        percent = store.commissionPercent
        fixed = store.commissionFixed ?? ""
    }
}

/// One store — the web's `/admin/vendors/:id`: its figures, what it still
/// lacks, and eight sections that each save only their own fields, so fixing
/// a phone number never rewrites the payout account on the way past. Status,
/// publishing without review and the badge save as they change.
struct PortalStoreView: View {
    let vendorId: Int
    @State private var store: StoreDetail?
    @State private var failed: APIError?
    @State private var draft = StoreDraft()
    @State private var saving: String?
    /// The delivery companies on NetLet, for a store that uses its own (3.3.13).
    @State private var companies: [DeliveryCompany] = []
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: store?.name ?? l.t("admin.vendors"), refresh: { await load() }) {
            if let store {
                header(store)
                stats(store)
                if !store.missing.isEmpty {
                    PortalNotice(text: l.t("admin.missingList", ["fields": store.missing.map { l.t($0) }.joined(separator: l.current == .ar ? "، " : ", ")]), tone: .warning)
                }
                profile(store)
                contact
                licences(store)
                delivery
                payments
                terms(store)
                badges(store)
                StoreWarningsCard(vendorId: vendorId, storeName: store.name, manage: true)
                StoreTeamSection(vendorId: vendorId) { await load() }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task {
            await load()
            companies = (try? await app.services.api.call(API.deliveryCompanies)) ?? []
        }
    }

    // MARK: Header and figures

    private func header(_ store: StoreDetail) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                StoreAvatar(name: store.name, logoUrl: store.logoUrl, size: 56)
                VStack(alignment: .leading, spacing: 4) {
                    FlowLayout(spacing: 6) {
                        StatusPill(label: l.t(StoreRules.statusKey(store.status)), tone: .portal(StoreRules.statusTone(store.status)))
                        if store.autoPublish { StatusPill(label: l.t("admin.autoPublish"), tone: .shipped) }
                    }
                    Text(latin("/\(store.slug)")).font(.inter(12)).foregroundStyle(Brand.muted)
                }
            }
            HStack(spacing: 8) {
                Button { app.open(.portal("/admin/products?vendor=\(vendorId)")) } label: { Label(l.t("admin.viewStoreProducts"), systemImage: "square.grid.2x2") }
                    .buttonStyle(PortalSmallButtonStyle())
                Button { app.open(.portal("/admin/products/new?vendor=\(vendorId)")) } label: { Label(l.t("admin.addProductToStore"), systemImage: "plus.square") }
                    .buttonStyle(PortalSmallButtonStyle(kind: .primary))
            }
        }
    }

    private func stats(_ store: StoreDetail) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            StoreStat(label: l.t("admin.statProducts"), value: "\(store.stats.products)", note: l.t("admin.statLive", ["count": "\(store.stats.live)"])) {
                app.open(.portal("/admin/products?vendor=\(vendorId)"))
            }
            StoreStat(label: l.t("admin.statInReview"), value: "\(store.stats.inReview)", note: l.t("admin.statDrafts", ["count": "\(store.stats.drafts)"]),
                      open: store.stats.inReview > 0 ? { app.open(.portal("/admin/review")) } : nil)
            StoreStat(label: l.t("admin.statTeam"), value: "\(store.stats.members)")
            StoreStat(label: l.t("admin.statCommission"), value: rateText(store.commissionPercent),
                      note: store.commissionFixed.flatMap { Money(amount: $0) }.flatMap { $0.fils > 0 ? l.t("admin.statCommissionFixed", ["amount": $0.formatted(l.current)]) : nil })
        }
    }

    // MARK: Sections

    private func section<Content: View>(_ title: String, note: String? = nil, key: String, disabled: Bool = false,
                                        save: (() -> Void)? = nil, @ViewBuilder _ content: @escaping () -> Content) -> some View {
        PortalCard {
            Text(l.t(title)).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            if let note { Text(l.t(note)).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true) }
            content()
            if let save {
                HStack {
                    Spacer()
                    SectionSave(pending: saving == key, disabled: disabled || (saving != nil && saving != key), action: save)
                }
            }
        }
    }

    private func profile(_ store: StoreDetail) -> some View {
        section("admin.sectionProfile", note: "admin.sectionProfileNote", key: "profile",
                disabled: draft.name.trimmingCharacters(in: .whitespaces).isEmpty, save: {
            save("profile", .init(vendorId: vendorId, name: draft.name.trimmingCharacters(in: .whitespaces), nameAr: .text(draft.nameAr),
                                  logoUrl: .text(draft.logoUrl), description: .text(draft.description), descriptionAr: .text(draft.descriptionAr)))
        }) {
            LabeledField(label: l.t("admin.storeName"), text: $draft.name)
            LabeledField(label: l.t("admin.storeNameAr"), text: $draft.nameAr)
            HStack(alignment: .bottom, spacing: 10) {
                LabeledField(label: l.t("admin.logoUrl"), text: $draft.logoUrl, placeholder: "https://", keyboard: .URL, leftToRight: true)
                StoreAvatar(name: draft.name.isEmpty ? store.name : draft.name, logoUrl: draft.logoUrl.trimmingCharacters(in: .whitespaces))
                    .padding(.bottom, 2)
                    .accessibilityElement()
                    .accessibilityLabel(l.t("admin.logoPreview"))
            }
            LabeledField(label: l.t("admin.storeDescription"), text: $draft.description, axis: .vertical)
            LabeledField(label: l.t("admin.storeDescriptionAr"), text: $draft.descriptionAr, axis: .vertical)
        }
    }

    private var phoneProblem: String? {
        draft.contactPhone.trimmingCharacters(in: .whitespaces).isEmpty || StoreRules.isValidKuwaitPhone(draft.contactPhone) ? nil : l.t("admin.invalidPhone")
    }

    private var ibanProblem: String? {
        draft.payoutIban.trimmingCharacters(in: .whitespaces).isEmpty || StoreRules.isValidIban(draft.payoutIban) ? nil : l.t("admin.invalidIban")
    }

    /// "Saved as KW75NBOK…" when the bank code was typed with a 0 or a 1.
    private func ibanRead(_ raw: String) -> String? {
        guard StoreRules.isValidIban(raw), let read = StoreRules.ibanReadAs(raw) else { return nil }
        return l.t("admin.ibanReadAs", ["iban": read])
    }

    private var contact: some View {
        section("admin.sectionContact", note: "admin.sectionContactNote", key: "contact", disabled: phoneProblem != nil, save: {
            save("contact", .init(vendorId: vendorId, contactEmail: .text(draft.contactEmail), contactPhone: .text(draft.contactPhone),
                                  governorate: OrNull(draft.governorate), addressLine: .text(draft.addressLine)))
        }) {
            LabeledField(label: l.t("admin.contactEmail"), text: $draft.contactEmail, keyboard: .emailAddress, content: .emailAddress, leftToRight: true)
            LabeledField(label: l.t("admin.contactPhone"), text: $draft.contactPhone, problem: phoneProblem, keyboard: .phonePad, content: .telephoneNumber, leftToRight: true)
            ChoiceField(label: l.t("admin.governorate"), current: draft.governorate ?? "", placeholder: l.t("admin.notSet"),
                        options: [("", l.t("admin.notSet"))] + ReferenceData.shared.governorates.map { ($0.id, $0.name(l.current)) }) { draft.governorate = $0 }
            LabeledField(label: l.t("admin.addressLine"), text: $draft.addressLine)
        }
    }

    private func licences(_ store: StoreDetail) -> some View {
        section("admin.sectionLicences", note: "admin.discountLicenceHint", key: "licences", save: {
            save("licences", .init(vendorId: vendorId, licenceNumber: .text(draft.licenceNumber), underPlatformLicence: draft.underPlatformLicence,
                                   discountLicenceNumber: .text(draft.discountLicenceNumber),
                                   discountLicenceExpiresAt: OrNull(draft.expires.map(StoreRules.kuwaitDay))))
        }) {
            permitLine(store)
            LabeledField(label: l.t("admin.licenceNumber"), text: $draft.licenceNumber, leftToRight: true)
            toggle("admin.underPlatformLicence", hint: "admin.underPlatformLicenceHint", isOn: $draft.underPlatformLicence)
            LabeledField(label: l.t("admin.discountLicence"), text: $draft.discountLicenceNumber, leftToRight: true)
            Toggle(l.t("admin.discountLicenceExpires"), isOn: Binding(get: { draft.expires != nil }, set: { draft.expires = $0 ? (draft.expires ?? Date()) : nil }))
                .font(.inter(14, .semibold))
                .tint(Brand.navy)
            if let expires = draft.expires {
                DatePicker(l.t("admin.discountLicenceExpires"), selection: Binding(get: { expires }, set: { draft.expires = $0 }), displayedComponents: .date)
                    .labelsHidden()
            }
        }
    }

    /// The permit's state in words, because two boxes and a date are a sum
    /// somebody had to do.
    private func permitLine(_ store: StoreDetail) -> some View {
        let state = StoreRules.permit(number: store.discountLicenceNumber, expiresAt: store.discountLicenceExpiresAt)
        let text: String
        let tone: PortalNotice.Tone
        switch state {
        case .valid(let date): text = l.t("admin.permitValid", ["date": OrderWording.date(date, language: l.current)]); tone = .success
        case .noExpiry: text = l.t("admin.permitNoExpiry"); tone = .success
        case .expired(let date): text = l.t("admin.permitExpired", ["date": OrderWording.date(date, language: l.current)]); tone = .danger
        case .missing: text = l.t("admin.permitMissing"); tone = .info
        }
        return VStack(alignment: .leading, spacing: 4) {
            Text(l.t("admin.permitState")).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
            PortalNotice(text: text, tone: tone)
        }
    }

    private var delivery: some View {
        section("admin.sectionDelivery", note: "admin.sectionDeliveryNote", key: "delivery", save: {
            save("delivery", .init(vendorId: vendorId, deliverySpeed: OrNull(draft.deliverySpeed), deliveryFlat: .text(PhoneNumber.foldDigits(draft.deliveryFlat)),
                                   deliveryFreeOver: .text(PhoneNumber.foldDigits(draft.deliveryFreeOver)), deliveryProvider: .text(draft.deliveryProvider),
                                   fastDeliveryFee: .text(PhoneNumber.foldDigits(draft.fastDeliveryFee)), fastDeliverySpeed: OrNull(draft.fastDeliverySpeed),
                                   deliveryMode: draft.ownDelivery ? "own" : "netlet",
                                   deliveryCourierId: OrNull(draft.ownDelivery ? draft.deliveryCourierId : nil)))
        }) {
            ChoiceField(label: l.t("admin.fieldDeliverySpeed"), current: draft.deliverySpeed ?? "", placeholder: l.t("admin.speedUnset"),
                        options: [("", l.t("admin.speedUnset"))] + ListingRules.shared.deliverySpeeds.map { ($0, l.t(ShippingWords.speed($0))) }) { draft.deliverySpeed = $0 }
            LabeledField(label: l.t("admin.fieldDeliveryFlat"), text: $draft.deliveryFlat, placeholder: "0.000", hint: l.t("admin.fieldDeliveryFlatHint"), keyboard: .decimalPad, leftToRight: true)
            LabeledField(label: l.t("admin.fieldDeliveryFreeOver"), text: $draft.deliveryFreeOver, placeholder: "0.000", hint: l.t("admin.fieldDeliveryFreeOverHint"), keyboard: .decimalPad, leftToRight: true)
            LabeledField(label: l.t("admin.fieldDeliveryProvider"), text: $draft.deliveryProvider, hint: l.t("admin.fieldDeliveryProviderHint"))
            /* The fast trip (3.2.5): a fee of its own, charged per fast parcel,
               and the band it promises. Blank is no fast option. */
            LabeledField(label: l.t("admin.fieldFastFee"), text: $draft.fastDeliveryFee, placeholder: "0.000", hint: l.t("admin.fieldFastFeeHint"), keyboard: .decimalPad, leftToRight: true)
            ChoiceField(label: l.t("admin.fieldFastSpeed"), current: draft.fastDeliverySpeed ?? "", placeholder: l.t("admin.speedUnset"),
                        options: [("", l.t("admin.speedUnset"))] + ListingRules.shared.deliverySpeeds.filter { $0 != "made_to_order" }.map { ($0, l.t(ShippingWords.speed($0))) }) { draft.fastDeliverySpeed = $0 }
            // Who carries this store's parcels (3.3.13).
            Divider()
            Text(l.t("admin.deliveryModeTitle")).font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
            ForEach([false, true], id: \.self) { own in
                Button { draft.ownDelivery = own } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: draft.ownDelivery == own ? "largecircle.fill.circle" : "circle")
                            .foregroundStyle(Brand.navy)
                            .padding(.top, 2)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(l.t(own ? "admin.deliveryModeOwn" : "admin.deliveryModeNetlet")).font(.inter(14, .semibold)).foregroundStyle(Brand.navy)
                            Text(l.t(own ? "admin.deliveryModeOwnNote" : "admin.deliveryModeNetletNote")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.tap)
                .accessibilityAddTraits(draft.ownDelivery == own ? .isSelected : [])
            }
            if draft.ownDelivery {
                let choices = companies.filter { $0.status == "active" || $0.id == draft.deliveryCourierId }
                ChoiceField(label: l.t("admin.deliveryCourier"), hint: l.t("admin.deliveryCourierHint"),
                            current: draft.deliveryCourierId.map(String.init) ?? "", placeholder: l.t("admin.deliveryCourierNone"),
                            options: [("", l.t("admin.deliveryCourierNone"))] + choices.map { (String($0.id), l.current == .ar ? ($0.nameAr ?? $0.name) : $0.name) }) { chosen in
                    draft.deliveryCourierId = chosen.flatMap(Int.init)
                }
            }
        }
    }

    private var payments: some View {
        section("admin.sectionPayments", note: "admin.sectionPaymentsNote", key: "payments", disabled: ibanProblem != nil, save: {
            save("payments", .init(vendorId: vendorId, acceptsCod: draft.acceptsCod, codCeiling: .text(PhoneNumber.foldDigits(draft.codCeiling)),
                                   subscriptionPercent: .text(PhoneNumber.foldDigits(draft.subscriptionPercent)), payoutIban: .text(draft.payoutIban)))
        }) {
            toggle("admin.acceptsCod", hint: "admin.acceptsCodHint", isOn: $draft.acceptsCod)
            LabeledField(label: l.t("admin.codCeiling"), text: $draft.codCeiling, placeholder: "0.000", keyboard: .decimalPad, leftToRight: true)
                .disabled(!draft.acceptsCod)
            LabeledField(label: l.t("admin.subscriptionPercent"), text: $draft.subscriptionPercent, hint: l.t("admin.subscriptionPercentHint"), keyboard: .decimalPad, leftToRight: true)
            LabeledField(label: l.t("admin.payoutIban"), text: $draft.payoutIban, hint: ibanRead(draft.payoutIban), problem: ibanProblem, keyboard: .asciiCapable, leftToRight: true)
        }
    }

    private func terms(_ store: StoreDetail) -> some View {
        section("admin.commercialTerms", note: "admin.sectionTermsNote", key: "terms", save: {
            Task { await saveTerms() }
        }) {
            ChoiceField(label: l.t("admin.vendorStatus"), hint: l.t("admin.statusHint"), current: store.status, placeholder: l.t("admin.vendorStatus"),
                        options: StoreRules.statuses.map { ($0, l.t(StoreRules.statusKey($0))) }, enabled: saving == nil) { chosen in
                guard let chosen, chosen != store.status else { return }
                Task { await act("status") { try await $0.call(API.setStoreStatus, .init(vendorId: vendorId, status: chosen)) } }
            }
            toggle("admin.autoPublishLabel", hint: "admin.autoPublishHint", isOn: Binding(get: { store.autoPublish }, set: { on in
                Task { await act("autoPublish") { try await $0.call(API.setStoreAutoPublish, .init(vendorId: vendorId, autoPublish: on)) } }
            }))
            .disabled(saving != nil)
            LabeledField(label: l.t("admin.commissionPercent"), text: $draft.percent, hint: l.t("admin.commissionPercentHint"), keyboard: .decimalPad, leftToRight: true)
            LabeledField(label: l.t("admin.commissionFixed"), text: $draft.fixed, placeholder: "0.000", keyboard: .decimalPad, leftToRight: true)
        }
    }

    private func badges(_ store: StoreDetail) -> some View {
        let rules = PortalRules.shared.badges
        let held = store.awarded
        return section("admin.badges", key: "badges") {
            if let rules {
                Text(l.t("admin.badgesEarned", [
                    "rating": rules.highRatingFloor == rules.highRatingFloor.rounded() ? "\(Int(rules.highRatingFloor))" : "\(rules.highRatingFloor)",
                    "reviews": "\(rules.highRatingMinReviews)", "share": "\(Int((rules.fastShare * 100).rounded()))",
                    "hours": "\(rules.fastHours)", "days": "\(rules.fastWindowDays)", "deliveries": "\(rules.fastMinDeliveries)",
                ]))
                .font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            }
            FlowLayout(spacing: 8) {
                ForEach(rules?.awarded ?? ["verified"], id: \.self) { badge in
                    let on = held.contains(badge)
                    Button {
                        let next = on ? held.filter { $0 != badge } : held + [badge]
                        Task { await act("badges") { try await $0.call(API.setStoreBadges, .init(vendorId: vendorId, badges: next)) } }
                    } label: {
                        Label(l.t(StoreRules.badgeKey(badge)), systemImage: on ? "checkmark.seal.fill" : "seal")
                    }
                    .buttonStyle(PortalSmallButtonStyle(kind: on ? .primary : .secondary))
                    .disabled(saving != nil)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
        }
    }

    private func toggle(_ label: String, hint: String, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(l.t(label)).font(.inter(14, .semibold)).foregroundStyle(Brand.ink)
                Text(l.t(hint)).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(Brand.navy)
    }

    // MARK: Saving

    private func load() async {
        do {
            let answer = try await app.services.api.call(API.storeDetail, .init(vendorId: vendorId))
            if store == nil { draft = StoreDraft(answer) }
            store = answer
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, store == nil { failed = failure }
        }
    }

    private func save(_ key: String, _ patch: API.StorePatch) {
        Task { await act(key) { try await $0.call(API.updateStore, patch) } }
    }

    private func saveTerms() async {
        let percent = PhoneNumber.foldDigits(draft.percent).trimmingCharacters(in: .whitespaces)
        let fixed = OrNull<String>.text(PhoneNumber.foldDigits(draft.fixed))
        await act("terms") { try await $0.call(API.setStoreCommission, .init(vendorId: vendorId, percent: percent, fixed: fixed)) }
    }

    private func act(_ key: String, _ work: @escaping (APICalling) async throws -> Acknowledged) async {
        saving = key
        defer { saving = nil }
        let api = app.services.api
        if await app.attempt(done: "admin.saved", fallback: "admin.saveFailed", { _ = try await work(api) }) {
            await load()
        }
    }
}

/// A figure on a store's page, with a line under it and somewhere to go.
private struct StoreStat: View {
    let label: String
    let value: String
    var note: String?
    var open: (() -> Void)?

    var body: some View {
        let face = VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
            Text(value).font(.inter(20, .heavy)).foregroundStyle(Brand.navy).lineLimit(1).minimumScaleFactor(0.7)
            if let note { Text(note).font(.inter(12)).foregroundStyle(Brand.body).lineLimit(2) }
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 86, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        if let open {
            Button(action: open) { face }.buttonStyle(PressFillStyle(cornerRadius: 12))
        } else {
            face
        }
    }
}

// MARK: - A store's team

/// Who can sign in to the store, for an administrator: a rank each, a reset
/// link sent from here, taking somebody out (asking first), a new login made
/// for somebody who has never visited, or an existing account added by its
/// address — the roles spelled out, not only named.
private struct StoreTeamSection: View {
    let vendorId: Int
    let changed: () async -> Void
    @State private var members: [StoreMember]?
    @State private var removing: StoreMember?
    @State private var busy = false
    @State private var newName = ""
    @State private var newEmail = ""
    @State private var newPassword = ""
    @State private var newRole = "manager"
    @State private var existingEmail = ""
    @State private var existingRole = "manager"
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalCard {
            Text(l.t("admin.storeTeam")).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t("admin.storeTeamNote")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            if let members {
                if members.isEmpty {
                    Text(l.t("admin.noStoreMembers")).font(.inter(13)).foregroundStyle(Brand.body)
                } else {
                    ForEach(members) { member in row(member) }
                }
            } else {
                ProgressView().tint(Brand.navy)
            }
            Divider()
            Text(l.t("admin.createLogin")).font(.inter(14, .bold)).foregroundStyle(Brand.ink)
            LabeledField(label: l.t("admin.ownerName"), text: $newName, content: .name)
            LabeledField(label: l.t("admin.emailAddress"), text: $newEmail, keyboard: .emailAddress, content: .emailAddress, leftToRight: true)
            LabeledField(label: l.t("admin.ownerPassword"), text: $newPassword, hint: l.t("admin.ownerPasswordHint"), content: .newPassword, secure: true, leftToRight: true)
            ChoiceField(label: l.t("admin.memberRole"), current: newRole, placeholder: l.t("admin.memberRole"), options: roleOptions) { newRole = $0 ?? "manager" }
            Button { Task { await createLogin() } } label: { Label(l.t("admin.createLogin"), systemImage: "person.badge.plus") }
                .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                .disabled(busy || newEmail.trimmingCharacters(in: .whitespaces).isEmpty || newPassword.count < ReferenceData.shared.rules.passwordFloor)
            Divider()
            Text(l.t("admin.addExisting")).font(.inter(14, .bold)).foregroundStyle(Brand.ink)
            LabeledField(label: l.t("admin.emailAddress"), text: $existingEmail, keyboard: .emailAddress, content: .emailAddress, leftToRight: true)
            ChoiceField(label: l.t("admin.memberRole"), current: existingRole, placeholder: l.t("admin.memberRole"), options: roleOptions) { existingRole = $0 ?? "manager" }
            Button { Task { await addExisting() } } label: { Label(l.t("admin.addMember"), systemImage: "person.badge.plus") }
                .buttonStyle(PortalSmallButtonStyle())
                .disabled(busy || existingEmail.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .task { await load() }
        .confirmationDialog(removing.map { l.t("admin.removeMemberTitle", ["name": $0.email]) } ?? "",
                            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button(l.t("admin.removeMember"), role: .destructive) {
                if let member = removing { Task { await remove(member) } }
            }
            Button(l.t("common.cancel"), role: .cancel) { removing = nil }
        } message: {
            Text(l.t("admin.removeMemberBody"))
        }
    }

    private var roleOptions: [(String, String)] {
        ["staff", "manager", "owner"].map { ($0, "\(l.t(TeamWords.role($0))) — \(l.t(StoreRules.roleWhat($0)))") }
    }

    private func row(_ member: StoreMember) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(latin(member.email)).font(.inter(14, .semibold)).foregroundStyle(Brand.ink).lineLimit(1).truncationMode(.middle)
            Text(l.t(StoreRules.roleWhat(member.role))).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            ChoiceField(label: l.t("admin.memberRole"), current: member.role, placeholder: l.t("admin.memberRole"),
                        options: ["staff", "manager", "owner"].map { ($0, l.t(TeamWords.role($0))) }, enabled: !busy) { role in
                guard let role, role != member.role else { return }
                Task { await act(done: "admin.saved") { try await $0.call(API.setMemberRole, .init(vendorId: vendorId, userId: member.userId, role: role)) } }
            }
            FlowLayout(spacing: 8) {
                Button { Task { await sendReset(member) } } label: { Label(l.t("admin.sendReset"), systemImage: "key") }
                    .buttonStyle(PortalSmallButtonStyle())
                Button { removing = member } label: { Label(l.t("admin.removeMember"), systemImage: "trash") }
                    .buttonStyle(PortalSmallButtonStyle(kind: .danger))
            }
            .disabled(busy)
            Divider()
        }
    }

    private func load() async {
        members = (try? await app.services.api.call(API.storeMembers, .init(vendorId: vendorId))) ?? members ?? []
    }

    @discardableResult
    private func act(done: String, _ work: @escaping (APICalling) async throws -> Acknowledged) async -> Bool {
        busy = true
        defer { busy = false }
        let api = app.services.api
        let ok = await app.attempt(done: done, fallback: "admin.forbidden") { _ = try await work(api) }
        if ok {
            await load()
            await changed()
        }
        return ok
    }

    private func remove(_ member: StoreMember) async {
        removing = nil
        _ = await act(done: "admin.saved") { try await $0.call(API.removeMember, .init(vendorId: vendorId, userId: member.userId)) }
    }

    private func createLogin() async {
        let name = newName.trimmingCharacters(in: .whitespaces)
        let request = API.NewLogin(vendorId: vendorId, email: newEmail.trimmingCharacters(in: .whitespaces), password: newPassword,
                                   name: name.isEmpty ? nil : name, role: newRole)
        if await act(done: "admin.loginCreated", { try await $0.call(API.addNewMember, request) }) {
            newName = ""
            newEmail = ""
            newPassword = ""
            newRole = "manager"
        }
    }

    private func addExisting() async {
        let request = API.AddByEmail(vendorId: vendorId, email: existingEmail.trimmingCharacters(in: .whitespaces), role: existingRole)
        if await act(done: "admin.memberAdded", { try await $0.call(API.addToVendor, request) }) {
            existingEmail = ""
            existingRole = "manager"
        }
    }

    private func sendReset(_ member: StoreMember) async {
        busy = true
        defer { busy = false }
        var answer: ResetSent?
        guard await app.attempt(fallback: "admin.forbidden", {
            answer = try await app.services.api.call(API.sendMemberReset, .init(userId: member.userId, locale: l.current.rawValue))
        }), let answer else { return }
        app.toast(answer.sent ? l.t("admin.resetSentTo", ["email": answer.email ?? member.email]) : l.t("admin.resetNotConfigured"))
    }
}
