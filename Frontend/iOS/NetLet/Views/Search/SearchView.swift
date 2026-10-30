import SwiftUI

/// The header's search, opened: the field takes the keyboard and a sheet of
/// the header's glass grows down from it over the dimmed page — the web's
/// phone search sheet.
///
/// With nothing typed it offers what is true: this phone's recent searches as
/// chips, the departments as the home page's tiles with what each holds, and
/// a row of shortcuts — Today's deals only while the home page draws them.
/// While typing it asks the server once typing pauses and offers a department
/// or a brand the words name, then up to five products with their department
/// and price. The keyboard's Search key opens the results page.
struct SearchOverlay: View {
    @State private var model: SearchViewModel?
    @Environment(AppModel.self) private var app

    var body: some View {
        if let model {
            SearchSheet(model: model)
        } else {
            Color.clear.onAppear {
                let made = SearchViewModel(catalog: app.services.catalog)
                // The shelves the home page holds answer the first letters at once.
                let shelf = app.shelf
                made.held = { (shelf.catalogue.value ?? []) + shelf.bestsellers }
                model = made
            }
        }
    }
}

private struct SearchSheet: View {
    @Bindable var model: SearchViewModel
    @FocusState private var focused: Bool
    @State private var dictation: Dictation
    @State private var photoOpen = false
    /// The sheet has grown out of the header: false for the first frame and
    /// again while it rolls back up on Close.
    @State private var unrolled = false
    /// The sheet is folding away; nothing more is pressed meanwhile.
    @State private var closing = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still

    init(model: SearchViewModel) {
        _model = Bindable(wrappedValue: model)
        // Made here, not as the property's initial value, for the main actor's sake.
        _dictation = State(initialValue: Dictation())
    }

    /// The field's row — what shows of the sheet before it unrolls and after
    /// it has rolled back up.
    private static let fieldRow: CGFloat = 64

