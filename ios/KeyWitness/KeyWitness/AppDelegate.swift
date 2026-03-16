import UIKit
import UserNotifications

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {

        let window = UIWindow(frame: UIScreen.main.bounds)
        self.window = window

        let defaults = UserDefaults(suiteName: "group.io.keywitness")
        let hasCompletedOnboarding = defaults?.bool(forKey: "hasCompletedOnboarding") ?? false

        if hasCompletedOnboarding {
            showMainViewController(in: window)
        } else {
            showOnboarding(in: window)
        }

        window.makeKeyAndVisible()
        return true
    }

    // MARK: - Navigation

    private func showMainViewController(in window: UIWindow) {
        let vc = MainViewController()
        UNUserNotificationCenter.current().delegate = vc
        window.rootViewController = vc
    }

    private func showOnboarding(in window: UIWindow) {
        let onboarding = OnboardingViewController()
        onboarding.onComplete = { [weak self] in
            guard let self = self, let window = self.window else { return }
            let main = MainViewController()
            UNUserNotificationCenter.current().delegate = main

            UIView.transition(with: window, duration: 0.4,
                              options: .transitionCrossDissolve,
                              animations: {
                window.rootViewController = main
            })
        }
        window.rootViewController = onboarding
    }
}
