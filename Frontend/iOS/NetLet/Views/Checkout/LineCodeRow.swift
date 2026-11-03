import SwiftUI

/// A store's or a product's discount code on one line at checkout (migration
/// 0074) — the web's `LineCode`, on the owner's word: "an Apply discount code
/// option for each product … the discount applies only to that product".
///
/// Three states: "Apply discount code", which opens a box with Apply; the code
/// applied, with what it takes off this product and Remove; or a code that no
/// longer applies, with why and Remove — Place order then waits on it
/// (`checkout.codeProblem`). A refusal is said under the box and leaves the
/// line's earlier code on it. A line in a set takes none, its price being the
/// set's, and a line drawn before the server answered waits for its id.
struct LineCodeRow: View {
    let item: CartItem
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var open = false
    @State private var draft = ""
    @State private var busy = false
    @State private var refusal: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if item.bundleName != nil || item.lineId.hasPrefix("pending:") {
                EmptyView()
            } else if let held = item.code {
                chip(code: held.code, text: l.t("checkout.lineCodeOff", ["amount": held.amount.formatted(l.current)]), problem: false)
            } else if let problem = item.codeProblem {
                chip(code: problem.code, text: say(problem.reason), problem: true)
            } else if open {
                box
            } else {
                Button {
                    refusal = nil
                    open = true
                    focused = true
                } label: {
                    Label(l.t("checkout.lineCodeAdd"), systemImage: "ticket")
                        .font(.inter(13, .bold))
                        .foregroundStyle(Brand.accentInk)
                        .frame(minHeight: 36)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.tap)
            }
        }
        .padding(.top, 4)
    }

    private var box: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                TextField(l.t("checkout.lineCodeAdd"), text: $draft)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .focused($focused)
                    .onSubmit { Task { await apply() } }
                    .onChange(of: draft) { _, _ in refusal = nil }
                    .environment(\.layoutDirection, .leftToRight)
                    .font(.inter(15))
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.pearl))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(refusal == nil ? Brand.line : Brand.danger, lineWidth: 1))
                    .accessibilityLabel(l.t("checkout.lineCodeLabel", ["title": item.title(l.current)]))
                Button {
                    Task { await apply() }
                } label: {
                    if busy { ProgressView().tint(.white) } else { Text(l.t("checkout.lineCodeApply")) }
                }
                .buttonStyle(CompactPrimaryStyle())
                .disabled(busy)
                Button {
                    open = false
                    draft = ""
                    refusal = nil
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Brand.muted)
                        .frame(width: 40, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(PressFillStyle(cornerRadius: 12))
                .accessibilityLabel(l.t("checkout.lineCodeCancel"))
            }
            if let refusal {
                Text(say(refusal))
                    .font(.inter(13, .semibold))
                    .foregroundStyle(Brand.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func chip(code: String, text: String, problem: Bool) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: problem ? "xmark.circle.fill" : "checkmark.circle.fill")
                .foregroundStyle(problem ? Brand.danger : Brand.success)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("\u{2066}\(code)\u{2069}").font(.inter(14, .heavy)).foregroundStyle(Brand.navy)
                Text(text)
                    .font(.inter(12, .semibold))
                    .foregroundStyle(problem ? Brand.danger : Brand.success)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Button {
                Task { await remove() }
            } label: {
                if busy {
                    ProgressView().frame(minWidth: 44, minHeight: 36)
                } else {
                    Text(l.t("checkout.lineCodeRemove"))
                        .font(.inter(13, .bold))
                        .foregroundStyle(Brand.navy)
                        .frame(minHeight: 36)
                        .padding(.horizontal, 6)
                        .contentShape(Rectangle())
                }
            }
            .buttonStyle(PressFillStyle(cornerRadius: 10))
            .disabled(busy)
            .accessibilityLabel(l.t("checkout.lineCodeRemoveName", ["code": code]))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(problem ? Brand.danger.opacity(0.08) : Brand.successFill))
    }

    private func say(_ key: String) -> String {
        l.phrasebook.has(key) ? l.t(key) : l.t("cart.updateFailed")
    }

    private func apply() async {
        let typed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !busy else { return }
        guard !typed.isEmpty else {
            refusal = "checkout.lineCodeEmpty"
            focused = true
            return
        }
        busy = true
        defer { busy = false }
        if let reason = await app.cart.setLineCode(lineId: item.lineId, code: typed) {
            Haptics.refused()
            refusal = reason
            focused = true
            return
        }
        Haptics.succeeded()
        open = false
        draft = ""
        focused = false
    }

    private func remove() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        if await app.cart.setLineCode(lineId: item.lineId, code: nil) != nil { Haptics.refused() }
    }
}
