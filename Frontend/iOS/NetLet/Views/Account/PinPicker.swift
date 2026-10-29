import CoreLocation
import MapKit
import SwiftUI

/// The pin card at the top of an address form: drop one and the area, block
/// and street fill themselves, move it, or take it away — the web's
/// `PinPicker`, the same card in the address book and the delivery sheet.
struct PinField: View {
    let pin: Pin?
    /// What was read at the pin, when it was dropped here.
    let place: PlaceAnswer?
    let governorate: String?
    /// Whether the map is open — the form's, so it can open it for the screenshots.
    @Binding var picking: Bool
    /// The pin, and what was read there (nil when nothing could be).
    let onChange: (Pin?, PlaceAnswer?) -> Void
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let pin {
                // Where the address was saved, on a still map — on the owner's
                // word — and a press on it opens the map at the pin to move
                // it. "Move the pin" below is the same act for VoiceOver, so
                // the map is not a second element to it.
                Button { picking = true } label: {
                    StillPinMap(pin: pin)
                        .frame(height: 180)
                        .allowsHitTesting(false)
                        .overlay(alignment: .top) {
                            Label(l.t("pin.tapToMove"), systemImage: "hand.tap")
                                .font(.inter(12, .heavy))
                                .foregroundStyle(Brand.navy)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 7)
                                .background(Capsule().fill(Color.white.opacity(0.95)))
                                .shadow(color: Brand.navy.opacity(0.18), radius: 5, y: 2)
                                .padding(.top, 8)
                                .environment(\.layoutDirection, l.layoutDirection)
                        }
                        .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(.tap)
                .accessibilityHidden(true)
                let line = place.map { $0.parts.line(l.current) } ?? ""
                Label {
                    Text(line.isEmpty ? l.t("pin.pinned") : l.t("pin.pinnedAt", ["place": "\u{2068}\(line)\u{2069}"]))
                        .font(.inter(14, .semibold))
                        .foregroundStyle(Brand.navy)
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "mappin.circle.fill").foregroundStyle(Brand.accentInk)
                }
                HStack(spacing: 10) {
                    Button(l.t("pin.move")) { picking = true }
                        .buttonStyle(SecondaryButtonStyle())
                    Button(l.t("pin.remove")) { onChange(nil, nil) }
                        .buttonStyle(SecondaryButtonStyle())
                }
            } else {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "mappin.and.ellipse")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Brand.accentInk)
                        .frame(width: 44, height: 44)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Brand.accentWash))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(l.t("pin.findTitle")).font(.inter(15, .heavy)).foregroundStyle(Brand.navy)
                        Text(l.t("pin.findNote"))
                            .font(.inter(13))
                            .foregroundStyle(Brand.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Button {
                    picking = true
                } label: {
                    Label(l.t("pin.drop"), systemImage: "mappin")
                }
                .buttonStyle(PrimaryButtonStyle())
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
        .fullScreenCover(isPresented: $picking) {
            PinPickerSheet(start: pin ?? startingPin, zoomedIn: pin != nil) { picked, read in onChange(picked, read) }
        }
    }

    /// Where the map opens: the pin, or the middle of the governorate, or of Kuwait.
    private var startingPin: Pin {
        let reference = ReferenceData.shared
        return governorate.flatMap { reference.governorateCentres[$0] } ?? reference.centre
    }
}

/// The pin itself, its point on the middle of whatever holds it: an orange
/// drop with a navy rim, a shadow at the point, and a ring where it lands.
///
/// **It lifts while the map moves and drops back with a squash and a bounce
/// when the map rests** — the web's `PinMark`, on the owner's word. Under
/// Reduce Motion it neither lifts nor bounces; the ring is not drawn.
struct PinMark: View {
    var lifted = false
    /// Counts the drops; each new one plays the bounce and the ring.
    var drop = 0
    @Environment(\.accessibilityReduceMotion) private var still

    private struct Squash {
        var x: CGFloat = 1
        var y: CGFloat = 1
    }

