import SwiftUI

/// The heart's questions, on the owner's word — the web's `WishChooser`.
/// First: **Saved items or a wishlist?** — "wishlists and saved items are a
/// totally different thing": Saved is what somebody keeps to come back to and
/// buy, only theirs; a wishlist is what they would like, private or shared for
/// family to buy from. Then, for a wishlist: **a private one or a public
/// one?**, so nothing goes on a list anybody else can read without the
/// shopper having chosen that. Asked whenever an empty heart is pressed
/// (`AppModel.heart`); the bag's "Move to wishlist" starts at the second
/// question (`WishTarget.start`).
///
/// A guest is asked the first question too: Saved is kept on the phone, and a
/// wishlist needs an account, so choosing one puts this sheet away, opens
/// sign-in, and asks the second question once the session exists
/// (`AppModel.wishAfterSignIn`).
///
/// Each choice says in words who will see it, names the list it lands on or
/// says one is made (`wishlists.wish` makes it, under the title here, in the
/// shopper's language), and a public choice with no phone number on the
/// account says the number is what lets family find it by typing.
///
/// The bag's "Move to wishlist" takes the line out only once the product is on
/// a list (`onWished`).
struct WishSheet: View {
    let target: WishTarget
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss
    @State private var step: WishTarget.Step
    @State private var lists: [WishlistSummary]?
    @State private var phone: String??
    @State private var choosing: String?

