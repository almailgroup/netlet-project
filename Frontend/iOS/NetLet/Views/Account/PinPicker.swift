import CoreLocation
import MapKit
import SwiftUI

/// Where the door is, on Apple's own map — the web's `PinPicker`.
///
/// **The map moves under a still pin**, the web's rule: one instruction serves
/// a thumb, and a tap brings the spot tapped to the pin. A pin is optional and
/// the typed address is not — somebody who would rather not say where they
/// live, or whose location is refused, can still buy. It is kept to five
/// decimals and refused outside Kuwait, `pinProblem`'s rule.
struct PinPickerSheet: View {
    let start: Pin
    let onPick: (Pin) -> Void
    @State private var position: MapCameraPosition
    @State private var centre: CLLocationCoordinate2D
    @State private var finder: LocationFinder
    @Environment(\.dismiss) private var dismiss
    @Environment(LanguageSettings.self) private var l

    init(start: Pin, onPick: @escaping (Pin) -> Void) {
        self.start = start
        self.onPick = onPick
        let coordinate = CLLocationCoordinate2D(latitude: start.lat, longitude: start.lng)
        _centre = State(initialValue: coordinate)
        _position = State(initialValue: .region(MKCoordinateRegion(center: coordinate, latitudinalMeters: 900, longitudinalMeters: 900)))
        // Made here rather than as the property's initial value, which Swift 5
        // mode evaluates outside the main actor this object belongs to.
        _finder = State(initialValue: LocationFinder())
    }

    private var chosen: Pin { Pin(lat: centre.latitude, lng: centre.longitude).rounded }

    var body: some View {
        NavigationStack {
            MapReader { proxy in
                Map(position: $position) {
                    UserAnnotation()
                }
                .mapStyle(.standard(pointsOfInterest: .excludingAll))
                .mapControls { MapCompass() }
                .onMapCameraChange(frequency: .continuous) { context in centre = context.region.center }
                .onTapGesture { point in
                    guard let coordinate = proxy.convert(point, from: .local) else { return }
                    withAnimation(.easeInOut(duration: 0.3)) {
                        position = .region(MKCoordinateRegion(center: coordinate, latitudinalMeters: 600, longitudinalMeters: 600))
                    }
                }
                // A picture of the ground: its controls are not mirrored on the Arabic page.
                .environment(\.layoutDirection, .leftToRight)
                .overlay {
                    Image(systemName: "mappin")
                        .font(.system(size: 40, weight: .semibold))
                        .foregroundStyle(Brand.orange)
                        .shadow(color: .black.opacity(0.25), radius: 2, y: 2)
                        .offset(y: -20)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .ignoresSafeArea(edges: .bottom)
            .safeAreaInset(edge: .bottom) { controls }
            .navigationTitle(l.t("pin.drop"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(l.t("pin.cancel")) { dismiss() }
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
        }
        .environment(\.layoutDirection, l.layoutDirection)
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(l.t("pin.howTo"))
                .font(.inter(13))
                .foregroundStyle(Brand.body)
                .fixedSize(horizontal: false, vertical: true)
            if let state = finder.problem {
                Text(l.t(state)).font(.footnote).foregroundStyle(Brand.danger)
            }
            if let problem = chosen.problem() {
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
                Button(l.t("pin.confirm")) {
                    onPick(chosen)
                    dismiss()
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(chosen.problem() != nil)
            }
        }
        .padding(16)
        .background(.regularMaterial)
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