    private struct Ring {
        var scale: CGFloat = 0.2
        var opacity: Double = 0
    }

    var body: some View {
        let up = lifted && !still
        let trigger = still ? 0 : drop
        ZStack {
            Ellipse()
                .fill(Brand.navy.opacity(0.32))
                .frame(width: 18, height: 6)
                .blur(radius: 1.5)
                .scaleEffect(up ? 0.6 : 1)
                .opacity(up ? 0.5 : 1)
            Circle()
                .strokeBorder(Brand.orange, lineWidth: 2)
                .frame(width: 44, height: 44)
                .keyframeAnimator(initialValue: Ring(), trigger: trigger) { content, value in
                    content.scaleEffect(value.scale).opacity(value.opacity)
                } keyframes: { _ in
                    KeyframeTrack(\.scale) {
                        LinearKeyframe(0.2, duration: 0.01)
                        CubicKeyframe(1.4, duration: 0.7)
                    }
                    KeyframeTrack(\.opacity) {
                        LinearKeyframe(0.75, duration: 0.01)
                        CubicKeyframe(0, duration: 0.7)
                    }
                }
            teardrop
                .keyframeAnimator(initialValue: Squash(), trigger: trigger) { content, value in
                    content.scaleEffect(x: value.x, y: value.y, anchor: .bottom)
                } keyframes: { _ in
                    KeyframeTrack(\.y) {
                        CubicKeyframe(0.88, duration: 0.14)
                        CubicKeyframe(1.03, duration: 0.12)
                        CubicKeyframe(1, duration: 0.16)
                    }
                    KeyframeTrack(\.x) {
                        CubicKeyframe(1.08, duration: 0.14)
                        CubicKeyframe(0.98, duration: 0.12)
                        CubicKeyframe(1, duration: 0.16)
                    }
                }
                // The drop's point is the spot: its body stands on the middle.
                .offset(y: -23 + (up ? -14 : 0))
                .shadow(color: Brand.navy.opacity(0.25), radius: 2, y: 2)
        }
        .frame(width: 60, height: 60)
        .animation(still ? nil : .spring(response: 0.25, dampingFraction: 0.7), value: up)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// A drop pointing down: SF Symbols' own drop, turned over, with a white eye.
    private var teardrop: some View {
        ZStack {
            Image(systemName: "drop.fill")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .foregroundStyle(Brand.orange)
            Image(systemName: "drop")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .fontWeight(.semibold)
                .foregroundStyle(Brand.navy)
            Circle()
                .fill(Color.white)
                .overlay(Circle().strokeBorder(Brand.navy, lineWidth: 2))
                .frame(width: 13, height: 13)
                .offset(y: 7)
        }
        .frame(width: 32, height: 46)
        .rotationEffect(.degrees(180))
    }
}

/// Where the door is, on Apple's own map — the web's `PinPicker`.
///
/// **The map moves under a still pin**, the web's rule: one instruction serves
/// a thumb, and a tap brings the spot tapped to the pin. While it moves the pin
/// lifts; when it rests the pin drops with a buzz at three quarters strength
/// (`Haptics.pinDrop`), and once it has rested a moment the address there is
/// read (`maps.placeAt`) and named in a bubble over the pin. "Pin it here"
/// hands the form the pin and that address, waiting a moment for one on its
/// way. A pin is optional and the typed address is not; it is kept to five
/// decimals and refused outside Kuwait, `pinProblem`'s rule.
///
/// **Where the map is during a move is never state**, only whether it moves:
/// the centre goes to a box nothing watches, so a drag redraws nothing but the
/// pin lifting once and dropping once.
struct PinPickerSheet: View {
    let start: Pin
    var zoomedIn = true
    let onPick: (Pin, PlaceAnswer?) -> Void
    @State private var position: MapCameraPosition
    @State private var camera = CameraBox()
    @State private var settled: Pin
    @State private var finder: LocationFinder
    @State private var lifted = false
    @State private var drops = 0
    @State private var reading: Reading?
    @State private var lookup: Task<Void, Never>?
    @State private var pinning = false
    @State private var openedAt = Date()
    /// The satellite view, where somebody finds their own roof — the web's
    /// map/satellite control. Places are named on both.
    @State private var satellite = false
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    /// The map's middle as it moves: a reference nothing observes.
    final class CameraBox {
        var centre = CLLocationCoordinate2D()
    }

