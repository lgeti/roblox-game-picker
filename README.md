# Roblox Game Picker 🎮

A shared list of Roblox games you and your friends want to play together.

- **Add games** by pasting a Roblox link. The name, icon, creator and live player count are pulled from Roblox automatically.
- **Vote** with "I want to play" so everyone can see who's in.
- **🎲 Pick a game for us** spins through the unplayed games and picks one (games with more votes are more likely to win).
- **Mark as played** to move a game to the Played tab, or delete it.
- The page refreshes every 10 seconds, so you see what your friends add.

## How it's built

| Part | Where it runs | Folder |
|------|---------------|--------|
| The page | GitHub Pages (free) | `docs/` |
| The API + saved list | Cloudflare Workers + a Durable Object (free plan) | `worker/`, `wrangler.toml` |

The page calls the Worker for everything. The Worker saves the list and looks up games on Roblox (browsers can't call Roblox's APIs directly).

## Run it locally

```bash
npm install
npm run dev     # Worker API on http://localhost:8787
npm run page    # page on http://localhost:5500 (in a second terminal)
```

On localhost the page automatically uses the local Worker (see `docs/config.js`). Local data is kept in `.wrangler/` and never touches the real list.

## Deploy

### 1. Cloudflare Worker (one time)

1. Create a free account at https://dash.cloudflare.com/sign-up and verify your email.
2. In the dashboard, open **Workers & Pages** once so Cloudflare sets up your `*.workers.dev` subdomain.
3. In this folder:
   ```bash
   npx wrangler login
   npm run deploy
   ```
4. Wrangler prints your Worker URL, e.g. `https://roblox-game-picker.yourname.workers.dev`. Paste it into `DEPLOYED_API` in `docs/config.js`.

### 2. GitHub Pages

1. Push this folder to a GitHub repo.
2. Repo **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, branch `main`, folder **/docs**.
3. Your page will be at `https://<your-github-username>.github.io/<repo-name>/`. Send that link to your friends.

### 3. (Optional) Lock the API to your page

In `wrangler.toml`, set `ALLOWED_ORIGINS` to your Pages address plus localhost, then `npm run deploy` again:

```toml
ALLOWED_ORIGINS = "https://yourname.github.io,http://localhost:5500"
```

## Updating later

- Changed the page (`docs/`)? Commit and push. GitHub Pages redeploys on its own.
- Changed the Worker (`worker/`)? Run `npm run deploy`.

## Free plan limits

Cloudflare's free plan allows 100,000 requests a day, which is far more than a friend group will use. There's no sleeping, and the list doesn't get wiped.
