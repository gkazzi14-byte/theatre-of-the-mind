import Capacitor

class TheatreViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(TheatreAudioPlugin())
    }
}
