import Foundation

/// What the warehouse, the spreadsheet import and the placements read from
/// `portal.json`: the import's columns and department words, NetLet's
/// inbound limits, and the placements' rates, room and banner shape.
struct WarehouseRules: Decodable, Sendable {
    struct Upload: Decodable, Sendable {
        let columns: [String: [String]]
        let departmentWords: [String: [String]]
        let limit: Int
        let template: String
    }

    struct Inbound: Decodable, Sendable {
        let maxLines: Int
        let maxUnits: Int
    }

    struct Ads: Decodable, Sendable {
        let slots: [String]
        let rates: [String: String]
        let capacity: [String: Int]
        let maxDays: Int
        let maxLeadDays: Int
        let headlineMax: Int
        let noteMax: Int
        let bannerAspect: Double
        let bannerMinWidth: Int
        let bannerMaxWidth: Int
    }

    let upload: Upload
    let inbound: Inbound
    let maxClaimResponse: Int
    let ads: Ads

    static let shared: WarehouseRules = {
        let data = Bundle.main.resource("portal", "json")
        return (try? JSONDecoder().decode(WarehouseRules.self, from: data)) ?? .fallback
    }()

    static let fallback = WarehouseRules(
        upload: .init(columns: [:], departmentWords: [:], limit: 1000, template: ""),
        inbound: .init(maxLines: 50, maxUnits: 10_000),
        maxClaimResponse: 2000,
        ads: .init(slots: [], rates: [:], capacity: [:], maxDays: 30, maxLeadDays: 90, headlineMax: 80, noteMax: 400, bannerAspect: 3, bannerMinWidth: 900, bannerMaxWidth: 2400)
    )

    /// `inboundProblem`: a shipment names each variant once, in whole units.
    func inboundProblem(_ lines: [(variantId: Int, quantity: Int)]) -> String? {
        if lines.isEmpty { return "fulfilment.noLines" }
        if lines.count > inbound.maxLines { return "fulfilment.tooManyLines" }
        if lines.contains(where: { $0.quantity < 1 || $0.quantity > inbound.maxUnits }) { return "fulfilment.badQuantity" }
        if Set(lines.map(\.variantId)).count != lines.count { return "fulfilment.duplicateLine" }
        return nil
    }

    /// `headlineProblem`: the store's words on NetLet's front page, read by the
    /// chat's contact filter.
    func headlineProblem(_ headline: String, required: Bool) -> String? {
        let text = headline.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        if text.isEmpty { return required ? "ads.bannerNeedsHeadline" : nil }
        if text.count > ads.headlineMax { return "ads.bannerTooLong" }
        if !ContactFilter.findings(text).isEmpty { return "ads.bannerContact" }
        return nil
    }
}

// MARK: - The spreadsheet import (`bulkUpload.ts`)

/// A file read on the phone before anything is sent: the rows that become
/// drafts, each one refused with its line, and how many departments were
/// guessed — the server makes them only when Create is pressed.
struct UploadPlan: Sendable {
    struct Product: Sendable, Hashable {
        let line: Int
        let title: String
        let sku: String?
        let price: String
        let compareAtPrice: String?
        let stock: Int
        let category: String?
        let categoryGuessed: Bool
        let description: String
        let imageUrl: String?
    }

    struct Problem: Sendable, Hashable {
        let line: Int
        let reason: String
    }

    var products: [Product] = []
    var problems: [Problem] = []
    var guessed: Int { products.filter(\.categoryGuessed).count }

    static func parseCsv(_ text: String) -> [[String]] {
        var rows: [[String]] = []
        var row: [String] = []
        var field = ""
        var quoted = false
        var characters = Array(text.hasPrefix("\u{FEFF}") ? String(text.dropFirst()) : text)
        var index = 0
        // A Windows line end is one line end, whichever the file used.
        characters = characters.flatMap { $0 == "\r\n" ? ["\n"] : [$0] }
        while index < characters.count {
            let character = characters[index]
            if quoted {
                if character != "\"" {
                    field.append(character)
                } else if index + 1 < characters.count && characters[index + 1] == "\"" {
                    field.append("\"")
                    index += 1
                } else {
                    quoted = false
                }
            } else if character == "\"" {
                quoted = true
            } else if character == "," {
                row.append(field)
                field = ""
            } else if character == "\n" {
                row.append(field)
                rows.append(row)
                row = []
                field = ""
            } else if character != "\r" {
                field.append(character)
            }
            index += 1
        }
        row.append(field)
        rows.append(row)
        return rows.filter { $0.contains { !$0.trimmingCharacters(in: .whitespaces).isEmpty } }
    }