    struct Reading: Equatable {
        enum Phase: Equatable {
            case reading
            case read(PlaceAnswer?)
            case failed(String)
        }
        let key: String
        var state: Phase
    }

    init(start: Pin, zoomedIn: Bool = true, onPick: @escaping (Pin, PlaceAnswer?) -> Void) {
        self.start = start
        self.zoomedIn = zoomedIn
        self.onPick = onPick
        let coordinate = CLLocationCoordinate2D(latitude: start.lat, longitude: start.lng)
        let metres: CLLocationDistance = zoomedIn ? 600 : 4000
        _position = State(initialValue: .region(MKCoordinateRegion(center: coordinate, latitudinalMeters: metres, longitudinalMeters: metres)))
        _settled = State(initialValue: start)
        // Made here rather than as the property's initial value, which Swift 5
        // mode evaluates outside the main actor this object belongs to.
        _finder = State(initialValue: LocationFinder())
    }

    private static func key(_ pin: Pin) -> String {
        let kept = pin.rounded
        return String(format: "%.5f,%.5f", kept.lat, kept.lng)
    }

    var body: some View {
        NavigationStack {
            MapReader { proxy in
                Map(position: $position) {
                    UserAnnotation()
                }
                .mapStyle(satellite ? .hybrid(elevation: .flat, pointsOfInterest: .all) : .standard(elevation: .flat, pointsOfInterest: .all))
                .mapControls { MapCompass() }
                .onMapCameraChange(frequency: .continuous) { context in
                    camera.centre = context.region.center
                    if !lifted, Date().timeIntervalSince(openedAt) > 0.5 {
                        lookup?.cancel()
                        lifted = true
                    }
                }
                .onMapCameraChange(frequency: .onEnd) { context in
                    camera.centre = context.region.center
                    let here = Pin(lat: context.region.center.latitude, lng: context.region.center.longitude)
                    settled = here
                    if lifted {
                        lifted = false
                        drops += 1
                        Haptics.pinDrop()
                    }
                    read(here)
                }
                .onTapGesture { point in
                    guard let coordinate = proxy.convert(point, from: .local) else { return }
                    withAnimation(.easeInOut(duration: 0.3)) {
                        position = .region(MKCoordinateRegion(center: coordinate, latitudinalMeters: 600, longitudinalMeters: 600))
                    }
                }
                // A picture of the ground: its controls are not mirrored on the Arabic page.
                .environment(\.layoutDirection, .leftToRight)
                .overlay { PinMark(lifted: lifted, drop: drops) }
                .overlay { bubble }
                .overlay(alignment: .top) { viewSwitch }
            }
            .ignoresSafeArea(edges: .bottom)
            .safeAreaInset(edge: .bottom) { controls }
            .navigationTitle(l.t("pin.drop"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    BarButton(l.t("common.close")) { dismiss() }
                        .accessibilityLabel(l.t("pin.cancel"))
                }
            }
            .onChange(of: finder.found) { _, found in
                guard let found else { return }
                withAnimation(.easeInOut(duration: 0.4)) {
                    position = .region(MKCoordinateRegion(
                        center: CLLocationCoordinate2D(latitude: found.lat, longitude: found.lng),
                        latitudinalMeters: 400,
                        longitudinalMeters: 400
                    ))
                }
            }
            .onAppear { openedAt = Date() }
            .onDisappear { lookup?.cancel() }
        }
        .environment(\.layoutDirection, l.layoutDirection)
    }

