import SwiftUI

/// The shop's footer, the web's `SiteFooter` as a phone draws it.
///
/// The link groups come first and fold, the owner's order for a phone; then
/// the logo, the shop's line and how to reach a person; then how paying and
/// delivery work and the language; and last who the shop is, with the terms
/// and the privacy policy. Every contact is the server's setting
/// (`support.channels`) over the shop's own defaults, so the footer and the web
/// cannot name two numbers.
///
/// The navy ends with the footer, and every page above it is at least a
/// screen tall (`ShopPage`), so the floating tab bar rests over the page's
/// ground at the top of a page and at its foot alike. Under navy the system's
/// glass turns dark and draws the selected tab in the same navy, where it
/// vanished; with no band behind the bar any more (`NoBottomEdge`), the ground
/// is what keeps it readable, and only a scroll through the footer crosses it.
struct SiteFooter: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.openURL) private var openURL

    /// The footer's light words on navy (#c5d3e6).
    static let soft = Color(red: 197 / 255, green: 211 / 255, blue: 230 / 255)

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(spacing: 0) {
                FooterGroup(title: l.t("footer.categories"), links: departmentLinks)
                FooterGroup(title: l.t("footer.shopping"), links: shoppingLinks)
                FooterGroup(title: l.t("footer.service"), links: serviceLinks)
                FooterGroup(title: l.t("footer.netlet"), links: netletLinks)
            }
            about.padding(.top, 32)
            terms
        }
        .padding(.horizontal, 16)
        .padding(.top, 24)
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Brand.navy)
        .padding(.top, 24)
    }

    // MARK: The link groups

    private var departmentLinks: [FooterLink] {
        let counts = app.shelf.counts
        let shown = ReferenceData.shared.departments.filter { department in
            // The navigation's rule: a department with nothing on sale is not
            // linked — and every one shows until the counts arrive.
            guard let counts else { return true }
            return (counts[department.slug] ?? 0) > 0
        }
        return shown.map { department in
            FooterLink(title: l.t(department.label)) { app.push(.department(slug: department.slug)) }
        } + [FooterLink(title: l.t("footer.allCategories")) { app.select(.categories) }]
    }

    private var shoppingLinks: [FooterLink] {
        var links = [
            FooterLink(title: l.t("footer.allProducts")) { app.push(.department(slug: nil)) },
            FooterLink(title: l.t("footer.newArrivals")) { app.push(.newest) },
            FooterLink(title: l.t("footer.onOffer")) { app.push(.deals) },
            FooterLink(title: l.t("footer.savedItems")) { app.push(.saved) },
        ]
        // Finding somebody's list, while lists are switched on.
        if app.features.isOn("wishlists") { links.append(FooterLink(title: l.t("gift.title")) { app.push(.gifts) }) }
        return links
    }

    private var serviceLinks: [FooterLink] {
        var links = [
            FooterLink(title: l.t("footer.helpCentre")) { app.push(.helpCentre) },
            FooterLink(title: l.t("footer.yourOrders")) { app.openAccount(.orders) },
            FooterLink(title: l.t("footer.returns")) { app.push(.returnsPolicy) },
            FooterLink(title: l.t("footer.account")) { app.select(.account) },
        ]
        if app.features.isOn("articles") { links.insert(FooterLink(title: l.t("guides.title")) { app.push(.guides) }, at: 1) }
        return links
    }

    private var netletLinks: [FooterLink] {
        [
            FooterLink(title: l.t("stores.title")) { app.push(.stores) },
            FooterLink(title: l.t("footer.sellWithUs")) { app.push(.sell) },
            FooterLink(title: l.t("footer.sellerAgreement")) { app.push(.legal(.sellers)) },
        ]
    }

    // MARK: The logo and the ways to reach a person

    private var contact: ShopContact { app.shelf.contact }

    private var about: some View {
        let arabic = l.current == .ar
        let visitAddress = contact.visit.map { arabic ? ($0.addressAr ?? $0.address) : $0.address }
        let place = visitAddress?.split(whereSeparator: { $0 == "," || $0 == "،" }).first.map { $0.trimmingCharacters(in: .whitespaces) }
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                app.goHome()
            } label: {
                BundledImage(image: WebAssets.footerLogo)
                    .frame(maxWidth: 140, maxHeight: 40, alignment: .leading)
                    .frame(height: 40)
            }
            .buttonStyle(.tap)
            .accessibilityLabel(l.t("header.home"))
            (Text(l.t("home.heroTitle") + " ").foregroundColor(.white) + Text(l.t("home.heroTitleAccent")).foregroundColor(Brand.accentOnDark))
                .font(.inter(15, .semibold))
                .padding(.top, 12)
            HStack(spacing: 8) {
                Image(systemName: "headphones")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Brand.accentOnDark)
                    .accessibilityHidden(true)
                Text(l.t("footer.contactTitle"))
                    .font(.inter(17, .bold))
                    .foregroundStyle(.white)
                    .accessibilityAddTraits(.isHeader)
            }
            .padding(.top, 24)
            Text(place.map { l.t("footer.contactNote", ["place": $0]) } ?? l.t("footer.contactNotePlain"))
                .font(.inter(14))
                .foregroundStyle(Self.soft)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
            VStack(alignment: .leading, spacing: 4) {
                if let whatsapp = contact.whatsapp {
                    ContactRow(symbol: "message", label: l.t("support.whatsapp"), detail: ShopContact.display(whatsapp)) {
                        let hello = l.t("support.whatsappHello").addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
                        if let url = URL(string: "https://wa.me/\(whatsapp)?text=\(hello)") { openURL(url) }
                    }
                }
                if let phone = contact.phone {
                    ContactRow(symbol: "phone", label: l.t("footer.callUs"), detail: ShopContact.display(phone)) {
                        if let url = URL(string: "tel:+\(phone)") { openURL(url) }
                    }
                }
                if let email = contact.email {
                    ContactRow(symbol: "envelope", label: l.t("footer.emailUs"), detail: email) {
                        if let url = URL(string: "mailto:\(email)") { openURL(url) }
                    }
                }
                if let visitAddress {
                    ContactRow(symbol: "mappin.and.ellipse", label: l.t("footer.visitUs"), detail: visitAddress, leftToRightDetail: false) {
                        let query = visitAddress.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
                        if let url = URL(string: "https://maps.apple.com/?q=\(query)") { openURL(url) }
                    }
                }
                ContactRow(symbol: "bubble.left.and.bubble.right", label: l.t("help.contactMessage")) {
                    if app.session.isSignedIn { app.open(.help) } else { app.authPresented = true }
                }
                ContactRow(symbol: "lifepreserver", label: l.t("footer.helpCentre")) {
                    app.push(.helpCentre)
                }
            }
            .padding(.top, 16)
            if !contact.social.isEmpty {
                Text(l.t("footer.follow"))
                    .font(.inter(15, .bold))
                    .foregroundStyle(.white)
                    .padding(.top, 24)
                HStack(spacing: 8) {
                    ForEach(contact.social, id: \.url) { link in
                        Button {
                            if let url = URL(string: link.url) { openURL(url) }
                        } label: {
                            Text(String(l.t("social.\(link.platform)").prefix(2)))
                                .font(.inter(13, .bold))
                                .foregroundStyle(.white)
                                .frame(width: 44, height: 44)
                                .overlay(Circle().strokeBorder(Color.white.opacity(0.2), lineWidth: 1))
                        }
                        .buttonStyle(.tap)
                        .accessibilityLabel(l.t("footer.socialOn", ["platform": l.t("social.\(link.platform)")]))
                    }
                }
                .padding(.top, 12)
            }
        }
    }

    // MARK: Paying, delivery, the language, and who the shop is

    private var terms: some View {
        let arabic = l.current == .ar
        let company = contact.company
        let named = company.map { arabic ? ($0.nameAr ?? $0.name) : $0.name } ?? l.t("footer.netlet")
        // `nameInSentence`: the name's own full stop is the sentence's.
        let name = named.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: #"\.+$"#, with: "", options: .regularExpression)
        let year = Calendar(identifier: .gregorian).component(.year, from: Date())
        return VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(Color.white.opacity(0.15)).frame(height: 1)
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    Image(systemName: "banknote")
                        .font(.system(size: 16))
                        .foregroundStyle(Brand.accentOnDark)
                        .accessibilityHidden(true)
                    (Text(l.t("footer.payment") + ": ").font(.inter(14, .semibold)).foregroundColor(.white)
                        + Text(l.t("footer.cashOnDelivery")).font(.inter(14)).foregroundColor(Self.soft))
                }
                HStack(spacing: 10) {
                    Image(systemName: "truck.box")
                        .font(.system(size: 16))
                        .foregroundStyle(Brand.accentOnDark)
                        .accessibilityHidden(true)
                    Text(l.t("checkout.builtForKuwait"))
                        .font(.inter(14))
                        .foregroundStyle(Self.soft)
                }
            }
            .padding(.top, 24)
            Button {
                app.setLanguage(l.current.other)
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "globe").font(.system(size: 15))
                    Text(l.t("header.language")).font(.inter(14, .semibold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .frame(height: 44)
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.25), lineWidth: 1))
                .contentShape(Capsule())
            }
            .buttonStyle(.tap)
            .environment(\.locale, l.current.other.locale)
            .accessibilityHint(l.t("header.changeLanguage"))
            .padding(.top, 16)
            VStack(alignment: .leading, spacing: 2) {
                Text(l.t("footer.copyright", ["year": String(year), "name": name]))
                if let licence = company?.licence {
                    Text(l.t("footer.registration", ["number": "\u{2068}\(licence)\u{2069}"]))
                }
                if let address = company?.address {
                    Text(address)
                }
            }
            .font(.inter(13))
            .foregroundStyle(Self.soft)
            .padding(.top, 24)
            HStack(spacing: 20) {
                Button(l.t("footer.terms")) { app.push(.legal(.terms)) }
                Button(l.t("footer.privacy")) { app.push(.legal(.privacy)) }
            }
            .font(.inter(13))
            .foregroundStyle(Self.soft)
            .buttonStyle(.tap)
            .frame(minHeight: 44)
            .padding(.top, 8)
        }
    }
}