    static func plan(_ text: String, rules: WarehouseRules.Upload = WarehouseRules.shared.upload,
                     departments: [Department] = ReferenceData.shared.departments) -> UploadPlan {
        let rows = parseCsv(text)
        guard rows.count >= 2 else { return UploadPlan(problems: [Problem(line: 1, reason: "bulk.missingColumns")]) }
        let normalise = { (value: String) in value.trimmingCharacters(in: .whitespaces).lowercased().filter { !" _-".contains($0) } }
        let headers = rows[0].map(normalise)
        func column(_ name: String) -> Int {
            let aliases = rules.columns[name] ?? []
            return headers.firstIndex { aliases.contains($0) } ?? -1
        }
        let title = column("title"), price = column("price"), stock = column("stock"), sku = column("sku")
        let compareAt = column("compareAtPrice"), category = column("category"), description = column("description"), image = column("imageUrl")
        guard title >= 0, price >= 0 else { return UploadPlan(problems: [Problem(line: 1, reason: "bulk.missingColumns")]) }
        func cell(_ row: [String], _ at: Int) -> String { at >= 0 && at < row.count ? row[at].trimmingCharacters(in: .whitespaces) : "" }
        var plan = UploadPlan()
        var seen = Set<String>()
        for (index, row) in rows.enumerated().dropFirst() {
            let line = index + 1
            let name = cell(row, title)
            guard !name.isEmpty else { plan.problems.append(Problem(line: line, reason: "bulk.noTitle")); continue }
            let amount = cell(row, price)
            guard isAmount(amount) else { plan.problems.append(Problem(line: line, reason: "bulk.badPrice")); continue }
            let stockText = cell(row, stock)
            guard let units = stockText.isEmpty ? 0 : Int(stockText), units >= 0 else { plan.problems.append(Problem(line: line, reason: "bulk.badStock")); continue }
            let code = cell(row, sku)
            // A file naming one code twice contradicts itself.
            if !code.isEmpty, !seen.insert(code.lowercased()).inserted { plan.problems.append(Problem(line: line, reason: "bulk.duplicateSku")); continue }
            let about = cell(row, description)
            let typed = cell(row, category)
            let guess = typed.isEmpty ? suggestDepartment("\(name) \(about)", rules: rules, departments: departments) : nil
            let was = cell(row, compareAt)
            plan.products.append(Product(
                line: line, title: name, sku: code.isEmpty ? nil : code, price: amount, compareAtPrice: isAmount(was) ? was : nil, stock: units,
                category: typed.isEmpty ? guess : typed, categoryGuessed: typed.isEmpty && guess != nil, description: about,
                imageUrl: cell(row, image).isEmpty ? nil : cell(row, image)
            ))
        }
        return plan
    }

    static func isAmount(_ text: String) -> Bool {
        text.range(of: #"^\d{1,9}(\.\d{1,3})?$"#, options: .regularExpression) != nil
    }

    /// A department from the words, only ever one the shop carries.
    static func suggestDepartment(_ text: String, rules: WarehouseRules.Upload, departments: [Department]) -> String? {
        let haystack = " \(text.lowercased()) "
        var best: (name: String, score: Int)?
        for department in departments {
            let score = (rules.departmentWords[department.slug] ?? []).filter { haystack.contains(" \($0)") }.count
            if score > 0, score > (best?.score ?? 0) { best = (department.name, score) }
        }
        return best?.name
    }
}

// MARK: - Bundles

struct BundleRow: Decodable, Identifiable, Hashable, Sendable {
    struct Member: Decodable, Hashable, Sendable {
        let productTitle: String
        let vendorId: Int?
    }

    let id: Int
    let name: String
    let bundlePrice: Money
    let separately: Money
    let active: Bool
    let crossVendor: Bool
    let members: [Member]
}

// MARK: - Dispatch

/// One seller's goods to one door on one order (`dispatch.board`).
struct BoardParcel: Decodable, Identifiable, Hashable, Sendable {
    struct Line: Decodable, Hashable, Sendable {
        let lineId: Int
        let productTitle: String
        let quantity: Int
    }

    struct Address: Decodable, Hashable, Sendable {
        let label: String?
        let contactName: String?
        let contactPhone: String?
        let addressLine: String?
        let pin: Pin?

        var line: String { [addressLine, contactName, contactPhone].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ") }
    }

