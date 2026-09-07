#if canImport(SwiftUI)
import Location
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Location denied or restricted (spec US1 scenario 6): explains what is needed and opens Settings.
public struct PermissionView: View {
    private let status: LocationAuthorization

    public init(status: LocationAuthorization) {
        self.status = status
    }

    public var body: some View {
        ContentUnavailableView {
            Label("Location access needed", systemImage: "location.slash")
        } description: {
            Text(description)
        } actions: {
            if let url = settingsURL {
                Link("Open Settings", destination: url)
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("walk.openSettings")
            }
        }
        .accessibilityIdentifier("walk.permissionDenied")
    }

    private var description: String {
        switch status {
        case .restricted:
            "Location is restricted on this device, so walks cannot be recorded."
        default:
            "Nature Explorer records your path only while a walk you started is running (\"While Using the App\"). "
                + "Allow location access in Settings to start walking."
        }
    }

    private var settingsURL: URL? {
        #if canImport(UIKit)
        URL(string: UIApplication.openSettingsURLString)
        #else
        nil
        #endif
    }
}
#endif
