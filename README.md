# Theatre of the Mind

A static, private iPhone practice player. Import four-column Word documents, listen one sentence/cell/scene/section at a time, or play prepared meditation audio with the screen locked.

## Start locally

Requires Node **22.12+** (or 24+) and npm. On this Mac, Homebrew's Node is at `/opt/homebrew/bin`; an older `/usr/local/bin/node` may otherwise take precedence.

```sh
cd "$HOME/Desktop/self improvement/theatre-player"
export PATH="/opt/homebrew/bin:$PATH"
npm ci
npm run dev
```

Open the displayed local URL. Import `../Theatre-of-the-Mind-Daily-Practice.docx`. Confirm the preview: **nine sections, 41 scenes**. The blank personal-scenes table is ignored. The document is not copied into the project or deployed.

## Put it on iPhone with GitHub Pages

This project's hosting is configured at **https://gkazzi14-byte.github.io/theatre-of-the-mind/**. Open it in Safari and use **Share → Add to Home Screen**. Import your private packs from Files; personal content is never included in the hosted app. The steps below are for setting up another copy.

1. Create a new **public** GitHub repository for the app. GitHub Free Pages hosts the empty app publicly. Personal documents and audio must never be uploaded.
2. Upload/commit this project's source, including `public/` and `package-lock.json`. Exclude `node_modules`, `dist`, `private`, caches, and personal exports as specified in `.gitignore`. The original Word file stays in the parent directory.
3. In repository **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**.
4. Push to `main`, or open **Actions → Deploy private-data-free app to Pages → Run workflow**. After this initial setup, deployment is one workflow click (or automatic on push).
5. Open the HTTPS Pages URL in iPhone Safari. Tap **Share → Add to Home Screen**. Open the installed app and allow the initial offline assets to finish downloading.
6. AirDrop the Word document to your iPhone and save it in Files. Tap **Import your practice**, choose the document, and confirm the preview.

You can use a private local network instead: run `npm run dev`, put Mac and iPhone on the same Wi-Fi, then open the printed Network URL. The Mac must stay running. Ordinary LAN HTTP is only a preview: full PWA installation, service workers, and some secure APIs require HTTPS. Use Pages for the simplest free HTTPS setup. Opening `index.html` directly through Files is not supported.

## Everyday practice

- Tap **Focus** to hide settings and keep just the reading and playback controls.
- Choose a section and scene, then reading size (sentence, cell, scene, section) and range (scene, section, all).
- **Wait for Next** reads one unit then waits. **Timed pause** adds your visualization gap and advances automatically.
- **Affirmations only** reads the Line column within your selected range.
- Repeat a unit now, choose 1–20 readings per unit, or loop a timed practice.
- All twelve bundled backgrounds are original synthesized sounds. The four nature-inspired options imitate rain, surf, running water and forest wind; they are not recordings. Preview, favorite, or import your own music. Interactive music uses a decoded looping buffer at steady volume, without restarting between sentences or Next actions. Noise colors are approximate sound textures, not clinical/calibrated generators.
- Music continues through visualization gaps and manual waiting. Explicit Pause stops both. Interactive practice pauses when the app is hidden.
- Imported neural clips take priority over browser speech. Without them, only English voices reported as local by the browser are eligible. Voice quality and availability depend on the device; Siri's voice is not guaranteed to be exposed to websites.

## Natural neural audio on your Mac

Kokoro generates audio locally; FFmpeg mixes it. No paid API and no document upload. First use downloads public model weights and voice files. After setup, use `--offline` to require cached assets. A first-time download still contacts the public model host, but your practice text is never sent there.

```sh
export PATH="/opt/homebrew/bin:$PATH"
npm ci --prefix audio-tool
# Install FFmpeg if it is not already present:
brew install ffmpeg
# List English voices and make short auditions:
npm run prepare:audio -- --voices
npm run prepare:audio -- --audition
```

Listen to the WAV auditions in `private/audio/`. Choose the voice you prefer; Heart is the initial default, not a claim that everyone will prefer it. In the app, set your range, read size, repeats, gaps, music and volume. Select **Prepare natural audio**, choose the voice and **Export private recipe**. If you export on iPhone, AirDrop the recipe back to your Mac’s Downloads folder before running the command below.

```sh
npm run prepare:audio -- --recipe "$HOME/Downloads/practice.recipe.json"
# For your own music, add:
# --music "/absolute/path/to/your/music.mp3"
# After model and selected voice assets have been cached, add --offline.
```