    struct CollectFrom: Decodable, Hashable, Sendable {
        let name: String
        let addressLine: String
    }

    let key: String
    let orderId: Int
    let reference: String
    let vendorName: String?
    let destination: Address?
    let orderAddress: Address
    let lines: [Line]
    let state: String
    let vehicle: String?
    let courierId: Int?
    let courierName: String?
    let items: Int
    let paymentMethod: String?
    let paymentCollectedAt: Date?
    let orderTotal: Money
    let collectFrom: CollectFrom?
    let member: Bool?

    var id: String { "\(orderId)-\(key)" }

    /// `courierMoves`: collected from preparing, handed over once collected.
    var courierMoves: [String] {
        switch state {
        case "preparing": return ["shipped"]
        case "shipped": return ["delivered"]
        default: return []
        }
    }
}

struct DispatchBoard: Decodable, Sendable {
    let parcels: [BoardParcel]
    let truncated: Bool
}

struct DeliveryCompany: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let name: String
    let status: String
}

struct DeliveryScores: Decodable, Sendable {
    struct Score: Decodable, Hashable, Sendable {
        let courierId: Int?
        let courierName: String?
        let count: Int
        let average: Double
    }

    struct Recent: Decodable, Hashable, Sendable {
        let rating: Int
        let comment: String?
        let createdAt: Date
        let vendorName: String?
    }

    let scores: [Score]
    let recent: [Recent]
}

struct SharingState: Decodable, Sendable {
    let sharing: Bool
}

// MARK: - Claims

struct DamageClaim: Decodable, Identifiable, Hashable, Sendable {
    struct Line: Decodable, Hashable, Sendable {
        let lineId: Int
        let productTitle: String
        let lineTotal: Money
    }

    let id: Int
    let reference: String
    let vendorName: String?
    let courierName: String?
    let filedAs: String
    let lines: [Line]
    let claimedAmount: Money
    let description: String
    let evidenceUrl: String?
    let courierResponse: String?
    let status: String
    let awardedAmount: Money?
    let decisionNote: String?
    let createdAt: Date
}

struct ClaimLedgerRow: Decodable, Hashable, Sendable {
    let courierId: Int?
    let courierName: String?
    let owed: Money
    let accepted: Int
    let open: Int
    let rejected: Int
}

// MARK: - Fulfilled by NetLet

struct FulfilmentCentre: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let name: String
    let governorate: String
    let addressLine: String
    let active: Bool
    let packFeePerUnit: String?
}

struct SendableVariant: Decodable, Identifiable, Hashable, Sendable {
    let variantId: Int
    let productTitle: String
    let variantTitle: String
    let sku: String?
    let stock: Int
    let centreId: Int?
    let preorderStock: Int

    var id: Int { variantId }
    var label: String { "\(productTitle) — \(variantTitle)" }
}

struct HeldVariant: Decodable, Identifiable, Hashable, Sendable {
    let variantId: Int
    let productTitle: String
    let variantTitle: String
    let sku: String?
    let stock: Int
    let vendorName: String?
    let centreName: String

    var id: Int { variantId }
}

struct InboundShipment: Decodable, Identifiable, Hashable, Sendable {
    struct Line: Decodable, Identifiable, Hashable, Sendable {
        let id: Int
        let productTitle: String
        let variantTitle: String
        let sku: String?
        let expected: Int
        let received: Int?
        let short: Int
        let over: Int
    }

    let id: Int
    let reference: String
    let vendorName: String?
    let centreName: String
    let status: String
    let note: String?
    let createdAt: Date
    let lines: [Line]
}

struct PackingCharge: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let reference: String
    let orderReference: String
    let vendorName: String?
    let centreName: String
    let createdAt: Date
    let units: Int
    let ratePerUnit: Money
    let amount: Money
    let deducted: Bool
}

struct PickList: Decodable, Sendable {
    struct Order: Decodable, Hashable, Sendable {
        struct Line: Decodable, Hashable, Sendable {
            let lineId: Int
            let vendorName: String?
            let productTitle: String
            let variantTitle: String?
            let sku: String?
            let quantity: Int
        }

        let orderId: Int
        let reference: String
        let placedAt: Date
        let centreId: Int
        let centreName: String
        let lines: [Line]
    }

    let orders: [Order]
    let truncated: Bool
}

struct Announced: Decodable, Sendable {
    let reference: String
}

struct Received: Decodable, Sendable {
    let received: Int
}