    var body: some View {
        ZStack(alignment: .top) {
            // The page dimmed under the sheet, while it unrolls and rolls up;
            // a press on it puts the search away.
            Color(red: 6 / 255, green: 27 / 255, blue: 59 / 255).opacity(unrolled ? 0.35 : 0)
                .ignoresSafeArea()
                .onTapGesture { close() }
                .accessibilityHidden(true)
            VStack(spacing: 0) {
                field
                if dictation.listening || dictation.problem != nil {
                    Text(dictation.listening ? l.t("search.voiceListening") + " " + l.t("ios.voice.privacy") : l.t(Dictation.messageKey(dictation.problem ?? "")))
                        .font(.inter(12))
                        .foregroundStyle(dictation.listening ? Brand.body : Brand.danger)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 20)
                        .padding(.bottom, 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityAddTraits(.updatesFrequently)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
                ScrollView {
                    ZStack(alignment: .topLeading) {
                        if model.trimmed.isEmpty {
                            VStack(alignment: .leading, spacing: 0) { suggestions }
                                .transition(.opacity)
                        } else {
                            results.transition(.opacity)
                        }
                    }
                    .animation(still ? nil : .easeOut(duration: 0.18), value: model.trimmed.isEmpty)
                    .padding(.horizontal, 16)
                    .padding(.top, 4)
                    .padding(.bottom, 20)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .scrollDismissesKeyboard(.interactively)
                .frame(maxHeight: .infinity, alignment: .top)
            }
            .animation(still ? nil : .easeOut(duration: 0.2), value: dictation.listening || dictation.problem != nil)
            // **Connected to the keyboard, on the owner's word.** The words stop
            // at the keyboard's top, as every scroll does, but the glass runs on
            // down behind it to the foot of the screen: the sheet stopped 48
            // points short, and the gap showed the page — the home page's
            // footer and the assistant's button — between the two. The phone's
            // own keyboard sits on the glass now, one surface from the field
            // to the keys.
            .background {
                GlassSurface(top: 0.7, foot: 0.7)
                    .ignoresSafeArea()
            }
            // It grows down out of the header and folds back into it — the
            // web's sheet unrolling — by a clip that only ever reveals, never a
            // fade or a scale on the glass, which would wash its blur out.
            .clipShape(Unroll(progress: unrolled ? 1 : 0, closed: Self.fieldRow))
            .allowsHitTesting(!closing)
        }
        .onAppear {
            model.query = app.searchText
            model.language = l.current
            withAnimation(still ? nil : .spring(duration: 0.42, bounce: 0.1)) { unrolled = true }
            // Opened by the header's microphone or camera: straight to that.
            switch app.searchStart {
            case .voice?:
                dictation.start(language: l.current) { heard in model.query = heard }
            case .photo?:
                photoOpen = true
            case nil:
                focused = true
            }
            app.searchStart = nil
        }
        .onChange(of: dictation.listening) { _, listening in
            // What was heard is shown back in the field before anything is searched.
            if !listening { focused = true }
        }
        .sheet(isPresented: $photoOpen) {
            PhotoSearchSheet { words in
                model.query = words
                focused = true
            }
        }
        .onDisappear { dictation.cancel() }
        .onChange(of: model.query) { model.queryChanged() }
        .onChange(of: l.current) { _, language in
            model.language = language
            if !model.trimmed.isEmpty { Task { await model.run(model.trimmed) } }
        }
    }

    // MARK: The field

    /// The server is being asked about the words in the field.
    private var asking: Bool {
        !model.trimmed.isEmpty && model.answered != model.trimmed && model.result.error == nil
    }

    private var field: some View {
        HStack(spacing: 8) {
            HStack(spacing: 0) {
                TextField("", text: $model.query)
                    .font(.inter(16))
                    .foregroundStyle(Brand.navy)
                    .focused($focused)
                    .submitLabel(.search)
                    .onSubmit { submit(model.trimmed) }
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .padding(.horizontal, 12)
                    .accessibilityLabel(l.t("header.searchAria"))
                    // The empty field offers the shop's own examples in turn,
                    // as the header's does, until the first letter is typed.
                    .overlay(alignment: .leading) {
                        if model.query.isEmpty && !dictation.listening {
                            CyclingExample(examples: app.shelf.searchExamples(language: l))
                                .font(.inter(16))
                                .foregroundStyle(Brand.muted)
                                .padding(.horizontal, 12)
                                .allowsHitTesting(false)
                                .accessibilityHidden(true)
                        }
                    }
                trailingControls
                Button {
                    submit(model.trimmed)
                } label: {
                    SubmitDisc(asking: asking, still: still)
                }
                .buttonStyle(.tap)
                .accessibilityLabel(l.t("header.searchSubmit"))
                .padding(.leading, 6)
            }
            .padding(.leading, 8)
            .padding(.trailing, 4)
            .frame(height: 44)
            .background(Capsule().fill(Color.white))
            // `.glass-field:focus-within`: a navy edge and a soft navy ring,
            // which grows in as the field takes the keyboard.
            .overlay(Capsule().strokeBorder(focused ? Brand.navy : Brand.line, lineWidth: 1))
            .background(Capsule().stroke(Brand.navy.opacity(focused ? 0.12 : 0), lineWidth: focused ? 6 : 0))
            .animation(still ? nil : .easeOut(duration: 0.2), value: focused)
            Button(l.t("search.close")) { close() }
                .font(.inter(15, .semibold))
                .foregroundStyle(Brand.navy)
                .frame(minHeight: 44)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    /// Speaking or pointing is instead of typing, so the pair shares the
    /// clear button's place: on an empty field only. Each comes and goes with
    /// a small spring rather than a cut.
    @ViewBuilder
    private var trailingControls: some View {
        let voice = app.features.isOn("voiceSearch") && Dictation.isAvailable
        let photo = app.features.isOn("photoSearch") && app.photoSearchReady
        HStack(spacing: 0) {
            if model.query.isEmpty && !dictation.listening {
                if voice {
                    Button {
                        focused = false
                        dictation.start(language: l.current) { heard in model.query = heard }
                    } label: {
                        Image(systemName: "mic")
                            .font(.system(size: 17))
                            .foregroundStyle(Brand.muted)
                            .frame(width: 36, height: 36)
                    }
                    .buttonStyle(.tap)
                    .accessibilityLabel(l.t("search.voice"))
                    .transition(.scale(scale: 0.5).combined(with: .opacity))
                }
                if photo {
                    Button {
                        focused = false
                        photoOpen = true
                    } label: {
                        Image(systemName: "camera")
                            .font(.system(size: 17))
                            .foregroundStyle(Brand.muted)
                            .frame(width: 36, height: 36)
                    }
                    .buttonStyle(.tap)
                    .accessibilityLabel(l.t("search.photo"))
                    .transition(.scale(scale: 0.5).combined(with: .opacity))
                }
                if voice || photo {
                    // A hairline, so the pair reads as other ways in rather
                    // than two more things the search disc might mean.
                    Rectangle()
                        .fill(Color(red: 201 / 255, green: 214 / 255, blue: 230 / 255))
                        .frame(width: 1, height: 20)
                        .padding(.horizontal, 2)
                        .accessibilityHidden(true)
                        .transition(.opacity)
                }
            }
            if dictation.listening {
                Button {
                    dictation.stop()
                } label: {
                    ListeningMic(still: still)
                }
                .buttonStyle(.tap)
                .accessibilityLabel(l.t("shopChat.stopListening"))
                .transition(.scale(scale: 0.5).combined(with: .opacity))
            }
            if !model.query.isEmpty && !dictation.listening {
                Button {
                    model.query = ""
                    app.searchText = ""
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
                .transition(.scale(scale: 0.5).combined(with: .opacity))
            }
        }
        .animation(still ? nil : .spring(duration: 0.28, bounce: 0.25), value: model.query.isEmpty)
        .animation(still ? nil : .spring(duration: 0.28, bounce: 0.25), value: dictation.listening)
    }

    // MARK: Nothing typed yet

    @ViewBuilder
    private var suggestions: some View {
        if !model.recent.isEmpty {
            HStack {
                heading(l.t("header.recentSearches"))
                Spacer()
                Button(l.t("header.clearRecent")) { model.clearRecent() }
                    .font(.inter(14, .bold))
                    .foregroundStyle(Brand.accentInk)
                    .frame(minHeight: 44)
                    .accessibilityLabel(l.t("header.clearRecentAria"))
            }
            .padding(.top, 8)
            .rise(0, shown: unrolled)
            FlowChips(items: Array(model.recent.prefix(6))) { submit($0) }
                .padding(.bottom, 8)
                .rise(1, shown: unrolled)
        }
        heading(l.t("header.shopByDepartment"))
            .padding(.top, 12)
            .padding(.bottom, 10)
            .rise(2, shown: unrolled)
        let departments = ReferenceData.shared.departments
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
            ForEach(Array(departments.enumerated()), id: \.element.id) { index, department in
                tile(slug: department.slug, title: l.t(department.label), count: app.shelf.counts?[department.slug]) {
                    open(.department(slug: department.slug))
                }
                .rise(3 + index, shown: unrolled)
            }
            tile(slug: "all", title: l.t("nav.allDepartments"), count: nil) { open(.department(slug: nil)) }
                .rise(3 + departments.count, shown: unrolled)
        }
        heading(l.t("header.searchShortcuts"))
            .padding(.top, 18)
            .padding(.bottom, 10)
            .rise(4 + departments.count, shown: unrolled)
        FlowLayout(spacing: 8) {
            if app.shelf.dealsDrawn {
                shortcut("tag", l.t("home.heroDeals")) { open(.deals) }
            }
            shortcut("sparkles", l.t("footer.newArrivals")) { open(.newest) }
            shortcut("storefront", l.t("stores.title")) { open(.stores) }
        }
        .rise(5 + departments.count, shown: unrolled)
    }

    private func heading(_ text: String) -> some View {
        Text(text)
            .font(.inter(15, .heavy))
            .foregroundStyle(Brand.navy)
            .accessibilityAddTraits(.isHeader)
    }

    private func tile(slug: String, title: String, count: Int?, press: @escaping () -> Void) -> some View {
        Button(action: press) {
            VStack(spacing: 4) {
                BundledImage(image: WebAssets.department(slug))
                    .aspectRatio(4.0 / 3.0, contentMode: .fit)
                Text(title)
                    .font(.inter(12, .bold))
                    .foregroundStyle(Brand.navy)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                if let count {
                    Text(l.productCount(count))
                        .font(.inter(11))
                        .foregroundStyle(Brand.muted)
                        .lineLimit(1)
                }
            }
            .padding(6)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.9)))
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 14))
        .accessibilityElement(children: .combine)
    }

