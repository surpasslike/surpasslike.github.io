# AGENTS.md

## Cursor Cloud specific instructions

This repository is a **Hexo static blog** (`hexo-theme-butterfly`), content in Chinese under `source/_posts`. There is no backend, database, or API — the "product" is the generated static site.

### Services / commands

Dependencies are installed automatically on startup (`npm install`). Standard commands are in `package.json` `scripts`:

- Dev preview server: `npm run server` (runs `hexo server`, serves at http://localhost:4000). Long-running — start it in a background/tmux session.
- Build static site: `npm run build` (runs `hexo generate`, outputs to `public/`).
- Clean cache/output: `npm run clean` (runs `hexo clean`).

There are **no lint or test scripts** defined in this repo.

### Non-obvious notes

- The dev server (`hexo server`) watches `source/` and auto-regenerates on file changes, but regeneration takes a few seconds — wait before checking the served page.
- Post URLs come from the **filename** (permalink `:title/`), not the front-matter `title`. E.g. `source/_posts/my-post.md` → http://localhost:4000/my-post/.
- Create a new post with `npx hexo new post "<slug>"`; it lands in `source/_posts/`.
- If a build behaves oddly after switching branches or editing config, run `npm run clean` first (clears `db.json` and `public/`).
- Deployment is handled by GitHub Actions (`.github/workflows/deploy.yml`) to GitHub Pages on push to `main`; the `deploy` config in `_config.yml` is unused (`hexo deploy` is not the deploy path). CI uses Node 20.
