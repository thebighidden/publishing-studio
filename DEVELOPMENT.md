# Running FlowAI locally

Two pieces: the Laravel API in Docker (`backend/`), and the React app served by Vite (`frontend/`).
You need Docker Desktop and Node. PHP is not installed on your machine; it runs in the container.

```sh
docker compose up -d     # from the repo root: API on :8000, Mailpit (email inbox) on :8025
cd frontend
npm install
npm run dev              # the app on http://localhost:5173
```

The first `docker compose up` takes a few minutes: it installs PHP dependencies, creates
`backend/.env`, an app key and the SQLite database, and runs the migrations. Later starts take seconds.

Open http://localhost:5173, sign up, and you land in the studio at `/dashboard`.

## Email

Every email the API sends (confirm your address, reset your password) lands in Mailpit:
http://localhost:8025. Nothing leaves your machine.

## Google and GitHub sign-in

The buttons work once the API has credentials. Until then they say the provider isn't switched on.

1. Create an OAuth app:
   - Google: Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application).
     Authorized redirect URI: `http://localhost:5173/oauth/google/callback`
   - GitHub: Settings → Developer settings → OAuth Apps → New OAuth App.
     Authorization callback URL: `http://localhost:5173/oauth/github/callback`
2. Put the ID and secret in `backend/.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_…`).
3. `docker compose restart api`

## AI writing

The composer on the Create page writes a post from a brief, or rewrites the one in the editor, with Claude.
It's switched off until the API has a key; until then the composer says so.

1. Create a key at https://platform.claude.com/settings/keys
2. Put it in `backend/.env` as `ANTHROPIC_API_KEY`.
3. `docker compose restart api`

Only accounts with a confirmed email can use it, at up to 10 requests a minute and 200 a day per person
(`AppServiceProvider`). The models on offer are listed in `backend/config/ai.php`; the first is the default.
The prompt is in `app/Services/Ai/PostPrompt.php`.

## Everyday commands

```sh
docker compose exec api php artisan test        # backend tests
docker compose exec api vendor/bin/pint         # PHP code style
docker compose exec api php artisan migrate     # after adding a migration (also runs on every start)
docker compose logs -f api                      # API request log
npm run build                                   # in frontend/: type-check and build the app
docker compose down                             # stop the API and Mailpit (data is kept)
```

## How the pieces fit

- **Sessions, not tokens.** The app signs in with Laravel Sanctum's cookie-based SPA auth. Vite proxies
  `/api`, `/sanctum` and `/oauth` to the API, so the browser sees one origin and the session cookie just works.
- **The API** lives in `backend/`: auth controllers under `app/Http/Controllers/Auth`, posts, the posting
  queue (`app/Services/PostQueue.php`), overview and analytics endpoints, and AI writing (`WritingController`,
  which streams the post back as server-sent events from `app/Services/Ai`). Routes are in `routes/api.php`;
  social login is in `routes/web.php`.
- **The app** lives in `frontend/`: the landing page and auth pages are in `src/pages`, the studio is in
  `src/dashboard` (loaded as its own chunk), and the API client and session are in `src/lib`.

## What isn't connected yet

- **Publishing to the networks.** Posts are planned, queued and scheduled, but nothing is sent to Instagram,
  LinkedIn and the rest. When a scheduled time passes the post shows as *Due*; post it yourself, then mark it
  published.
- **Engagement analytics.** Reach, likes and clicks come from each network's API, so Analytics covers your own
  output only: what you wrote, planned and published, where, and when.
- **Media uploads.** A post's format (text, image or video) is recorded and previewed with a placeholder.
- **Image and video generation.** AI writes the text, including captions for image and video posts; it
  doesn't make the media.

## Deploying

Serve the built app (`frontend/dist/`) and the API under one domain: send `/api`, `/sanctum` and `/oauth` to Laravel,
and every other path to `index.html`. Then set `APP_URL` and `FRONTEND_URL` to that domain, add it to
`SANCTUM_STATEFUL_DOMAINS`, set `SESSION_SECURE_COOKIE=true`, and point `MAIL_*` at a real mail service.