    private func shortcut(_ symbol: String, _ label: String, press: @escaping () -> Void) -> some View {
        Button(action: press) {
            HStack(spacing: 8) {
                Image(systemName: symbol).font(.system(size: 14, weight: .semibold)).foregroundStyle(Brand.accentInk)
                Text(label).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(Capsule().fill(Color.white.opacity(0.9)))
            .contentShape(Capsule())
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 22))
    }

    // MARK: While typing

    @ViewBuilder
    private var results: some View {
        let words = model.trimmed
        VStack(alignment: .leading, spacing: 4) {
            ForEach(namedDepartments(words)) { department in
                suggestionRow(symbol: "square.grid.2x2", title: l.t(department.label), kind: l.t("search.kindDepartment")) {
                    open(.department(slug: department.slug))
                }
            }
            if let brand = namedBrand(words) {
                suggestionRow(symbol: "tag", title: brand.name, kind: l.t("search.kindBrand")) {
                    open(.brand(name: brand.name))
                }
            }
            if model.answered != words, let held = model.interim {
                // Products already in hand answer the words while the server is asked.
                ForEach(held.prefix(5)) { product in
                    productRow(product)
                        .transition(.opacity.combined(with: .offset(y: 8)))
                }
                seeAll(words, count: nil)
            } else {
                answer(words)
            }
        }
        .padding(.top, 4)
        // Each answer's rows move into place rather than being swapped in a
        // frame: a row that stays slides to its new place, a new one rises.
        .animation(still ? nil : .snappy(duration: 0.24), value: shownIDs)
    }