    /// Map or satellite, in a pill over the top of the map.
    private var viewSwitch: some View {
        HStack(spacing: 2) {
            ForEach([false, true], id: \.self) { on in
                Button {
                    guard satellite != on else { return }
                    withAnimation(.easeInOut(duration: 0.2)) { satellite = on }
                } label: {
                    Text(l.t(on ? "ios.pin.satellite" : "ios.pin.standard"))
                        .font(.inter(13, satellite == on ? Inter.Weight.heavy : Inter.Weight.semibold))
                        .foregroundStyle(satellite == on ? Color.white : Brand.navy)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 34)
                        .background(Capsule().fill(satellite == on ? Brand.navy : Color.clear))
                        .contentShape(Capsule())
                }
                .buttonStyle(.tap)
                .accessibilityAddTraits(satellite == on ? .isSelected : [])
            }
        }
        .padding(3)
        .background(Capsule().fill(Color.white.opacity(0.96)))
        .shadow(color: Brand.navy.opacity(0.18), radius: 6, y: 2)
        .padding(.top, 10)
        .environment(\.layoutDirection, l.layoutDirection)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("ios.pin.view"))
    }

    private var current: Reading? {
        reading.flatMap { $0.key == Self.key(settled) ? $0 : nil }
    }

    private var found: PlaceAnswer? {
        if case .read(let place)? = current?.state { return place }
        return nil
    }

    /// What is at the pin, in a plate over it; hidden while the map moves,
    /// since it would name a spot the pin has already left.
    @ViewBuilder
    private var bubble: some View {
        if !lifted {
            let line = found.map { $0.parts.line(l.current) } ?? ""
            let words: (text: String, busy: Bool, muted: Bool) = {
                switch current?.state {
                case .none, .reading?: return (l.t("pin.finding"), true, false)
                case .failed(let key)?: return (l.t(key), false, true)
                case .read?: return line.isEmpty ? (l.t("pin.nothingHere"), false, true) : (line, false, false)
                }
            }()
            HStack(spacing: 6) {
                if words.busy { ProgressView().controlSize(.mini).tint(Brand.navy) }
                Text(words.text)
                    .font(.inter(13, words.muted ? Inter.Weight.semibold : Inter.Weight.bold))
                    .foregroundStyle(words.muted ? Brand.muted : Brand.navy)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.white)
                    .shadow(color: Brand.navy.opacity(0.18), radius: 9, y: 4)
            )
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(Color.white)
                    .frame(width: 10, height: 10)
                    .rotationEffect(.degrees(45))
                    .offset(y: 5)
            }
            .frame(maxWidth: 300)
            .environment(\.layoutDirection, l.layoutDirection)
            // Its foot sits above the pin's head: a zero-height frame at the
            // middle, the plate standing on it.
            .padding(.bottom, 62)
            .frame(height: 0, alignment: .bottom)
            .transition(.opacity)
            .allowsHitTesting(false)
            .accessibilityElement(children: .combine)
        }
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(l.t("pin.howTo"))
                .font(.inter(13))
                .foregroundStyle(Brand.body)
                .fixedSize(horizontal: false, vertical: true)
            if let found {
                Text(l.t(found.source == "apple" ? "pin.fromApple" : "pin.fromOsm"))
                    .font(.inter(12))
                    .foregroundStyle(Brand.muted)
            }
            if let state = finder.problem {
                Text(l.t(state)).font(.footnote).foregroundStyle(Brand.danger)
            }
            if let problem = settled.problem() {
                FieldProblem(key: problem)
            }
            HStack(spacing: 10) {
                Button {
                    finder.locate()
                } label: {
                    if finder.locating {
                        HStack(spacing: 6) { ProgressView().tint(Brand.navy); Text(l.t("pin.locating")) }
                    } else {
                        Label(l.t("pin.useLocation"), systemImage: "location")
                    }
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(finder.locating)
                Button {
                    Task { await confirm() }
                } label: {
                    if pinning {
                        HStack(spacing: 6) { ProgressView().tint(.white); Text(l.t("pin.pinning")) }
                    } else {
                        Text(l.t("pin.confirm"))
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(settled.problem() != nil || pinning || lifted)
            }
        }
        .padding(16)
        .background(.regularMaterial)
    }

    /// Reads the address at `pin` once the map has rested a moment.
    private func read(_ pin: Pin) {
        lookup?.cancel()
        let key = Self.key(pin)
        if reading?.key == key, case .read? = reading?.state { return }
        reading = Reading(key: key, state: .reading)
        lookup = Task {
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            let answer = await fetch(pin)
            guard !Task.isCancelled else { return }
            reading = Reading(key: key, state: answer)
            if case .read(let place?) = answer {
                UIAccessibility.post(notification: .announcement, argument: place.parts.line(l.current))
            }
        }
    }

    private func fetch(_ pin: Pin) async -> Reading.Phase {
        let kept = pin.rounded
        do {
            let place = try await app.services.api.call(API.placeAt, .init(lat: kept.lat, lng: kept.lng, locale: l.current.rawValue))
            return .read(place)
        } catch {
            let message = (error as? APIError)?.serverMessage
            return .failed(message == "pin.lookupTooMany" ? "pin.lookupTooMany" : "pin.lookupFailed")
        }
    }

    private func confirm() async {
        let pin = settled.rounded
        guard pin.problem() == nil else { return }
        if let current {
            switch current.state {
            case .read(let place):
                finish(pin, place)
                return
            case .failed:
                finish(pin, nil)
                return
            case .reading:
                break
            }
        }
        // The address for this spot is still on its way: wait a moment for it.
        pinning = true
        let waiting = Task { await fetch(pin) }
        let timer = Task {
            try? await Task.sleep(for: .seconds(4))
            waiting.cancel()
        }
        let answer = await waiting.value
        timer.cancel()
        pinning = false
        if case .read(let place) = answer { finish(pin, place) } else { finish(pin, nil) }
    }

    private func finish(_ pin: Pin, _ place: PlaceAnswer?) {
        lookup?.cancel()
        onPick(pin, place)
        dismiss()
    }
}

