# MS Studio Web App

A responsive, installable PWA for arranging Minecraft Bedrock sound identifiers and exporting `.mssong` projects.

## Run

The app is static. Serve the `webapp` folder from any HTTPS host:

- GitHub Pages
- Cloudflare Pages
- Netlify
- Vercel
- Any normal web server

For a quick local test:

```bash
python -m http.server 8080 --directory webapp
```

Open `http://localhost:8080`.

## Full sound catalog

On startup, the app attempts to fetch Mojang's current `sound_definitions.json` from the official `Mojang/bedrock-samples` repository. If the request is blocked or offline, it uses a smaller built-in fallback list.

You can always click the `+` button beside the sound search and import a current `sound_definitions.json` manually.

## Audio preview

The web app does **not** redistribute Minecraft audio files. Browser preview uses a lightweight synthesized click/tone. The selected sound identifiers play as actual Minecraft sounds after the project is imported into the add-on.

## Import into Bedrock

Small projects:
1. Click **EXPORT .MSSONG**.
2. Click **COPY COMPACT JSON**.
3. In Minecraft, use the Music Studio item.
4. Choose **Import Compact JSON** and paste.

Large projects:
1. Export the `.mssong`.
2. Run `tools/import_song.py`.
3. Import the rebuilt `.mcaddon` into Minecraft.