    /// The products the rows show now, to animate between one answer and the next.
    private var shownIDs: [String] {
        if model.answered != model.trimmed, let held = model.interim { return held.prefix(5).map(\.id) }
        return model.result.value?.products.prefix(5).map(\.id) ?? []
    }

    /// The server's answer, or the last one while it is asked again.
    @ViewBuilder
    private func answer(_ words: String) -> some View {
        switch model.result {
        case .loaded(let found):
            if let corrected = found.correctedTo, !corrected.isEmpty {
                Text(l.t("search.showingFor", ["term": corrected]))
                    .font(.inter(13))
                    .foregroundStyle(Brand.body)
                    .padding(.vertical, 6)
            }
            ForEach(found.products.prefix(5)) { product in
                productRow(product)
                    .transition(.opacity.combined(with: .offset(y: 8)))
            }
            if found.products.isEmpty {
                Text(l.t("header.noMatchYet"))
                    .font(.inter(14))
                    .foregroundStyle(Brand.body)
                    .padding(.vertical, 12)
            }
            seeAll(words, count: found.total)
        case .failed:
            seeAll(words, count: nil)
        case .idle, .loading:
            // The rows' own outline, breathing, rather than a spinner in a gap.
            SkeletonRows(still: still)
                .transition(.opacity)
        }
    }

    private func namedDepartments(_ words: String) -> [Department] {
        let typed = words.lowercased()
        guard typed.count >= 2 else { return [] }
        return ReferenceData.shared.departments.filter { department in
            let names = [l.t(department.label), department.name, department.nameAr].map { $0.lowercased() }
            let stocked = (app.shelf.counts?[department.slug] ?? 1) > 0
            return stocked && names.contains { $0.hasPrefix(typed) || typed.hasPrefix($0) }
        }
    }

    private func namedBrand(_ words: String) -> BrandCount? {
        let typed = words.lowercased()
        guard typed.count >= 2 else { return nil }
        return app.shelf.brands.first { $0.name.lowercased().hasPrefix(typed) }
    }

