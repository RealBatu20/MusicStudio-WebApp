# Upload MS Studio 4 to GitHub Pages

1. Extract `MusicStudio_WebApp_v4.0.0.zip`.
2. Upload everything inside the extracted folder to the root of `RealBatu20/MusicStudio-WebApp`.
3. Delete obsolete files if still present: `app.js`, `sound_catalog_fallback.js`, `sound_catalog_v2.js`.
4. Keep `app-fsb.js`, `app-presets.js`, `app-transcriber.js`, and `vgmstream-worker.js`.
5. Commit to `main`.
6. Settings → Pages → Deploy from branch → `main` → `/(root)`.
7. After deployment, press Ctrl+Shift+R once or clear the installed PWA cache.

The FSB decoder downloads the official vgmstream WebAssembly runtime from `https://vgmstream.org/web/` when first needed. Unsupported normal audio formats download FFmpeg WebAssembly on demand.