Generation can take several minutes for a full document. Cached sentences are reused. Do not interrupt while a pack is being written. The tool generates all document sentences for flexible interactive navigation, then mixes the selected recipe into a session. Maximum prepared session duration is four hours. Output is private and ignored by Git:

- `private/audio/voice.theatre.zip`: sentence-level neural narration for interactive practice.
- `private/audio/session.theatre.zip`: continuous narration, music, visualization gaps and repeats plus timing metadata.
- `private/audio/session.m4a`: standalone audio usable in a compatible local player.

AirDrop both ZIP packs to iPhone Files, then import them individually in the app. Packs include the matching dataset; importing a different document asks you to confirm replacement and removes mismatched packs. Keep original packs in Files as backups.

Once a prepared session is imported, the ordinary player automatically uses that continuous track. There is no separate listening tab: Play/Pause, Previous/Next, Repeat and Loop control the same native audio track, and the current narration is highlighted. No background-playback setting or mode selection is required; tap Play, then lock your screen. Without a prepared session, interactive speech still pauses when hidden. Play/pause and seek are exposed through the browser's supported media controls. Timing and music are baked in, so the phone need not run background speech synthesis or JavaScript timers. Calls, power policies, memory pressure, browser versions and other media can still interrupt playback. Playback cannot continue with the phone powered down. Looping uses the media element's native loop capability and also needs a device check.

The app plays imported session audio directly; startup and import do not wait for an on-device remix or replace the original audio. Newly prepared sessions use a steady music bed. Changing a prepared session's voice, rate, background, mix, pauses or repeat count otherwise requires a new recipe and regeneration. Interactive controls do not alter a prepared mix. Use the ordinary player’s scrubber, Previous/Next and Repeat controls to move through the session.

## Privacy and storage

No accounts, telemetry, remote fonts, document uploads, server APIs or runtime CDNs. App requests go to its static host; GitHub can see ordinary website requests, not local document contents. Browser speech is selected only when `localService` is true. Personal data is stored in IndexedDB, not the service-worker asset cache. Anyone with access to your unlocked device may access it. No encryption/password gate is claimed.

Browser storage may be cleared by you or the operating system. Back up JSON and keep the source Word file and audio packs. If saving fails, the app continues temporarily and tells you to export before closing. **Delete local data** removes app data and settings, not copies in Files or on the Mac. Large audio packs are limited to 600 MB; imported music to 100 MB. Replacing a pack is atomic in IndexedDB, so insufficient space preserves the previous stored copy.

The service worker caches only built app assets and sounds. An update activates after its app files are cached, including when an old page is stuck. The page reloads to use the new code when playback is inactive. Do not reload during playback.

## Validation

```sh
npm test
THEATRE_DOCX='../Theatre-of-the-Mind-Daily-Practice.docx' npm test
npm run build
npx playwright install chromium webkit
npm run test:browser
```

Tests use synthetic fixtures. The optional document test reads the original without copying it into fixtures or printing its contents. `npm run build` checks deployment filenames and builds the offline cache. `--smoke` on the audio tool is an explicitly labeled tone-only pipeline test, not neural narration.

Real-iPhone acceptance checklist:

1. Install from HTTPS; import document and both audio packs; confirm offline reopening.
2. Audition voices and backgrounds with headphones; check intelligibility, loop seams, fades and comfortable levels.
3. Run a full prepared session with the screen locked, including a loop; confirm no missing narration or gaps.
4. Check lock-screen play/pause/seek, an incoming call, switching audio apps, and returning to the app.
5. Confirm foreground highlighting follows playback and interactive practice pauses safely on hiding.
6. Export a backup, delete local data, and verify that reimport restores the practice.

To check generated personal packs locally as well, run `THEATRE_AUDIO_DIR=private/audio npm run test:browser`. Validate their timing and source-to-mix audio alignment with `node --import tsx scripts/validate-audio.ts private/audio`.

Desktop browser tests do not verify real iPhone background behavior. See `VALIDATION.md` for the checks actually run.

## Audio provenance

The twelve bundled soundscapes and icons are generated by `scripts/soundscapes.py`; no third-party recordings are used. You may use, modify and redistribute these generated assets with this app. Kokoro model weights are Apache-2.0; retain upstream notices in the installed tool/model distribution. User-imported music remains local and is the user's own selection.
