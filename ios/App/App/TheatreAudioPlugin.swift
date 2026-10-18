import Foundation
import AVFoundation
import MediaPlayer
import UIKit
import Capacitor

// Owns playback entirely on iOS. JavaScript only transfers a complete local
// file and sends controls; no WebView callback is needed to continue playing.
@objc(TheatreAudioPlugin)
public class TheatreAudioPlugin: CAPPlugin, CAPBridgedPlugin, AVAudioPlayerDelegate {
    public let identifier = "TheatreAudioPlugin"
    public let jsName = "TheatreAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "begin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "append", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seek", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLoop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "state", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise)
    ]
    private var player: AVAudioPlayer?
    private var id = ""
    private var file: URL?
    private var writer: FileHandle?
    private var expectedBytes = 0
    private var receivedBytes = 0
    private var starts: [Double] = []
    private var ended = false
    private var resumeAfterInterruption = false
    private var timer: Timer?
    private var observers: [NSObjectProtocol] = []
    private var remoteTargets: [(MPRemoteCommand, Any)] = []
    private var metadata: [String: Any] = [:]

    public override func load() {
        DispatchQueue.main.async { [weak self] in
            self?.configureRemoteCommands()
            guard let self = self else { return }
            self.observers.append(NotificationCenter.default.addObserver(
                forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
            ) { [weak self] note in self?.interrupted(note) })
            self.observers.append(NotificationCenter.default.addObserver(
                forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
            ) { [weak self] note in
                guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                      AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
                self?.resumeAfterInterruption = false
                self?.player?.pause()
                self?.emit()
            })
            self.observers.append(NotificationCenter.default.addObserver(
                forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main
            ) { [weak self] _ in
                guard let self = self, let file = self.file, self.writer == nil else { return }
                let position = self.player?.currentTime ?? 0
                let loops = self.player?.numberOfLoops ?? 0
                do {
                    self.player = try AVAudioPlayer(contentsOf: file)
                    self.player?.delegate = self
                    self.player?.numberOfLoops = loops
                    self.player?.currentTime = position
                    self.emit() // Require an explicit Play after media services reset.
                } catch { self.emit(error: error.localizedDescription) }
            })
        }
    }

    // Capacitor calls may arrive off the main thread. Serialize file writes,
    // audio controls, delegate updates and lock-screen commands on one queue.
    private func perform(_ call: CAPPluginCall, _ action: @escaping () throws -> JSObject) {
        DispatchQueue.main.async {
            do { call.resolve(try action()) }
            catch { call.reject(error.localizedDescription) }
        }
    }
    private func invalid(_ message: String) -> NSError {
        NSError(domain: "TheatreAudio", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
    private func removeFile() {
        try? writer?.close()
        writer = nil
        if let file = file { try? FileManager.default.removeItem(at: file) }
        file = nil
    }
    private func reset() {
        resumeAfterInterruption = false
        timer?.invalidate(); timer = nil
        player?.stop(); player = nil
        removeFile()
        id = ""; starts = []; ended = false; metadata = [:]
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
    @objc public func begin(_ call: CAPPluginCall) {
        perform(call) {
            guard let id = call.getString("id"), UUID(uuidString: id) != nil,
                  let ext = call.getString("extension"), ["wav", "m4a"].contains(ext),
                  let size = call.getInt("size"), size > 0, size <= 600_000_000 else {
                throw self.invalid("Invalid audio transfer.")
            }
            self.reset()
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("TheatreAudio", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            // Remove files left by a previous process, without touching imports.
            for old in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
                try? FileManager.default.removeItem(at: old)
            }
            let url = directory.appendingPathComponent(id).appendingPathExtension(ext)
            guard FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [
                .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication
            ]) else { throw self.invalid("Not enough space to prepare audio. Free storage and retry.") }
            self.file = url
            self.writer = try FileHandle(forWritingTo: url)
            self.id = id; self.expectedBytes = size; self.receivedBytes = 0
            return [:]
        }
    }
    @objc public func append(_ call: CAPPluginCall) {
        perform(call) {
            guard call.getString("id") == self.id, let writer = self.writer,
                  let encoded = call.getString("data"), encoded.count <= 270_000,
                  let data = Data(base64Encoded: encoded),
                  self.receivedBytes + data.count <= self.expectedBytes else {
                throw self.invalid("Audio transfer was cancelled or invalid.")
            }
            try writer.write(contentsOf: data)
            self.receivedBytes += data.count
            return [:]
        }
    }
    @objc public func finish(_ call: CAPPluginCall) {
        perform(call) {
            guard call.getString("id") == self.id, self.writer != nil,
                  self.receivedBytes == self.expectedBytes, let file = self.file else {
                throw self.invalid("The complete audio file has not arrived. Tap Play to retry.")
            }
            try self.writer?.close(); self.writer = nil
            let player = try AVAudioPlayer(contentsOf: file)
            player.delegate = self
            player.numberOfLoops = call.getBool("loop") == true ? -1 : 0
            guard player.prepareToPlay() else { throw self.invalid("This audio format could not be prepared.") }
            self.player = player
            self.starts = (call.getArray("starts", Double.self) ?? []).filter { $0.isFinite && $0 >= 0 && $0 < player.duration }.sorted()
            self.metadata = [MPMediaItemPropertyTitle: call.getString("title") ?? "Private practice",
                             MPMediaItemPropertyArtist: "Theatre of the Mind"]
            if let icon = Bundle.main.url(forResource: "icon-512", withExtension: "png", subdirectory: "public"),
               let image = UIImage(contentsOfFile: icon.path) {
                self.metadata[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            }
            // Timer is for UI/Now Playing updates only. AVAudioPlayer owns the
            // audio clock, pauses in the file, and loops even if JS is frozen.
            let timer = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in self?.emit() }
            RunLoop.main.add(timer, forMode: .common); self.timer = timer
            self.emit()
            return self.snapshot()
        }
    }
    private func start() throws {
        guard let player = player else { throw invalid("Import a voice or session pack before listening.") }
        let audio = AVAudioSession.sharedInstance()
        try audio.setCategory(.playback, mode: .default, policy: .longFormAudio, options: [])
        try audio.setActive(true)
        if ended { player.currentTime = 0 }
        ended = false
        guard player.play() else { throw invalid("iPhone audio could not start. Tap Play to retry.") }
        emit()
    }
    @objc public func play(_ call: CAPPluginCall) { perform(call) { try self.start(); return self.snapshot() } }
    @objc public func pause(_ call: CAPPluginCall) {
        perform(call) { self.resumeAfterInterruption = false; self.player?.pause(); self.emit(); return self.snapshot() }
    }
    private func move(to position: Double) {
        guard position.isFinite, let player = player else { return }
        player.currentTime = min(max(0, position), player.duration)
        ended = false; emit()
    }
    @objc public func seek(_ call: CAPPluginCall) {
        perform(call) { self.move(to: call.getDouble("position") ?? 0); return self.snapshot() }
    }
    @objc public func setLoop(_ call: CAPPluginCall) {
        perform(call) { self.player?.numberOfLoops = call.getBool("loop") == true ? -1 : 0; return [:] }
    }
    @objc public func state(_ call: CAPPluginCall) { perform(call) { self.snapshot() } }
    @objc public func clear(_ call: CAPPluginCall) { perform(call) { self.reset(); return self.snapshot() } }
    @objc public func share(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do {
                guard let name = call.getString("name"), !name.isEmpty,
                      name == (name as NSString).lastPathComponent,
                      let controller = self.bridge?.viewController else {
                    throw self.invalid("This file cannot be shared.")
                }
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let output = directory.appendingPathComponent(name)
                if let text = call.getString("text") {
                    try Data(text.utf8).write(to: output, options: .atomic)
                } else if let file = self.file, self.writer == nil {
                    try FileManager.default.copyItem(at: file, to: output)
                } else { throw self.invalid("Wait for audio preparation before exporting.") }
                let sheet = UIActivityViewController(activityItems: [output], applicationActivities: nil)
                sheet.popoverPresentationController?.sourceView = controller.view
                sheet.popoverPresentationController?.sourceRect = CGRect(x: controller.view.bounds.midX, y: controller.view.bounds.midY, width: 1, height: 1)
                sheet.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: directory) }
                controller.present(sheet, animated: true) { call.resolve() }
            } catch { call.reject(error.localizedDescription) }
        }
    }
    private func snapshot() -> JSObject {
        ["id": id, "position": player?.currentTime ?? 0, "duration": player?.duration ?? 0,
         "playing": player?.isPlaying ?? false, "ended": ended]
    }
    private func emit(error: String? = nil) {
        var state = snapshot()
        if let error = error { state["error"] = error }
        if let player = player {
            metadata[MPMediaItemPropertyPlaybackDuration] = player.duration
            metadata[MPNowPlayingInfoPropertyElapsedPlaybackTime] = player.currentTime
            metadata[MPNowPlayingInfoPropertyPlaybackRate] = player.isPlaying ? 1.0 : 0.0
            MPNowPlayingInfoCenter.default().nowPlayingInfo = metadata
        }
        notifyListeners("state", data: state)
    }
    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        guard player === self.player else { return }
        ended = true; emit(error: flag ? nil : "Audio playback was interrupted.")
    }
    public func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        guard player === self.player else { return }
        emit(error: error?.localizedDescription ?? "The audio file could not be decoded.")
    }
    private func interrupted(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        if type == .began {
            resumeAfterInterruption = player?.isPlaying == true
            player?.pause(); emit()
        } else {
            let options = AVAudioSession.InterruptionOptions(rawValue: note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
            let resume = resumeAfterInterruption && options.contains(.shouldResume)
            resumeAfterInterruption = false
            if resume { do { try start() } catch { emit(error: error.localizedDescription) } }
        }
    }
    private func command(_ command: MPRemoteCommand, _ action: @escaping (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus) {
        command.isEnabled = true
        let target = command.addTarget { event in
            if Thread.isMainThread { return action(event) }
            return DispatchQueue.main.sync { action(event) }
        }
        remoteTargets.append((command, target))
    }
    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        command(center.playCommand) { [weak self] _ in
            guard let self = self, self.player != nil else { return .noSuchContent }
            do { try self.start(); return .success } catch { self.emit(error: error.localizedDescription); return .commandFailed }
        }
        command(center.pauseCommand) { [weak self] _ in
            self?.resumeAfterInterruption = false; self?.player?.pause(); self?.emit(); return .success
        }
        command(center.togglePlayPauseCommand) { [weak self] _ in
            guard let self = self, let player = self.player else { return .noSuchContent }
            if player.isPlaying { self.resumeAfterInterruption = false; player.pause(); self.emit() }
            else { do { try self.start() } catch { return .commandFailed } }
            return .success
        }
        command(center.changePlaybackPositionCommand) { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.move(to: event.positionTime); return .success
        }
        center.skipForwardCommand.preferredIntervals = [15]
        center.skipBackwardCommand.preferredIntervals = [15]
        command(center.skipForwardCommand) { [weak self] event in
            guard let self = self, let event = event as? MPSkipIntervalCommandEvent else { return .commandFailed }
            self.move(to: (self.player?.currentTime ?? 0) + event.interval); return .success
        }
        command(center.skipBackwardCommand) { [weak self] event in
            guard let self = self, let event = event as? MPSkipIntervalCommandEvent else { return .commandFailed }
            self.move(to: (self.player?.currentTime ?? 0) - event.interval); return .success
        }
        command(center.nextTrackCommand) { [weak self] _ in self?.navigate(1); return .success }
        command(center.previousTrackCommand) { [weak self] _ in self?.navigate(-1); return .success }
    }
    private func navigate(_ delta: Int) {
        guard !starts.isEmpty else { return }
        let time = player?.currentTime ?? 0
        let index = starts.lastIndex(where: { $0 <= time + 0.05 }) ?? 0
        move(to: starts[min(max(0, index + delta), starts.count - 1)])
    }
    deinit {
        timer?.invalidate()
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        remoteTargets.forEach { $0.0.removeTarget($0.1) }
        try? writer?.close()
    }
}
