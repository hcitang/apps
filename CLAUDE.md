# apps

Collection of single-file / static web apps deployed via GitHub Pages at https://hcitang.github.io/apps/.

## Conventions

- Each app lives in its own folder; the folder name is the URL path (e.g. `wcri2026/` → `/apps/wcri2026/`).
- Apps are static — plain HTML/CSS/JS, no build step, no framework toolchain. Open `index.html` directly to test.
- Data files (JSON, CSV) sit alongside `index.html` and are fetched at runtime.
- Deployment is automatic from `main` — push to publish.

## Adding an app

1. Create `<name>/index.html` (+ any data files).
2. Add a row to `README.md`.
3. Commit to `main`.