/// The device's location, asked once and only when pressed for.
@Observable
@MainActor
final class LocationFinder: NSObject, CLLocationManagerDelegate {
    private(set) var found: Pin?
    private(set) var locating = false
    /// `pin.denied` or `pin.notFound`, said where the press was.
    private(set) var problem: String?
    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
    }

    func locate() {
        problem = nil
        switch manager.authorizationStatus {
        case .denied, .restricted:
            problem = "pin.denied"
        case .notDetermined:
            locating = true
            manager.requestWhenInUseAuthorization()
        default:
            locating = true
            manager.requestLocation()
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            guard self.locating else { return }
            switch status {
            case .authorizedWhenInUse, .authorizedAlways: self.manager.requestLocation()
            case .denied, .restricted:
                self.locating = false
                self.problem = "pin.denied"
            default: break
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let coordinate = locations.last?.coordinate
        Task { @MainActor in
            self.locating = false
            if let coordinate {
                self.found = Pin(lat: coordinate.latitude, lng: coordinate.longitude)
            } else {
                self.problem = "pin.notFound"
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            self.locating = false
            self.problem = "pin.notFound"
        }
    }
}

/// The pin on a map that does not move — what "Is this your address?" shows.
struct StillPinMap: View {
    let pin: Pin
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let coordinate = CLLocationCoordinate2D(latitude: pin.lat, longitude: pin.lng)
        Map(initialPosition: .region(MKCoordinateRegion(center: coordinate, latitudinalMeters: 400, longitudinalMeters: 400)), interactionModes: [])
            .mapStyle(.standard(elevation: .flat, pointsOfInterest: .all))
            // Its position is only its first: a moved pin is a new map.
            .id("\(pin.lat),\(pin.lng)")
            .environment(\.layoutDirection, .leftToRight)
            .overlay { PinMark() }
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(l.t("address.confirmMap"))
    }
}
