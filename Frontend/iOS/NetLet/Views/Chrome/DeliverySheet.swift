import SwiftUI

/// "Deliver to": what the header's location button opens — the web's
/// `DeliveryZoneDialog` as a sheet.
///
/// Signed in it is the address book as choices: pick one and the shop
/// delivers there (its governorate prices each seller's delivery, and
/// checkout starts from it), add a new one, or manage them. An address with
/// no governorate cannot price anything, so it opens the book to be finished
/// rather than being chosen. Signed out there is no book, so it offers to sign
/// in and keeps the governorates beneath, so a guest can still see what
/// delivery costs.
struct DeliverySheet: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if app.session.isSignedIn {
                        signedIn
                    } else {
                        guest
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Brand.ground)
            .navigationTitle(l.t("delivery.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(l.t("auth.close")) { dismiss() }
                        .accessibilityLabel(l.t("delivery.close"))
                }
            }
            .task { await app.delivery.refresh(signedIn: app.session.isSignedIn) }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    @ViewBuilder
    private var signedIn: some View {
        let delivery = app.delivery
        if !delivery.loaded {
            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 24)
        } else if delivery.addresses.isEmpty {
            Text(l.t("delivery.firstTitle")).font(.inter(17, .bold)).foregroundStyle(Brand.navy)
            Text(l.t("delivery.firstNote")).font(.inter(14)).foregroundStyle(Brand.body)
            addButton
        } else {
            Text(l.t("delivery.addressNote")).font(.inter(14)).foregroundStyle(Brand.body)
            VStack(spacing: 0) {
                ForEach(delivery.addresses) { address in
                    row(address, chosen: delivery.inUse?.id == address.id)
                    if address.id != delivery.addresses.last?.id {
                        Rectangle().fill(Brand.cardLine).frame(height: 1).padding(.leading, 52)
                    }
                }
            }
            .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            addButton
            Button {
                openBook()
            } label: {
                Text(l.t("delivery.manage"))
                    .font(.inter(15, .semibold))
                    .foregroundStyle(Brand.navy)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.tap)
        }
    }

    private func row(_ address: SavedAddress, chosen: Bool) -> some View {
        let usable = !(address.governorate ?? "").isEmpty
        return Button {
            guard usable else { return openBook() }
            Task {
                await app.delivery.choose(address)
                dismiss()
            }
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: chosen ? "checkmark.circle.fill" : "mappin.circle")
                    .font(.system(size: 22))
                    .foregroundStyle(chosen ? Brand.navy : Brand.muted)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 3) {
                    Text(address.label).font(.inter(16, .bold)).foregroundStyle(Brand.navy)
                    let line = address.line(l.current)
                    if !line.isEmpty {
                        Text(line).font(.inter(13)).foregroundStyle(Brand.body).lineLimit(2)
                    }
                    if let governorate = ReferenceData.shared.governorate(id: address.governorate) {
                        Text(governorate.name(l.current)).font(.inter(13)).foregroundStyle(Brand.muted)
                    } else {
                        Text(l.t("delivery.needsGovernorate")).font(.inter(13, .medium)).foregroundStyle(Brand.accentInk)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(14)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressFillStyle(cornerRadius: 20, strength: Haptics.actionStrength))
        .accessibilityAddTraits(chosen ? .isSelected : [])
        .accessibilityHint(chosen ? l.t("delivery.chosenAddress") : "")
    }

    private var addButton: some View {
        Button {
            openBook()
        } label: {
            Label(l.t("delivery.addNew"), systemImage: "plus")
                .font(.inter(15, .bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(Capsule().fill(Brand.navy))
        }
        .buttonStyle(.tap)
    }

    @ViewBuilder
    private var guest: some View {
        Text(l.t("delivery.signInNote")).font(.inter(15)).foregroundStyle(Brand.body)
        Button {
            dismiss()
            // The sign-in sheet once this one has gone: two at once is one too many.
            Task {
                try? await Task.sleep(for: .milliseconds(450))
                app.authPresented = true
            }
        } label: {
            Text(l.t("header.signIn"))
                .font(.inter(15, .bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(Capsule().fill(Brand.navy))
        }
        .buttonStyle(.tap)
        Text(l.t("delivery.guestZones")).font(.inter(14, .semibold)).foregroundStyle(Brand.navy).padding(.top, 8)
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            ForEach(ReferenceData.shared.governorates) { governorate in
                let chosen = app.delivery.zoneId == governorate.id
                Button {
                    Task {
                        await app.delivery.setZone(governorate.id, signedIn: false)
                        dismiss()
                    }
                } label: {
                    Text(governorate.name(l.current))
                        .font(.inter(14, chosen ? .bold : .medium))
                        .foregroundStyle(chosen ? .white : Brand.navy)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(chosen ? Brand.navy : Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: chosen ? 0 : 1))
                }
                .buttonStyle(PressFillStyle(cornerRadius: 14, strength: Haptics.actionStrength))
                .accessibilityAddTraits(chosen ? .isSelected : [])
            }
        }
    }

    /// The address book on the Profile tab, where an address is added or finished.
    private func openBook() {
        dismiss()
        app.openAccount(.addresses)
    }
}