struct FooterLink: Identifiable {
    let title: String
    let open: () -> Void
    var id: String { title }
}

/// A group of links: on a phone the heading is a row that opens the list.
private struct FooterGroup: View {
    let title: String
    let links: [FooterLink]
    @State private var open = false
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(still ? nil : .easeOut(duration: 0.2)) { open.toggle() }
            } label: {
                HStack(spacing: 12) {
                    Text(title)
                        .font(.inter(16, .bold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(SiteFooter.soft)
                        .rotationEffect(.degrees(open ? 180 : 0))
                }
                .frame(minHeight: 56)
                .contentShape(Rectangle())
            }
            .buttonStyle(.tap)
            .accessibilityAddTraits(.isHeader)
            .accessibilityValue(open ? "▲" : "▼")
            if open {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(links) { link in
                        Button(action: link.open) {
                            Text(link.title)
                                .font(.inter(15))
                                .foregroundStyle(SiteFooter.soft)
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.tap)
                    }
                }
                .padding(.bottom, 12)
                .transition(.opacity)
            }
        }
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.white.opacity(0.15)).frame(height: 1)
        }
    }
}

/// One way to reach a person: an icon on a faint disc, what it is, and the
/// number or address itself.
private struct ContactRow: View {
    let symbol: String
    let label: String
    var detail: String?
    /// A number or an address reads left to right on either page.
    var leftToRightDetail = true
    let press: () -> Void

    var body: some View {
        Button(action: press) {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Brand.accentOnDark)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(Color.white.opacity(0.08)))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(label)
                        .font(.inter(15, .semibold))
                        .foregroundStyle(.white)
                    if let detail {
                        Text(leftToRightDetail ? "\u{2066}\(detail)\u{2069}" : detail)
                            .font(.inter(13))
                            .foregroundStyle(SiteFooter.soft)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(minHeight: 44)
            .padding(.vertical, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressFillStyle(cornerRadius: 12))
    }
}
