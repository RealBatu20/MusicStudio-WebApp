# MS Studio Web App v3.0.0

MS Studio is a static, installable Minecraft Bedrock music workstation for Windows, Android, tablets, phones, and other modern browsers. Version 3 adds recursive Bedrock asset discovery and real `.fsb` sample-bank playback through vgmstream WebAssembly.

## Publish on GitHub Pages

1. Upload every file in this folder to the repository root.
2. In GitHub, open **Settings → Pages**.
3. Select **Deploy from a branch**.
4. Choose `main` and `/(root)`.
5. Open `https://realbatu20.github.io/MusicStudio-WebApp/`.

After replacing an older version, perform one hard refresh so the v3 service worker replaces the old cache.

## Find the real Bedrock audio

The Bedrock Samples **full** release contains binary assets, including `.fsb` banks. The text-only/min release intentionally removes `.fsb` and other audio files.

1. Download and extract the **full** Bedrock Samples release.
2. Open MS Studio and select **AUDIO → Audio Vault**.
3. Choose **Scan root folder** and select the highest extracted folder.
4. The scanner recursively walks every nested directory. It searches for:
   - `.fsb` banks
   - `sound_definitions.json`
   - `.ogg`, `.wav`, `.mp3`, `.m4a`, `.aac`, `.flac`, and `.opus`
   - supported ZIP, `.mcpack`, and `.mcaddon` archives
5. Each FSB bank is opened and every internal subsong is indexed. A subsong is decoded to WAV only when it is previewed.

The scanner does not stop at `resource_pack/sounds`. It walks the complete selected tree, including deeply nested folders and nested supported archives up to a safe recursion limit.

## FSB decoder

Browsers cannot play FMOD `.fsb` containers directly. MS Studio loads vgmstream's official WebAssembly CLI at runtime and performs conversion inside a Web Worker. Selected files stay on the device and are not uploaded by this app.

The default decoder URL is:

```text
https://vgmstream.org/web/
```

An internet connection is required the first time the decoder is loaded. The application shell itself remains installable as a PWA.

## Matching sound IDs

MS Studio imports `sound_definitions.json`, resolves each Bedrock event to its referenced sound path, and compares that path with normal audio filenames and FSB internal stream names. When a bank's internal name does not match the definition, select the sound ID, open the FSB stream explorer, and press **Map** beside the correct subsong.

## Workstation features

- Modern responsive desktop, tablet, portrait-phone, and landscape-phone layouts
- Recursive audio vault with scan progress and folder-depth reporting
- FSB bank browser and internal subsong explorer
- Real local audio preview with pitch, volume, pan, filter, and delay
- Channel Rack with touch painting, mute, solo, randomize, and rotation
- Multiple patterns
- Piano Roll with note velocity, length, zoom, dragging, and resizing
- Playlist arrangement with movable clips and Song mode
- Mixer with per-channel controls
- Master volume, swing, metronome, loop, and tap tempo
- Undo/redo and local project recovery
- `.msproject` save/load
- `.mssong` import/export and compact JSON export
- Keyboard note recording and Web MIDI input
- Sound categories, search, favourites, and manual FSB mapping
- PWA installation and offline application shell

## Bedrock export tags

Every exported song includes both required tags:

```text
ms:is_music
ms:is_song
```

## Privacy and storage

- Folder and FSB files remain local to the browser session.
- Normal decoded audio can optionally be stored in IndexedDB.
- Large FSB banks remain session-only to avoid duplicating gigabytes of data.
- Very large archives should be extracted first and scanned as a folder.
