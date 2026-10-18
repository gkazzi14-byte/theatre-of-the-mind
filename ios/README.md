# Theatre for iPhone

The iPhone app bundles the existing interface and uses `AVAudioPlayer` for
continuous imported/prepared audio, with `AVAudioSession.Category.playback`
and the `audio` background mode. Playback, visualization gaps, looping,
lock-screen play/pause, 15-second skipping, seeking and unit navigation all run
on iOS without JavaScript. Calls follow the system interruption/resume signal;
unplugging headphones pauses playback. JSON backups, recipes and audio exports
use the iOS share sheet. Documents and narration remain on the phone.

The browser/Home Screen web app continues to use its HTML audio player.
Installing the web app does not install this native audio engine.

## Install on your iPhone

1. Install **Xcode 26 or later** from the Mac App Store, open it once, and let
   its iOS support finish installing. Full Xcode is required; Command Line
   Tools alone cannot build or install an iPhone application.
2. In this project, using Node 22.12+:

   ```sh
   export PATH="/opt/homebrew/bin:$PATH"
   npm ci
   npm run ios:sync
   npm run ios:open
   ```

3. In Xcode select **App → Signing & Capabilities**, enable automatic signing,
   and choose your Apple team. No signing identity is committed to this repo.
4. Connect and trust the iPhone, enable Developer Mode if prompted, choose it
   as the run destination, and press **Run**. Theatre appears as its own app.
5. Open Theatre, import `voice.theatre.zip` or `session.theatre.zip` from Files,
   wait for preparation, then tap **Play**. The app's private storage is
   separate from Safari's; existing browser imports are not copied automatically.

Live system speech still requires the screen to stay on. Import a voice/session
pack for screen-off narration. TestFlight/App Store distribution needs Apple
signing and distribution setup; this repository is not a published App Store app.

## Acceptance check on the actual phone

Play, press the side button, and listen past two narration units and their gaps.
Keep it locked for a complete practice and loop. Test lock-screen play/pause,
seek and previous/next, then switch apps, disconnect headphones, receive a call
and return. Confirm audio, text highlighting and the scrubber agree after return.
Reopen offline and verify imports. Export a backup to Files, then test deletion.

## What can be checked without Xcode

`npm test` checks bounded file transfer, cancellation, control ordering,
native-state synchronization and transfer failure with a fake native bridge.
`npm run ios:sync` checks the TypeScript/build and copies checked public assets.
The **Check native iPhone app** GitHub workflow compiles the app for an unsigned
iOS Simulator, which checks Swift and project wiring, not physical lock behavior.
The physical-phone checklist remains required before claiming the reported
power-button problem is resolved.
