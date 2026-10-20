import AVFoundation
import Foundation
import Observation
import Speech

/// A question spoken rather than typed — the web's `useDictation`, over
/// Apple's own recogniser. What is heard is written into the box and never
/// sent: it is read back and fixed before Send, voice search's rule. It stops
/// itself after a pause, and says when the microphone is refused, nothing was
/// heard, or this phone cannot listen in the page's language.
@Observable
@MainActor
final class Dictation {
    private(set) var listening = false
    /// "denied", "unsupported" or "nothing", until the next start.
    private(set) var problem: String?

    private var engine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var heardAnything = false
    private var quiet: Task<Void, Never>?
    private var onHeard: ((String) -> Void)?

    /// Whether this device has a recogniser at all; the microphone is drawn only then.
    static var isAvailable: Bool { SFSpeechRecognizer.authorizationStatus() != .restricted && SFSpeechRecognizer() != nil }

    static func messageKey(_ problem: String) -> String {
        switch problem {
        case "denied": return "ios.voice.denied"
        case "unsupported": return "ios.voice.unsupported"
        default: return "search.voiceNothing"
        }
    }

    func start(language: Language, onHeard: @escaping (String) -> Void) {
        guard !listening else { return }
        problem = nil
        heardAnything = false
        self.onHeard = onHeard
        Haptics.tap()
        Task {
            guard await Self.permitted() else {
                problem = "denied"
                Haptics.refused()
                return
            }
            let locale = Locale(identifier: language == .ar ? "ar-KW" : "en-US")
            guard let recognizer = SFSpeechRecognizer(locale: locale) ?? SFSpeechRecognizer(locale: Locale(identifier: language == .ar ? "ar-SA" : "en-GB")),
                  recognizer.isAvailable else {
                problem = "unsupported"
                return
            }
            begin(with: recognizer)
        }
    }

    func stop() {
        request?.endAudio()
    }

    /// Ends at once and drops whatever was half-heard.
    func cancel() {
        onHeard = nil
        task?.cancel()
        finish()
    }

    private static func permitted() async -> Bool {
        let speech = await withCheckedContinuation { (done: CheckedContinuation<Bool, Never>) in
            SFSpeechRecognizer.requestAuthorization { status in done.resume(returning: status == .authorized) }
        }
        guard speech else { return false }
        return await AVAudioApplication.requestRecordPermission()
    }

    private func begin(with recognizer: SFSpeechRecognizer) {
        let session = AVAudioSession.sharedInstance()
        let engine = AVAudioEngine()
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        do {
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            let input = engine.inputNode
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
                request.append(buffer)
            }
            engine.prepare()
            try engine.start()
        } catch {
            problem = "unsupported"
            return
        }
        self.engine = engine
        self.request = request
        listening = true
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let owner = self else { return }
            let text = result?.bestTranscription.formattedString
            let final = (result?.isFinal ?? false) || error != nil
            Task { @MainActor in owner.heard(text, final: final) }
        }
        settleAfterQuiet(seconds: 6)
    }

    private func heard(_ text: String?, final: Bool) {
        if let text, !text.isEmpty {
            heardAnything = true
            onHeard?(text)
            settleAfterQuiet(seconds: 1.6)
        }
        if final { finish() }
    }

    /// A pause ends the question, as the browser's recogniser does.
    private func settleAfterQuiet(seconds: Double) {
        quiet?.cancel()
        quiet = Task {
            try? await Task.sleep(for: .seconds(seconds))
            if !Task.isCancelled { request?.endAudio() }
        }
    }

    private func finish() {
        guard listening else { return }
        quiet?.cancel()
        engine?.stop()
        engine?.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task = nil
        request = nil
        engine = nil
        listening = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if !heardAnything && onHeard != nil { problem = "nothing" }
        onHeard = nil
    }
}
