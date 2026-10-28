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
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    init(model: SearchViewModel) {
        _model = Bindable(wrappedValue: model)
        // Made here, not as the property's initial value, for the main actor's sake.
        _dictation = State(initialValue: Dictation())
    }

    var body: some View {
        ZStack(alignment: .top) {
            // The page dimmed under the sheet; a press on it puts the search away.
            Color(red: 6 / 255, green: 27 / 255, blue: 59 / 255).opacity(0.35)
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
                }
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        if model.trimmed.isEmpty { suggestions } else { results }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 4)
                    .padding(.bottom, 20)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .scrollDismissesKeyboard(.interactively)
                .frame(maxHeight: .infinity, alignment: .top)
            }
            .background {
                GlassSurface(top: 0.7, foot: 0.7)
                    .clipShape(UnevenRoundedRectangle(topLeadingRadius: 0, bottomLeadingRadius: 24, bottomTrailingRadius: 24, topTrailingRadius: 0, style: .continuous))
                    .shadow(color: Brand.navy.opacity(0.18), radius: 24, x: 0, y: 12)
                    .ignoresSafeArea(edges: .top)
            }
            .padding(.bottom, 48)
        }
        .onAppear {
            model.query = app.searchText
            model.language = l.current
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

    private var field: some View {
        HStack(spacing: 8) {
            HStack(spacing: 0) {
                TextField(placeholder, text: $model.query)
                    .font(.inter(16))
                    .foregroundStyle(Brand.navy)
                    .focused($focused)
                    .submitLabel(.search)
                    .onSubmit { submit(model.trimmed) }
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .padding(.horizontal, 12)
                    .accessibilityLabel(l.t("header.searchAria"))
                if model.query.isEmpty && !dictation.listening {
                    // Speaking or pointing is instead of typing, so the pair shares
                    // the clear button's place: on an empty field only.
                    if app.features.isOn("voiceSearch") && Dictation.isAvailable {
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
                    }
                    if app.features.isOn("photoSearch") && app.photoSearchReady {
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
                    }
                    if (app.features.isOn("voiceSearch") && Dictation.isAvailable) || (app.features.isOn("photoSearch") && app.photoSearchReady) {
                        // A hairline, so the pair reads as other ways in rather
                        // than two more things the search disc might mean.
                        Rectangle()
                            .fill(Color(red: 201 / 255, green: 214 / 255, blue: 230 / 255))
                            .frame(width: 1, height: 20)
                            .padding(.horizontal, 2)
                            .accessibilityHidden(true)
                    }
                }
                if dictation.listening {
                    Button {
                        dictation.stop()
                    } label: {
                        Image(systemName: "mic.fill")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 36, height: 36)
                            .background(Circle().fill(Brand.accentInk))
                    }
                    .buttonStyle(.tap)
                    .accessibilityLabel(l.t("shopChat.stopListening"))
                }
                if !model.query.isEmpty && !dictation.listening {
                    Button {
                        model.query = ""
                        app.searchText = ""
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
                    submit(model.trimmed)
                } label: {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(Circle().fill(Brand.navy))
                }
                .buttonStyle(.tap)
                .accessibilityLabel(l.t("header.searchSubmit"))
                .padding(.leading, 6)
            }
            .padding(.leading, 8)
            .padding(.trailing, 4)
            .frame(height: 44)
            .background(Capsule().fill(Color.white))
            // `.glass-field:focus-within`: a navy edge and a soft navy ring.
            .overlay(Capsule().strokeBorder(Brand.navy, lineWidth: 1))
            .background(Capsule().stroke(Brand.navy.opacity(0.12), lineWidth: 6))
            Button(l.t("search.close")) { close() }
                .font(.inter(15, .semibold))
                .foregroundStyle(Brand.navy)
                .frame(minHeight: 44)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var placeholder: String {
        guard let example = app.shelf.searchExample(language: l) else { return l.t("header.searchAria") }
        return l.t("header.searchPlaceholder", ["example": example])
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
            FlowChips(items: Array(model.recent.prefix(6))) { submit($0) }
                .padding(.bottom, 8)
        }
        heading(l.t("header.shopByDepartment"))
            .padding(.top, 12)
            .padding(.bottom, 10)
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
            ForEach(ReferenceData.shared.departments) { department in
                tile(slug: department.slug, title: l.t(department.label), count: app.shelf.counts?[department.slug]) {
                    open(.department(slug: department.slug))
                }
            }
            tile(slug: "all", title: l.t("nav.allDepartments"), count: nil) { open(.department(slug: nil)) }
        }
        heading(l.t("header.searchShortcuts"))
            .padding(.top, 18)
            .padding(.bottom, 10)
        FlowLayout(spacing: 8) {
            if app.shelf.dealsDrawn {
                shortcut("tag", l.t("home.heroDeals")) { open(.deals) }
            }
            shortcut("sparkles", l.t("footer.newArrivals")) { open(.newest) }
            shortcut("storefront", l.t("stores.title")) { open(.stores) }
        }
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
        .buttonStyle(PressFillStyle(cornerRadius: 14))
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
        .buttonStyle(.tap)
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
                }
                seeAll(words, count: nil)
            } else {
                answer(words)
            }
        }
        .padding(.top, 4)
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
            ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 80)
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
        .buttonStyle(PressFillStyle(cornerRadius: 14))
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
        .buttonStyle(PressFillStyle(cornerRadius: 14))
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

    private func close() {
        app.searchText = model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : app.searchText
        focused = false
        app.searchOpen = false
    }
}
