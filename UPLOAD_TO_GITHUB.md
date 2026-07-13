# Upload to GitHub Pages

1. Extract `MusicStudio_WebApp_v2.0.0.zip`.
2. Open `RealBatu20/MusicStudio-WebApp` on GitHub.
3. Upload all extracted files and folders to the repository root on the `main` branch.
4. Allow GitHub to replace files with matching names.
5. The old `app.js` and `sound_catalog_fallback.js` files can be deleted, but leaving them is harmless because v2 does not load them.
6. Open the published site and press `Ctrl + Shift + R` once. On mobile, clear the site's cached data or reopen it after GitHub Pages finishes deploying.

The root must contain `index.html`, `app.css`, the five `app-*.js` files, `sound_catalog_v2.js`, `service-worker.js`, `manifest.webmanifest`, and the `icons` folder.