struct Packed: Decodable, Sendable {
    let packed: Int
}

// MARK: - Placements

struct AdBooking: Decodable, Identifiable, Hashable, Sendable {
    struct Banner: Decodable, Hashable, Sendable {
        let status: String?
        let imageUrl: String?
        let headline: String
        let headlineAr: String?
        let note: String?
        let permit: String
    }

    let id: Int
    let vendorName: String?
    let productTitle: String
    let productHandle: String?
    let slot: String
    let departmentName: String?
    let departmentNameAr: String?
    let startsOn: String
    let endsOn: String
    let cancelledOn: String?
    let dailyRate: Money
    let total: Money
    let state: String
    let accrued: Money
    let deducted: Money
    let cancellable: Bool
    let banner: Banner?
}

struct AdQuote: Decodable, Sendable {
    let cost: Money
    let dailyRate: Money
    let room: Money
    let problem: String?
    let fullDays: [String]
}

struct AdBooked: Decodable, Sendable {
    let total: Money
}

struct BannerReviewed: Decodable, Sendable {
    let status: String
}

struct ImportDone: Decodable, Sendable {
    let created: Int
}

extension API {
    // Bundles
    struct BundleMemberInput: Encodable, Sendable {
        let variantId: Int
        let quantity: Int
    }

    struct BundleInput: Encodable, Sendable {
        let name: String
        let vendorId: OrNull<Int>
        let bundlePrice: String
        let members: [BundleMemberInput]
    }

    struct ActiveFlag: Encodable, Sendable {
        let id: Int
        let active: Bool
    }

    static let bundleRows = Procedure<NoInput, [BundleRow]>(query: "inventory.bundles.list")
    static let saveBundle = Procedure<BundleInput, Acknowledged>(mutation: "inventory.bundles.save")
    static let setBundleActive = Procedure<ActiveFlag, Acknowledged>(mutation: "inventory.bundles.setActive")

    // Import
    struct ImportRow: Encodable, Sendable {
        let title: String
        let sku: String?
        let price: String
        let compareAtPrice: String?
        let stock: Int
        let category: String?
        let description: String
        let imageUrl: String?

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(title, forKey: .title)
            try container.encode(sku, forKey: .sku)
            try container.encode(price, forKey: .price)
            try container.encode(compareAtPrice, forKey: .compareAtPrice)
            try container.encode(stock, forKey: .stock)
            try container.encode(category, forKey: .category)
            try container.encode(description, forKey: .description)
            try container.encode(imageUrl, forKey: .imageUrl)
        }

