# MS Studio 4

Static GitHub Pages web app for Minecraft Bedrock music creation.

## Main fixes

- The FSB module is actually loaded by `index.html`.
- Folder and file inputs accept FSB, archives, direct audio, and definitions.
- Folder selection, fallback `webkitdirectory`, drag-and-drop, and nested ZIP/MCPACK/MCADDON scanning are supported.
- FSB banks are probed immediately and subsong metadata is loaded lazily, avoiding an apparent freeze on huge banks.
- Selected FSB subsongs are decoded locally to WAV through vgmstream WebAssembly.
- Audio/video files can be transcribed into a multi-pattern note-block approximation. Browser decoding is tried first; FFmpeg WebAssembly is downloaded only for unsupported formats.
- Includes eight editable song presets.

## Important limitation

A note-block arrangement cannot be sample-identical to arbitrary source audio. Note blocks have limited instruments and pitch range. The converter aims to preserve tempo, dominant pitches, onsets, dynamics, and approximate timbre.

## GitHub Pages

Upload all files from this folder to the repository root and publish the `main` branch root in Settings → Pages. Hard refresh once after deployment.
