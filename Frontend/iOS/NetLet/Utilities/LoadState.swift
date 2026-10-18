import Foundation

/// The three answers a screen can be waiting on, and the one before asking.
///
/// A failed load is its own state rather than an empty value: an empty list
/// reads as "there is nothing here", and a list that failed to load is not
/// that — the web's `QueryGate` rule.
enum LoadState<Value> {
    case idle
    case loading
    case loaded(Value)
    case failed(APIError)

    var value: Value? {
        if case .loaded(let value) = self { return value }
        return nil
    }

    var error: APIError? {
        if case .failed(let error) = self { return error }
        return nil
    }

    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }
}