        private enum CodingKeys: String, CodingKey { case title, sku, price, compareAtPrice, stock, category, description, imageUrl }
    }

    struct ImportInput: Encodable, Sendable {
        let vendorId: Int
        let rows: [ImportRow]
    }

    static let importProducts = Procedure<ImportInput, ImportDone>(mutation: "inventory.products.bulkCreate")

    // Dispatch
    struct BoardState: Encodable, Sendable {
        let state: String
    }

    struct ParcelMove: Encodable, Sendable {
        let orderId: Int
        let key: String
        let to: String
    }

    struct ParcelAssign: Encodable, Sendable {
        let orderId: Int
        let key: String
        let courierId: OrNull<Int>
    }

    struct Position: Encodable, Sendable {
        let lat: Double
        let lng: Double
        let accuracy: Double
    }

    static let dispatchBoard = Procedure<BoardState, DispatchBoard>(query: "dispatch.board")
    static let deliveryCompanies = Procedure<NoInput, [DeliveryCompany]>(query: "dispatch.couriers.list")
    static let deliveryScores = Procedure<NoInput, DeliveryScores>(query: "dispatch.scores")
    static let moveParcel = Procedure<ParcelMove, Acknowledged>(mutation: "dispatch.move")
    static let assignParcel = Procedure<ParcelAssign, Acknowledged>(mutation: "dispatch.assign")
    static let mySharing = Procedure<NoInput, SharingState>(query: "dispatch.mySharing")
    static let sharePosition = Procedure<Position, Acknowledged>(mutation: "dispatch.sharePosition")
    static let stopSharing = Procedure<NoInput, Acknowledged>(mutation: "dispatch.stopSharing")

    // Claims
    struct ClaimFilter: Encodable, Sendable {
        let status: String
    }

    struct ClaimResponse: Encodable, Sendable {
        let claimId: Int
        let response: String
    }

    struct ClaimDecision: Encodable, Sendable {
        let claimId: Int
        let outcome: String
        var awardedAmount: String?
        let note: OrNull<String>
    }

    static let damageClaims = Procedure<ClaimFilter, [DamageClaim]>(query: "dispatch.claims.list")
    static let claimLedger = Procedure<NoInput, [ClaimLedgerRow]>(query: "dispatch.claims.ledger")
    static let respondToClaim = Procedure<ClaimResponse, Acknowledged>(mutation: "dispatch.claims.respond")
    static let decideClaim = Procedure<ClaimDecision, Acknowledged>(mutation: "dispatch.claims.decide")

    // Fulfilled by NetLet
    struct VariantSearch: Encodable, Sendable {
        let query: String
    }

    struct InboundLine: Encodable, Sendable {
        let variantId: Int
        let quantity: Int
    }

    struct Announce: Encodable, Sendable {
        let centreId: Int
        let lines: [InboundLine]
        let note: OrNull<String>
    }

    struct ShipmentFilter: Encodable, Sendable {
        var status: String?
        let page: Int
    }

    struct Count: Encodable, Sendable {
        let lineId: Int
        let received: Int
    }

    struct Receipt: Encodable, Sendable {
        let id: Int
        let counts: [Count]
    }

    struct OrderCentre: Encodable, Sendable {
        let orderId: Int
        let centreId: Int
    }

    struct VariantRef: Encodable, Sendable {
        let variantId: Int
    }

    struct NewCentre: Encodable, Sendable {
        let name: String
        let governorate: String
        let addressLine: String
    }

    struct PackRate: Encodable, Sendable {
        let id: Int
        let rate: OrNull<String>
    }

    static let fulfilmentOpen = Procedure<NoInput, Bool>(query: "fulfilment.open")
    static let centres = Procedure<NoInput, [FulfilmentCentre]>(query: "fulfilment.centres")
    static let sendable = Procedure<VariantSearch, [SendableVariant]>(query: "fulfilment.sendable")
    static let heldStock = Procedure<PageOnly, PortalPageOf<HeldVariant>>(query: "fulfilment.held")
    static let shipments = Procedure<ShipmentFilter, PortalPageOf<InboundShipment>>(query: "fulfilment.shipments")
    static let packingCharges = Procedure<PageOnly, PortalPageOf<PackingCharge>>(query: "fulfilment.charges")
    static let pickList = Procedure<NoInput, PickList>(query: "fulfilment.pickList")
    static let announceShipment = Procedure<Announce, Announced>(mutation: "fulfilment.announce")
    static let cancelShipment = Procedure<RowId, Acknowledged>(mutation: "fulfilment.cancel")
    static let receiveShipment = Procedure<Receipt, Received>(mutation: "fulfilment.receive")
    static let markPacked = Procedure<OrderCentre, Packed>(mutation: "fulfilment.markPacked")
    static let returnToSeller = Procedure<VariantRef, Acknowledged>(mutation: "fulfilment.returnToSeller")
    static let createCentre = Procedure<NewCentre, Acknowledged>(mutation: "fulfilment.createCentre")
    static let setCentreActive = Procedure<ActiveFlag, Acknowledged>(mutation: "fulfilment.setCentreActive")
    static let setPackRate = Procedure<PackRate, Acknowledged>(mutation: "fulfilment.setPackRate")

    // Placements
    struct BookingPage: Encodable, Sendable {
        let page: Int
        var waiting: Bool?
    }

    struct AdAsk: Encodable, Sendable {
        let productId: Int
        let slot: String
        let startsOn: String
        let days: Int
    }

    struct BannerInput: Encodable, Sendable {
        let mediaId: String
        let headline: String
        let headlineAr: OrNull<String>
    }

    struct AdBook: Encodable, Sendable {
        let productId: Int
        let slot: String
        let startsOn: String
        let days: Int
        var banner: BannerInput?
    }

    struct BannerDecision: Encodable, Sendable {
        let id: Int
        let decision: String
        var note: String?
    }

    static let adBookings = Procedure<BookingPage, PortalPageOf<AdBooking>>(query: "ads.list")
    static let adQuote = Procedure<AdAsk, AdQuote>(query: "ads.quote")
    static let bookAd = Procedure<AdBook, AdBooked>(mutation: "ads.book")
    static let cancelAd = Procedure<RowId, Acknowledged>(mutation: "ads.cancel")
    static let reviewBanner = Procedure<BannerDecision, BannerReviewed>(mutation: "ads.reviewBanner")
}