    private func suggestionRow(symbol: String, title: String, kind: String, press: @escaping () -> Void) -> some View {
        Button(action: press) {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 40, height: 40)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Brand.tint))
                Text(title).font(.inter(15, .bold)).foregroundStyle(Brand.navy).lineLimit(1)
                Spacer(minLength: 8)
                Text(kind).font(.inter(12)).foregroundStyle(Brand.muted)
            }
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.85)))
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 14))
    }

    private func productRow(_ product: Product) -> some View {
        Button {
            model.remember(model.trimmed)
            open(.product(handle: product.handle))
        } label: {
            HStack(spacing: 12) {
                RemoteImage(reference: product.images.first?.url, contentMode: .fill)
                    .frame(width: 48, height: 48)
                    .background(Brand.photo)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(highlighted(product.title, model.trimmed))
                        .font(.inter(14))
                        .foregroundStyle(Brand.navy)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    HStack(spacing: 6) {
                        if let department = ReferenceData.shared.department(named: product.productType) {
                            Text(l.t(department.label))
                            Text("·")
                        }
                        Text(product.priceRange.min.formatted(l.current))
                            .font(.inter(13, .bold))
                            .foregroundStyle(Brand.navy)
                    }
                    .font(.inter(12))
                    .foregroundStyle(Brand.muted)
                }
                Spacer(minLength: 0)
            }
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.85)))
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 14))
    }

    /// The words searched for, in bold — matched word by word, as the search matches.
    private func highlighted(_ title: String, _ words: String) -> AttributedString {
        var text = AttributedString(title)
        let terms = words.lowercased().split(whereSeparator: \.isWhitespace).map(String.init).filter { !$0.isEmpty }
        for term in terms {
            var searchRange = text.startIndex..<text.endIndex
            while let found = text[searchRange].range(of: term, options: [.caseInsensitive, .diacriticInsensitive]) {
                text[found].font = Font.inter(14, .bold)
                searchRange = found.upperBound..<text.endIndex
            }
        }
        return text
    }

    private func seeAll(_ words: String, count: Int?) -> some View {
        Button {
            submit(words)
        } label: {
            HStack(spacing: 6) {
                Text(count.map { l.t("header.seeAllCount", ["count": "\($0)", "query": words]) } ?? l.t("header.seeAllResults", ["query": words]))
                    .multilineTextAlignment(.leading)
                Image(systemName: "chevron.forward").font(.system(size: 12, weight: .bold))
            }
            .font(.inter(14, .bold))
            .foregroundStyle(Brand.accentInk)
            .frame(minHeight: 44)
        }
        .buttonStyle(.tap)
        .padding(.top, 4)
    }

    // MARK: Going somewhere

    private func submit(_ words: String) {
        let trimmed = words.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        model.remember(trimmed)
        focused = false
        app.search(trimmed)
    }

    private func open(_ route: Route) {
        app.searchText = model.query
        focused = false
        app.searchOpen = false
        app.push(route)
    }

    /// Put away by Close or a press on the dim: the sheet rolls back up into
    /// the header as the keyboard goes down, and is gone once it has.
    private func close() {
        guard !closing else { return }
        app.searchText = model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : app.searchText
        focused = false
        dictation.cancel()
        guard !still else {
            app.searchOpen = false
            return
        }
        closing = true
        withAnimation(.easeIn(duration: Self.rollUp)) { unrolled = false }
        Task {
            try? await Task.sleep(for: .seconds(Self.rollUp))
            app.searchOpen = false
        }
    }

    private static let rollUp = 0.24
}

// MARK: - The sheet's motion

/// The sheet as far as it has unrolled: the field's row at nothing, the whole
/// screen at one — reaching up past the view's top behind the status bar and
/// down past its foot behind the keyboard, where the glass is drawn too. The
/// foot is rounded while it moves, so it reads as a sheet sliding down out of
/// the header rather than a curtain.
private struct Unroll: Shape {
    var progress: CGFloat
    /// What shows at nothing: the field's row.
    let closed: CGFloat

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let above: CGFloat = 200
        let below: CGFloat = 600
        let foot = closed + (rect.height + below - closed) * min(max(progress, 0), 1)
        let shape = UnevenRoundedRectangle(topLeadingRadius: 0, bottomLeadingRadius: 24, bottomTrailingRadius: 24, topTrailingRadius: 0, style: .continuous)
        return shape.path(in: CGRect(x: rect.minX, y: rect.minY - above, width: rect.width, height: foot + above))
    }
}

