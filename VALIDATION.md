# Validation

## Phone playback update — 18 October 2026

- Production build and 13 synthetic core tests passed (the optional source-document test was not run in this pass).
- All 16 synthetic browser checks passed across Chromium and desktop WebKit. New checks cover cached byte-range responses, automatic prepared-session selection, continued native playback through simulated hide events, a single background source across narration/Next and a complete loop boundary, and automatic steady-music remix/persistence.
- Both additional real-pack browser checks passed locally. The existing 16-minute session remixed to a single WAV and played in both browsers; personal files remain excluded from deployment.
- Audio samples from the synthetic remixed track remain non-silent across music loop boundaries and visualization gaps.
- Interactive music now loops decoded PCM with constant gain. The native continuous session remains independent of the foreground AudioContext. No real iPhone lock-screen test was possible here.

## Original validation

Verified on this Mac on 17 October 2026.

- Production TypeScript check and Vite build passed. The deployable app is approximately 8.2 MB including all twelve offline soundscapes.
- All 14 core tests passed, including parsing the original Word document into nine populated sections and 41 scenes. The original produces 305 sentence segments.
- All 12 production-browser tests passed in Chromium and desktop WebKit at a 390 × 844 mobile viewport. Coverage includes document persistence, malformed import handling, navigation/filtering, favorites, repeat controls, data export, actual clip playback, prepared-session playback/seeking/export, offline reopening, GitHub Pages repository subpaths, Focus mode, and import/playback of the full personal voice and session packs.
- The app's network check observed no third-party requests. A content scan found none of the original document's 164 practice cells in the deployed text assets.
- Web-app dependency audit: zero reported advisories at verification time. The separate Mac-only Kokoro tool has upstream moderate advisories in its ONNX dependency chain; it is not bundled into or deployed with the PWA. Its high-severity image-library advisories were addressed with a patched Sharp override. The tool processes local recipes and bundled/cached model assets, and has no server endpoint.
- Generated all twelve soundscapes; each is normalized to approximately 0.12 RMS with peak amplitude below 0.8. Overlap transitions avoid isolated loop-boundary discontinuities. Nature options are synthesized textures, not licensed field recordings.
- Successfully generated eight real Kokoro voice auditions locally at 24 kHz. Confirmed subsequent neural generation works with remote model access disabled (`--offline`). Voice preference and perceived naturalness still require the user's listening judgment.
- The FFmpeg/ZIP/timing pipeline completed a clearly marked synthetic-tone test on the original first-section recipe. Tone-test outputs are kept under ignored `private/smoke` and are not the personal narration deliverables.

## Finished personal audio

- `private/audio/voice.theatre.zip`: 305 AAC narration clips for all nine sections and 41 scenes, approximately 11.5 MB.
- `private/audio/session.theatre.zip`: first section, 24 cell units, Heart voice at 0.9×, 30-second visualization gaps, warm ambient background, and a three-second lead-in. Duration: **15 minutes 58.875 seconds**; approximately 14.9 MB.
- `private/audio/session.m4a`: the same continuous session as a standalone audio file.
- Package fingerprints, complete clip coverage, repeat counts, timeline gaps and AAC duration were validated. The mixed speech matches the original source clip (correlation 0.981 after normal codec-delay alignment). Decoded session peak: **−4.7 dBFS**, with no clipping observed.
- Normalized neural speech and silence to matching PCM formats before concatenation; this prevents float/int audio corruption.
- Audio packs use compact AAC clips. IndexedDB stores their bytes as ArrayBuffers to avoid Safari multi-Blob serialization problems.

## Not verified here

Real iPhone hardware was not available. Screen-locked playback through a full session, lock-screen controls, system interruptions, power saving, storage eviction, and subjective headphone listening remain on-device acceptance checks. Desktop WebKit is not a substitute for those checks. The app uses prepared continuous media for this mode; it does not promise uninterrupted background browser TTS or playback on a powered-down phone.

GitHub Pages is configured for the public app repository `gkazzi14-byte/theatre-of-the-mind`, with automatic deployment from `main`. Personal documents and audio packs are excluded from the repository. Hosting URL: https://gkazzi14-byte.github.io/theatre-of-the-mind/.
