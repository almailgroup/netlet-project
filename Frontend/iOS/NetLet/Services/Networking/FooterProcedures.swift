import Foundation

/// The pages the footer leads to — help, guides, gift lists and selling — as
/// the procedures of `Backend/src/routes/{help,guides,wishlists,inventory}.ts`.
extension API {
    struct OrderLookup: Encodable, Sendable {
        let reference: String
        let email: String
    }

    struct GuideSlug: Encodable, Sendable {
        let slug: String
    }

    struct GiftToken: Encodable, Sendable {
        let token: String
    }

    struct Phone: Encodable, Sendable {
        let phone: String
    }

    struct GiftClaim: Encodable, Sendable {
        let token: String
        let productId: String
    }

    /// The application as the form sends it; a blank box is sent as null.
    struct ApplicationInput: Encodable, Sendable {
        let storeName: String
        let storeNameAr: String?
        let contactEmail: String?
        let contactPhone: String?
        let governorate: String?
        let addressLine: String?
        let licenceNumber: String?
        let licenceDocUrl: String?
        let identityDocUrl: String?
        let payoutIban: String?
        let underPlatformLicence: Bool
        let agreementVersion: String?
        let proposedCommissionPercent: String?
        let commissionNote: String?

        private enum CodingKeys: String, CodingKey {
            case storeName, storeNameAr, contactEmail, contactPhone, governorate, addressLine, licenceNumber
            case licenceDocUrl, identityDocUrl, payoutIban, underPlatformLicence, agreementVersion
            case proposedCommissionPercent, commissionNote
        }

        /// Every field is sent, a blank one as null, so clearing a box clears it on the server.
        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(storeName, forKey: .storeName)
            try container.encode(storeNameAr, forKey: .storeNameAr)
            try container.encode(contactEmail, forKey: .contactEmail)
            try container.encode(contactPhone, forKey: .contactPhone)
            try container.encode(governorate, forKey: .governorate)
            try container.encode(addressLine, forKey: .addressLine)
            try container.encode(licenceNumber, forKey: .licenceNumber)
            try container.encode(licenceDocUrl, forKey: .licenceDocUrl)
            try container.encode(identityDocUrl, forKey: .identityDocUrl)
            try container.encode(payoutIban, forKey: .payoutIban)
            try container.encode(underPlatformLicence, forKey: .underPlatformLicence)
            try container.encode(agreementVersion, forKey: .agreementVersion)
            try container.encode(proposedCommissionPercent, forKey: .proposedCommissionPercent)
            try container.encode(commissionNote, forKey: .commissionNote)
        }
    }

    /// Answers null for a pair that names no order, whichever half was wrong.
    static let lookupOrder = Procedure<OrderLookup, LookedUpOrder?>(mutation: "help.lookupOrder")
    static let guides = Procedure<NoInput, [GuideCard]>(query: "guides.published")
    static let guide = Procedure<GuideSlug, Guide?>(query: "guides.bySlug")
    static let giftList = Procedure<GiftToken, GiftList?>(query: "wishlists.byToken")
    static let giftListsByPhone = Procedure<Phone, [GiftList]>(query: "wishlists.findByPhone")
    static let claimGift = Procedure<GiftClaim, Acknowledged>(mutation: "wishlists.claim")
    static let releaseGift = Procedure<GiftClaim, Acknowledged>(mutation: "wishlists.release")
    static let myApplication = Procedure<NoInput, StoreApplication?>(query: "inventory.applications.mine")
    static let saveApplication = Procedure<ApplicationInput, Acknowledged>(mutation: "inventory.applications.save")
    static let submitApplication = Procedure<NoInput, Acknowledged>(mutation: "inventory.applications.submit")
    static let applicationDocuments = Procedure<NoInput, [ApplicationDocument]>(query: "inventory.applications.myDocuments")
    static let removeApplicationDocument = Procedure<RowId, Acknowledged>(mutation: "inventory.applications.removeDocument")
}
