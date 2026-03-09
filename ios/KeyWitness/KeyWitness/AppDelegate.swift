import UIKit
import UserNotifications

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {

        let vc = MainViewController()

        // Set notification delegate BEFORE the window is visible so notification
        // taps that cold-launch the app are always handled.
        UNUserNotificationCenter.current().delegate = vc

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = vc
        window.makeKeyAndVisible()
        self.window = window

        return true
    }
}