/// The search disc. While the server is asked about the words, a white arc
/// runs round its edge — the same answer the outline rows give below, at the
/// thumb.
private struct SubmitDisc: View {
    let asking: Bool
    let still: Bool

    var body: some View {
        ZStack {
            Circle().fill(Brand.navy)
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
            if asking {
                TurningArc(still: still).transition(.opacity)
            }
        }
        .frame(width: 36, height: 36)
        .animation(.easeOut(duration: 0.15), value: asking)
    }
}

/// The arc itself, a view of its own so each time it appears it starts
/// turning afresh — a turn held by the disc would end where it last stopped.
private struct TurningArc: View {
    let still: Bool
    @State private var turning = false

    var body: some View {
        Circle()
            .trim(from: 0, to: 0.28)
            .stroke(Color.white.opacity(0.9), style: StrokeStyle(lineWidth: 2, lineCap: .round))
            .padding(3)
            .rotationEffect(.degrees(turning ? 360 : 0))
            .onAppear {
                withAnimation(.linear(duration: still ? 1.6 : 0.9).repeatForever(autoreverses: false)) { turning = true }
            }
    }
}

/// The microphone while it listens: filled, with a ring breathing out of it —
/// the web's breathing microphone. Still under Reduce Motion.
private struct ListeningMic: View {
    let still: Bool
    @State private var breathing = false

    var body: some View {
        ZStack {
            Circle()
                .fill(Brand.accentInk.opacity(0.35))
                .scaleEffect(breathing ? 1.45 : 1)
                .opacity(breathing ? 0 : 1)
            Circle().fill(Brand.accentInk)
            Image(systemName: "mic.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
        }
        .frame(width: 32, height: 32)
        .frame(width: 36, height: 36)
        .onAppear {
            guard !still else { return }
            withAnimation(.easeOut(duration: 1.1).repeatForever(autoreverses: false)) { breathing = true }
        }
    }
}

/// Three rows shaped like the product rows, breathing, while the server is
/// asked and nothing in hand answers the words.
private struct SkeletonRows: View {
    let still: Bool
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { index in
                HStack(spacing: 12) {
                    LoadingTint(still: still)
                        .frame(width: 48, height: 48)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    VStack(alignment: .leading, spacing: 8) {
                        RoundedRectangle(cornerRadius: 4).fill(Brand.tint).frame(height: 12).padding(.trailing, CGFloat(40 + index * 24))
                        RoundedRectangle(cornerRadius: 4).fill(Brand.tint).frame(width: 90, height: 10)
                    }
                    Spacer(minLength: 0)
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.85)))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(l.t("nav.loadingPage"))
    }
}

/// A press the eye sees as well as the finger: the shade every press here
/// gets, and the tile giving a little under the thumb and springing back.
private struct SpringPressStyle: ButtonStyle {
    var cornerRadius: CGFloat = 14
    @Environment(\.accessibilityReduceMotion) private var still

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(Brand.navy.opacity(configuration.isPressed ? 0.06 : 0))
                    .allowsHitTesting(false)
            )
            .scaleEffect(configuration.isPressed && !still ? 0.96 : 1)
            .animation(still ? nil : .spring(duration: 0.22, bounce: 0.3), value: configuration.isPressed)
            .pressHaptic(configuration.isPressed)
    }
}

private extension View {
    /// Rises into place as the sheet unrolls, one after another in `order`.
    func rise(_ order: Int, shown: Bool) -> some View {
        modifier(Rise(order: order, shown: shown))
    }
}

private struct Rise: ViewModifier {
    let order: Int
    let shown: Bool
    @Environment(\.accessibilityReduceMotion) private var still

    func body(content: Content) -> some View {
        content
            .opacity(shown || still ? 1 : 0)
            .offset(y: shown || still ? 0 : 14)
            .animation(still ? nil : .spring(duration: 0.4, bounce: 0.12).delay(shown ? 0.05 + Double(min(order, 12)) * 0.025 : 0), value: shown)
    }
}
