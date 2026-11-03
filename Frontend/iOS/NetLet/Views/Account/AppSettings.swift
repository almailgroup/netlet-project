import StoreKit
import SwiftUI

// MARK: - Notification settings

/// What NetLet tells a shopper, in the five groups the web's Preferences draws
/// (`Shared/commerce/noticeCategories.ts`, exported in `rules.json`): each one
/// of the account's four switches, or none when it is always on, with what no
/// switch silences said beside it. On the owner's word: "notification
/// management similar to Amazon … essential security and transactional
/// notifications should remain available".
struct NoticeCategoriesList: View {
    let model: PreferencesModel
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var categories: [Rules.Account.NoticeCategory] { ReferenceData.shared.rules.accountRules.noticeCategories }

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(categories.enumerated()), id: \.element.id) { index, category in
                if index > 0 { Divider() }
                VStack(alignment: .leading, spacing: 6) {
                    if let preference = category.preference {
                        Toggle(isOn: Binding(
                            get: { model.enabled(preference) },
                            set: { on in Task { await app.attempt { try await model.set(preference, enabled: on) } } }
                        )) {
                            words(category)
                        }
                        .tint(Brand.navy)
                        .disabled(model.switching)
                    } else {
                        HStack(alignment: .top, spacing: 12) {
                            words(category)
                            Spacer(minLength: 8)
                            Text(l.t("notify.alwaysOn"))
                                .font(.inter(12, .bold))
                                .foregroundStyle(Brand.success)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 4)
                                .background(Capsule().fill(Brand.successFill))
                        }
                    }
                    if let note = category.alwaysNote {
                        Label {
                            Text(l.t(note)).font(.inter(12)).fixedSize(horizontal: false, vertical: true)
                        } icon: {
                            Image(systemName: "checkmark.shield").font(.system(size: 12, weight: .semibold))
                        }
                        .foregroundStyle(category.preference == nil ? Brand.muted : Brand.success)
                    }
                }
                .padding(.vertical, 12)
            }
        }
    }

    private func words(_ category: Rules.Account.NoticeCategory) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(l.t(category.title)).font(.inter(15, .bold)).foregroundStyle(Brand.ink)
            Text(l.t(category.body)).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Storage

/// What NetLet keeps on this phone, and Clear cache (on the owner's word: "app
/// storage usage display, and clear cache where the operating system
/// permits"): the pictures (`ImagePipeline`'s disk copy), the remembered
/// shelves (`ShelfMemory`) and the system's own URL cache. Clearing them keeps
/// the session, the bag, the language and the browsing history, which are the
/// shopper's and have their own controls.
///
/// Not a main-actor class, so a view can hold it as a `@State` default (Swift 5
/// mode evaluates that off the main actor); what changes it is.
@Observable
final class StorageModel {
    private(set) var bytes: Int?
    private(set) var clearing = false

    @MainActor
    func measure() async {
        let pictures = await ImagePipeline.shared.diskUsage()
        bytes = pictures + ShelfMemory.shared.usage() + URLCache.shared.currentDiskUsage
    }

    @MainActor
    func clear() async {
        clearing = true
        await ImagePipeline.shared.clear()
        ShelfMemory.shared.forget()
        URLCache.shared.removeAllCachedResponses()
        await measure()
        clearing = false
    }

    /// Bytes as a reader says them, the system's own way: "820 KB", "3.4 MB".
    static func size(_ bytes: Int) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        formatter.allowedUnits = [.useKB, .useMB, .useGB]
        return formatter.string(fromByteCount: Int64(bytes))
    }
}

struct StorageCard: View {
    @State private var model = StorageModel()
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let bytes = model.bytes {
                Text(l.t("storage.used", ["size": StorageModel.size(bytes)]))
                    .font(.inter(14, .semibold))
                    .foregroundStyle(Brand.ink)
            } else {
                ProgressView().tint(Brand.navy)
            }
            Button {
                Task {
                    await model.clear()
                    Haptics.succeeded()
                    app.toast(l.t("storage.cleared"))
                }
            } label: {
                HStack(spacing: 8) {
                    if model.clearing { ProgressView().tint(Brand.navy) }
                    Text(l.t(model.clearing ? "storage.clearing" : "storage.clear"))
                }
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(model.clearing)
        }
        .task { await model.measure() }
    }
}

// MARK: - Rate our app

/// "Rate Our App" through the official store (on the owner's word), by the
/// system's own rating window — which iOS shows at most a few times a year
/// and only for an app from the App Store. A TestFlight build says so instead
/// of offering a press that would show nothing.
struct RateAppCard: View {
    @Environment(\.requestReview) private var requestReview
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var onStore: Bool?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if onStore == false {
                Text(l.t("ios.rate.testflight"))
                    .font(.inter(13))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if onStore == true {
                Button {
                    requestReview()
                } label: {
                    Label(l.t("ios.rate.title"), systemImage: "star")
                }
                .buttonStyle(SecondaryButtonStyle())
            }
        }
        .task { onStore = await Self.fromAppStore() }
    }

    /// Whether this copy came from the App Store, not TestFlight or Xcode.
    static func fromAppStore() async -> Bool {
        guard let result = try? await AppTransaction.shared else { return false }
        switch result {
        case .verified(let transaction): return transaction.environment == .production
        case .unverified: return false
        }
    }
}

