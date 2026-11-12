import Foundation

/// What the Profile tab's own search finds — `accountPlacesMatching` in
/// `Shared/commerce/accountSearch.ts`, over the same list (`ACCOUNT_PLACES`,
/// exported in `rules.json`): a place by its name, the page it is on and the
/// words it answers to, in both languages, so "password" finds the password
/// on either page. A place whose own name answers comes first, then one found
/// by its page or its words, each in the list's order.
enum AccountSearch {
    typealias Place = Rules.Account.Place

    static func matching(_ term: String, in places: [Place], has: (String) -> Bool, words: Phrasebook = .shared) -> [Place] {
        let found = places.filter { place in
            (place.needs.map(has) ?? true) && SearchRank.textsMatch(texts(of: place, words), term)
        }
        let named: (Place) -> Bool = { place in
            SearchRank.textsMatch([words.text(place.label, language: .en), words.text(place.label, language: .ar)], term)
        }
        return found.filter(named) + found.filter { !named($0) }
    }

    /// A place's words in both languages: what it is called, the page it is on, the words it answers to.
    private static func texts(of place: Place, _ words: Phrasebook) -> [String?] {
        ([place.label] + [place.within].compactMap { $0 } + place.words)
            .flatMap { [words.text($0, language: .en), words.text($0, language: .ar)] }
    }
}
