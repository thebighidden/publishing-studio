# FlowAI API (Laravel 13)

PHP and Composer run in Docker, not on the host. Don't install them locally.

- Start everything from the repo root: `docker compose up -d` (API on :8000, Mailpit inbox on :8025).
  The first start installs dependencies, creates `.env`, the app key and the SQLite file, and migrates.
- Artisan and Composer: `docker compose exec api php artisan …`, `docker compose exec api composer …`
- Tests: `docker compose exec api php artisan test`. Style: `docker compose exec api vendor/bin/pint`
- `vendor/` lives in a Docker volume (bind-mounted vendor made every request take over a second on Windows).
  After `composer require`, the host copy of `vendor/` is stale; the container's is the one that runs.
- Restart the API after editing `.env`: `docker compose restart api`.

Auth is Sanctum SPA cookie sessions. The React app in `../frontend` proxies `/api`, `/sanctum` and `/oauth`
to this API through Vite, so both share one origin. Google/GitHub sign-in uses Socialite on web routes
(`routes/web.php`) because the OAuth callback needs the session that started it.