    init(target: WishTarget) {
        self.target = target
        _step = State(initialValue: target.start)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(l.t(step == .choose ? "wish.kindNote" : "wish.chooseNote"))
                        .font(.inter(14))
                        .foregroundStyle(Brand.body)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(target.title)
                        .font(.inter(15, .semibold))
                        .foregroundStyle(Brand.navy)
                        .lineLimit(2)
                        .padding(.bottom, 4)
                    if step == .choose {
                        first(saved: true)
                        first(saved: false)
                    } else {
                        option("private")
                        option("public")
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .animation(.smooth(duration: 0.25), value: step)
            }
            .background(Brand.ground)
            .navigationTitle(l.t(step == .choose ? "wish.kindTitle" : "wish.chooseTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if step == .lists && target.start == .choose {
                    ToolbarItem(placement: .topBarLeading) {
                        BarButton(l.t("wish.backToKind")) { step = .choose }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    BarButton(l.t("common.close")) { dismiss() }
                }
            }
            .task(id: step) {
                guard step == .lists, lists == nil, app.session.isSignedIn else { return }
                let api = app.services.api
                async let mine = try? api.call(API.wishlists)
                async let number = try? api.call(API.wishlistPhone)
                lists = await mine ?? []
                phone = .some(await number ?? nil)
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    /// The first question's two answers, each saying in words what it is.
    private func first(saved: Bool) -> some View {
        Button {
            saved ? toSaved() : toWishlist()
        } label: {
            HStack(alignment: .top, spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(saved ? Brand.tint : Brand.accentWash)
                    Image(systemName: saved ? "bookmark" : "gift")
                        .font(.system(size: 19, weight: .medium))
                        .foregroundStyle(saved ? Brand.navy : Brand.accentInk)
                }
                .frame(width: 44, height: 44)
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(l.t(saved ? "wish.savedChoice" : "wish.wishlistChoice"))
                        .font(.inter(16, .bold))
                        .foregroundStyle(Brand.navy)
                    Text(l.t(saved ? "wish.savedChoiceNote" : "wish.wishlistChoiceNote"))
                        .font(.inter(14))
                        .foregroundStyle(Brand.body)
                        .fixedSize(horizontal: false, vertical: true)
                    if !saved && !app.session.isSignedIn {
                        Text(l.t("wish.wishlistSignIn"))
                            .font(.inter(13, .semibold))
                            .foregroundStyle(Brand.accentInk)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 3)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .multilineTextAlignment(.leading)
                if !saved {
                    Image(systemName: "chevron.forward")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Brand.chevron)
                        .padding(.top, 14)
                        .accessibilityHidden(true)
                }
            }
            .padding(16)
            .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(PressFillStyle(cornerRadius: 20, strength: Haptics.actionStrength))
    }

    private func toSaved() {
        let productId = target.productId
        dismiss()
        Task {
            await app.saved.save(productId)
            app.toast(l.t("wish.addedToSaved"))
        }
    }

    private func toWishlist() {
        if app.session.isSignedIn {
            step = .lists
            return
        }
        // Sign-in once this sheet has gone — two sheets at once is one too
        // many — and the second question once the session exists.
        app.wishAfterSignIn = WishTarget(productId: target.productId, title: target.title, start: .lists, onWished: target.onWished)
        dismiss()
        Task {
            try? await Task.sleep(for: .milliseconds(450))
            app.authPresented = true
        }
    }

    /// Asked, and the account has no wishlist number.
    private var phoneMissing: Bool {
        if case .some(.none) = phone { return true }
        return false
    }

    private func option(_ visibility: String) -> some View {
        let isPublic = visibility == "public"
        let existing = lists?.first { list in list.visibility == visibility }
        let fresh = l.t(isPublic ? "wish.defaultPublic" : "wish.defaultPrivate")
        return Button {
            choose(visibility, title: fresh)
        } label: {
            HStack(alignment: .top, spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(isPublic ? Brand.successFill : Brand.tint)
                    if choosing == visibility {
                        ProgressView()
                    } else {
                        Image(systemName: isPublic ? "gift" : "lock")
                            .font(.system(size: 19, weight: .medium))
                            .foregroundStyle(isPublic ? Brand.success : Brand.navy)
                    }
                }
                .frame(width: 44, height: 44)
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(l.t(isPublic ? "wish.publicChoice" : "wish.privateChoice"))
                        .font(.inter(16, .bold))
                        .foregroundStyle(Brand.navy)
                    Text(l.t(isPublic ? "wish.publicChoiceNote" : "wish.privateChoiceNote"))
                        .font(.inter(14))
                        .foregroundStyle(Brand.body)
                        .fixedSize(horizontal: false, vertical: true)
                    if lists != nil {
                        Text(existing.map { list in l.t("wish.goesOn", ["list": "\u{2068}\(list.title)\u{2069}"]) } ?? l.t("wish.makesNew", ["list": fresh]))
                            .font(.inter(13, .semibold))
                            .foregroundStyle(Brand.navy)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 3)
                    }
                    if isPublic && phoneMissing {
                        Text(l.t("wish.publicNoPhone"))
                            .font(.inter(13))
                            .foregroundStyle(Brand.accentInk)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .multilineTextAlignment(.leading)
            }
            .padding(16)
            .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(PressFillStyle(cornerRadius: 20, strength: Haptics.actionStrength))
        .disabled(choosing != nil)
    }

    private func choose(_ visibility: String, title: String) {
        choosing = visibility
        Task {
            do {
                let answer = try await app.saved.wish(target.productId, visibility: visibility, title: title)
                target.onWished?()
                dismiss()
                app.toast(l.t(visibility == "public" ? "wish.addedPublic" : "wish.addedPrivate", ["list": "\u{2068}\(answer.title)\u{2069}"]))
            } catch {
                Haptics.refused()
                choosing = nil
                app.toast(l.t(APIError.from(error).messageKey(knownKey: l.phrasebook.has)))
            }
        }
    }
}

/// What the heart's question is about: a product, by id and name, which
/// question to start at, and what to do once it is on a list.
struct WishTarget: Identifiable {
    enum Step: Hashable { case choose, lists }

    let productId: String
    let title: String
    /// `.lists` goes straight to which wishlist — the bag's "Move to wishlist".
    var start: Step = .choose
    var onWished: (@MainActor () -> Void)? = nil

    var id: String { productId }
}
