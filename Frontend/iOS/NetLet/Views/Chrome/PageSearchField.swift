import SwiftUI

/// A page's own search, on the owner's word ("the search bar should only
/// search for what's in the specific page … category, deals, profile and cart
/// page") — the web's `PageSearch.tsx`. On Categories and the Deals page the
/// header's field stops being the shop's search and narrows the page (`ShopPage`'s
/// `pageSearch`); the Profile and Cart tabs, which have no header, draw the
/// same field at their top. Nothing is asked of the server while typing: the
/// page narrows what it already holds, by `SearchRank.textsMatch`, the shop's
/// own folding and stemming.
struct PageSearch {
    var text: Binding<String>
    /// The placeholder's dictionary key, which is also its name to VoiceOver.
    var placeholder: String
}

/// The field: the header's look — a bright capsule, clear while there are
/// words, the navy disc — searching the page it is on. The disc and Return
/// put the keyboard away, the results being on the page already.
struct PageSearchField: View {
    let search: PageSearch
    @FocusState private var focused: Bool
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let text = search.text
        HStack(spacing: 0) {
            TextField(l.t(search.placeholder), text: text)
                .font(.inter(16))
                .foregroundStyle(Brand.navy)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($focused)
                .onSubmit { focused = false }
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel(l.t(search.placeholder))
                .accessibilityAddTraits(.isSearchField)
            if !text.wrappedValue.isEmpty {
                Button {
                    text.wrappedValue = ""
                    focused = true
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Brand.muted)
                        .frame(width: 28, height: 28)
                        .background(Circle().fill(Color.white))
                        .overlay(Circle().strokeBorder(Brand.line, lineWidth: 1))
                        .frame(width: 36, height: 36)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.tap)
                .accessibilityLabel(l.t("header.searchClear"))
            }
            Button {
                focused = false
            } label: {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(Brand.navy))
            }
            .buttonStyle(.tap)
            .accessibilityLabel(l.t("search.pageSubmit"))
            .padding(.leading, 6)
        }
        .padding(.leading, 8)
        .padding(.trailing, 4)
        .frame(height: 44)
        .liquidGlass(.bright, interactive: false)
        .accessibilityElement(children: .contain)
    }
}

/// Nothing on the page matches: said, with the shop's own search for the same
/// words where that helps (`PageSearchMissed` on the web).
struct PageSearchMissed: View {
    let term: String
    var shopWide = true
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(spacing: 12) {
            Text(l.t("search.pageNoMatch", ["term": term]))
                .font(.inter(16, .bold))
                .foregroundStyle(Brand.navy)
                .multilineTextAlignment(.center)
            if shopWide {
                Button {
                    app.search(term)
                } label: {
                    Label(l.t("search.wholeShop", ["term": term]), systemImage: "magnifyingglass")
                        .font(.inter(14, .bold))
                        .foregroundStyle(Brand.navy)
                        .padding(.horizontal, 18)
                        .frame(minHeight: 44)
                        .background(Capsule().fill(Color.white))
                        .overlay(Capsule().strokeBorder(Brand.cardLine, lineWidth: 1))
                }
                .buttonStyle(.tap)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .padding(.horizontal, 16)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        .accessibilityElement(children: .contain)
    }
}