// MARK: - Browsing history

/// The products this phone opened, newest first (`RecentlyViewed`), read back
/// by id so each shows today's photo and price — on the owner's word, "keep
/// management in the account, less prominent … view, remove individual, clear
/// all". The home page keeps Previously viewed; this is where one comes off,
/// or all of them do, Clear all asking first.
struct BrowsingHistoryView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var products: [Product] = []
    @State private var loaded = false
    @State private var asking = false

    var body: some View {
        ShopPage(header: false) {
            AccountSection(
                title: l.t("history.title"),
                hint: l.t("history.intro", ["days": "\(Int(RecentlyViewed.days))"])
            ) {
                if !loaded {
                    ProgressView().tint(Brand.navy).frame(maxWidth: .infinity)
                } else if products.isEmpty {
                    Text(l.t("history.empty"))
                        .font(.inter(15))
                        .foregroundStyle(Brand.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                        .panel()
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        VStack(spacing: 0) {
                            ForEach(Array(products.enumerated()), id: \.element.id) { index, product in
                                if index > 0 { DashedRule() }
                                row(product)
                            }
                        }
                        .padding(.horizontal, 16)
                        .panel()
                        Button(l.t("history.clearAll")) { asking = true }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                }
            }
        }
        .task(id: l.current) { await load() }
        .alert(l.t("history.clearAsk"), isPresented: $asking) {
            Button(l.t("history.clearAll"), role: .destructive) {
                app.viewed.clear()
                products = []
                app.toast(l.t("history.cleared"))
            }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(l.t("history.clearBody"))
        }
    }

    private func row(_ product: Product) -> some View {
        HStack(spacing: 12) {
            Button {
                app.push(.product(handle: product.handle))
            } label: {
                HStack(spacing: 12) {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color.white)
                        .frame(width: 56, height: 56)
                        .overlay { RemoteImage(reference: product.images.first?.url, label: product.title) }
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(product.title)
                            .font(.inter(14, .bold))
                            .foregroundStyle(Brand.navy)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Text(l.price(product.priceRange.min))
                            .font(.inter(13))
                            .foregroundStyle(Brand.muted)
                    }
                    Spacer(minLength: 0)
                }
            }
            .buttonStyle(.tap)
            Button {
                app.viewed.forget(product.id)
                products.removeAll { $0.id == product.id }
                Haptics.action()
                UIAccessibility.post(notification: .announcement, argument: l.t("history.removed"))
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Brand.muted)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.tap)
            .accessibilityLabel(l.t("history.remove", ["name": product.title]))
        }
        .padding(.vertical, 10)
    }

    private func load() async {
        let wanted = app.viewed.ids
        guard !wanted.isEmpty else {
            products = []
            loaded = true
            return
        }
        let found = (try? await app.services.api.call(API.productsByIds, .init(ids: wanted, locale: l.current.rawValue))) ?? []
        let byId = Dictionary(found.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        products = wanted.compactMap { byId[$0] }
        loaded = true
    }
}

// MARK: - The seller portal's door

/// The seller portal in plain sight on the Profile tab (on the owner's word:
/// "a clearly visible entry … easy switching between the shopping and seller
/// experiences; users who are not sellers go to Become a Seller"): somebody
/// who runs a store is named it and taken to the portal, which has its own
/// way back; anybody else is offered Sell with us. The server decides which.
struct SellerEntryCard: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var storeName: String?

    private var seller: Bool { app.session.seller?.inPortal == true }

    var body: some View {
        Button {
            Haptics.tap()
            app.open(seller ? .portal("/admin") : .sell)
        } label: {
            HStack(spacing: 14) {
                Image(systemName: "storefront")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 48, height: 48)
                    .background(Circle().fill(Brand.tint))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(l.t(seller ? "seller.cardTitle" : "seller.becomeTitle"))
                        .font(.inter(16, .bold))
                        .foregroundStyle(Brand.navy)
                    Text(seller
                         ? l.t("seller.cardBody", ["store": storeName.map { "\u{2068}\($0)\u{2069}" } ?? l.t("account.sellerPlatform")])
                         : l.t("seller.becomeBody"))
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Text(l.t(seller ? "seller.open" : "seller.become"))
                    .font(.inter(13, .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(Brand.navy))
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .panel()
        }
        .buttonStyle(.tap)
        .task(id: app.session.seller?.vendorId) {
            guard app.session.seller?.isStoreMember == true else { return }
            storeName = ((try? await app.services.api.call(API.myStore)) ?? nil)?.name
        }
    }
}
