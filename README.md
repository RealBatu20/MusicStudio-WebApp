# MS Studio Web App v2

A responsive, installable Minecraft Bedrock music workstation for Windows, Android, tablets, phones and other modern browsers. It arranges Bedrock sound identifiers, previews matching local Minecraft audio assets and exports `.mssong` files for the Music Studio add-on.

## GitHub Pages

This repository is a static website. In GitHub, open **Settings → Pages**, select **Deploy from a branch**, choose `main` and `/(root)`, then save.

Published project URL:

```text
https://realbatu20.github.io/MusicStudio-WebApp/
```

After an update, use a hard refresh once so the previous PWA cache is replaced.

## Real Minecraft audio preview

Minecraft audio files are not redistributed by this repository. To preview the actual sounds:

1. Open **AUDIO → Load audio**.
2. Extract a Minecraft Bedrock resource pack that contains the `sounds/` directory.
3. Choose that extracted folder, select individual `.ogg`, `.wav`, `.mp3` or `.m4a` files, or drag the files onto the audio panel.
4. The app matches sound IDs from `sound_definitions.json` to the selected files.

You may optionally store the imported audio locally with IndexedDB. Large vanilla audio collections can consume substantial browser storage.

Without a matching local file, the app uses a category-aware synthesized preview and marks the sound with a diamond icon instead of a play icon.

## Main workstation features

- Responsive desktop, tablet and mobile workspaces
- Channel Rack with touch painting, mute, solo, randomize and rotation
- Multiple patterns with create, duplicate, switch and delete
- Piano Roll with velocity, note length, zoom, dragging and resizing
- Playlist clips with song mode, tracks and drag arrangement
- Mixer with volume, pan, pitch, low-pass filter and delay
- Master volume, swing, metronome, loop and tap tempo
- Undo/redo and automatic local project recovery
- `.msproject` save/load
- `.mssong` import/export and compact JSON export
- Keyboard note recording and optional Web MIDI input
- Favourites and sound-category filtering
- PWA install and offline application shell

## Shortcuts

```text
Space             Play or pause
Escape            Stop
Ctrl/Cmd + Z       Undo
Ctrl/Cmd + Y       Redo
Ctrl/Cmd + S       Save .msproject
Delete             Clear selected channel
Z S X D C V G B H N J M ,   Play/record notes
```

## Bedrock export tags

Every exported song includes:

```text
ms:is_music
ms:is_song
```
