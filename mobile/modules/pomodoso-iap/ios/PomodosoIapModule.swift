import ExpoModulesCore
import StoreKit

/// Direct StoreKit 2 access, with no billing service in between.
///
/// Deliberately thin. It fetches products, runs the purchase sheet, and hands
/// JavaScript the signed JWS that Apple produced — nothing more. It does not
/// decide who is Pro: that is settled by the backend once it has verified the
/// signature against Apple's root certificate, because a client that grants
/// itself access is a client that can be made to grant itself access.
///
/// The one rule that matters here: a transaction is finished only after the
/// backend has accepted it. StoreKit re-delivers anything left unfinished on
/// the next launch, which turns a dropped network call or a crash mid-purchase
/// into a retry instead of a customer who paid and got nothing.
public final class PomodosoIapModule: Module {
  private var updates: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("PomodosoIap")

    // Fires for renewals, Ask-to-Buy approvals, purchases made on another
    // device, and anything left unfinished last run.
    Events("onTransaction")

    AsyncFunction("getProducts") { (ids: [String]) -> [[String: Any]] in
      try await Product.products(for: ids).map(Self.serialize)
    }

    AsyncFunction("purchase") { (productId: String, appAccountToken: String) -> [String: Any] in
      guard let product = try await Product.products(for: [productId]).first else {
        throw ProductNotFoundException(productId)
      }
      // Apple carries this UUID inside every signed payload about this
      // purchase, for as long as it exists. It is the only thing tying an
      // Apple ID to one of our accounts.
      guard let token = UUID(uuidString: appAccountToken) else {
        throw InvalidAccountTokenException(appAccountToken)
      }

      switch try await product.purchase(options: [.appAccountToken(token)]) {
      case .success(let verification):
        return ["status": "purchased", "transaction": Self.serialize(verification)]

      // Not an error, and the most common outcome of opening a paywall.
      case .userCancelled:
        return ["status": "cancelled"]

      // Ask to Buy, or a payment method needing action. The purchase may
      // complete hours later and will arrive through `onTransaction`.
      case .pending:
        return ["status": "pending"]

      @unknown default:
        return ["status": "failed"]
      }
    }

    /// Explicit "Restore purchases". `AppStore.sync()` raises an App Store
    /// password prompt, which is acceptable only for a deliberate user action —
    /// never on launch.
    AsyncFunction("restore") { () -> [[String: Any]] in
      try await AppStore.sync()
      return await Self.entitlements()
    }

    /// Everything this Apple ID currently owns. Silent, so it is safe to call
    /// on launch or after signing in.
    AsyncFunction("currentEntitlements") { () -> [[String: Any]] in
      await Self.entitlements()
    }

    /// Tells StoreKit the purchase has been delivered. Until this is called,
    /// Apple keeps handing the transaction back.
    AsyncFunction("finish") { (transactionId: String) in
      for await result in StoreKit.Transaction.unfinished
      where String(Self.payload(result).id) == transactionId {
        await Self.payload(result).finish()
      }
    }

    OnStartObserving { self.listen() }
    OnStopObserving {
      self.updates?.cancel()
      self.updates = nil
    }
  }

  /// Watches for transactions that arrive outside a purchase call.
  ///
  /// Without this a renewal that happens while the app is closed, or a
  /// purchase approved by a parent an hour later, would never reach the
  /// backend from this device.
  private func listen() {
    updates?.cancel()
    updates = Task { [weak self] in
      for await result in StoreKit.Transaction.updates {
        guard let self else { return }
        self.sendEvent("onTransaction", Self.serialize(result))
      }
    }
  }

  private static func entitlements() async -> [[String: Any]] {
    var out: [[String: Any]] = []
    for await result in StoreKit.Transaction.currentEntitlements {
      out.append(serialize(result))
    }
    return out
  }

  /// Reads the transaction whether or not StoreKit could verify it locally.
  ///
  /// Skipping the local check is intentional, not sloppy: the JWS goes to our
  /// backend, which verifies it against Apple's pinned root. Trusting the
  /// device's answer would put the decision on the device.
  private static func payload<T>(_ result: VerificationResult<T>) -> T {
    switch result {
    case .verified(let value): return value
    case .unverified(let value, _): return value
    }
  }

  private static func serialize(_ result: VerificationResult<StoreKit.Transaction>) -> [String: Any] {
    let transaction = payload(result)
    return [
      "id": String(transaction.id),
      "productId": transaction.productID,
      // The whole point: Apple's signature over this purchase, for the backend.
      "jws": result.jwsRepresentation,
    ]
  }

  private static func serialize(_ product: Product) -> [String: Any] {
    var out: [String: Any] = [
      "id": product.id,
      "title": product.displayName,
      "description": product.description,
      // Already localised, in the store's currency. Formatting this ourselves
      // is how you show dollars to someone paying in euros.
      "price": product.displayPrice,
    ]

    if let period = product.subscription?.subscriptionPeriod {
      out["period"] = Self.unitName(period.unit)
      out["periodCount"] = period.value
    }

    return out
  }

  private static func unitName(_ unit: Product.SubscriptionPeriod.Unit) -> String {
    switch unit {
    case .day: return "day"
    case .week: return "week"
    case .month: return "month"
    case .year: return "year"
    @unknown default: return "unknown"
    }
  }
}

private final class ProductNotFoundException: GenericException<String> {
  override var reason: String {
    "the App Store has no product with id \(param) — check it is approved and available in this storefront"
  }
}

private final class InvalidAccountTokenException: GenericException<String> {
  override var reason: String {
    "appAccountToken must be a UUID, got \(param)"
  }
}
