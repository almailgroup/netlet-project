import SwiftUI

/// The heart's question, on the owner's word — the web's `WishChooser`: **a
/// private wishlist or a public one?** Asked whenever a signed-in shopper
/// fills a heart (`AppModel.heart`), so nothing goes on a list anybody else
/// can read without the shopper having chosen that.
///
/// Each choice says in words who will see it, names the list it lands on or
/// says one is made (`wishlists.wish` makes it, under the title here, in the
/// shopper's language), and a public choice with no phone number on the
/// account says the number is what lets family find it by typing.
struct WishSheet: View {
    let product: Product
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss
    @State private var lists: [WishlistSummary]?
    @State private var phone: String??
    @State private var choosing: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(l.t("wish.chooseNote"))
                        .font(.inter(14))
                        .foregroundStyle(Brand.body)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(product.title)
                        .font(.inter(15, .semibold))
                        .foregroundStyle(Brand.navy)
                        .lineLimit(2)
                        .padding(.bottom, 4)
                    option("private")
                    option("public")
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Brand.ground)
            .navigationTitle(l.t("wish.chooseTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(l.t("common.cancel")) { dismiss() }
                }
            }
            .task {
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
                let answer = try await app.saved.wish(product.id, visibility: visibility, title: title)
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
