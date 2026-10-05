# FlowAI: to do

What's left between the app as it stands and the product the landing page describes.
The spec is [README.md](README.md); how to run everything is in [DEVELOPMENT.md](DEVELOPMENT.md).

## Right now

- [ ] Put `ANTHROPIC_API_KEY` in `backend/.env`, run `docker compose restart api`, and try AI writing for real.
      It's tested against a stand-in, but hasn't made a live call to Claude yet.

## Next up

### Per-platform adaptation

"Same idea. Native everywhere." Today one text goes to every platform.

- [ ] Store a version of the post per platform, alongside the main text
- [ ] AI adapts the post for each selected platform: long-form for LinkedIn, short for X, caption and hashtags
      for Instagram, a hook for TikTok
- [ ] Composer: a tab per platform to edit its version; the preview shows that version
- [ ] Check each version against its own platform's character limit, instead of every post against the strictest

### Publishing, starting with one network

- [ ] Register developer apps and start the app reviews (Meta for Instagram and Facebook, LinkedIn, X, TikTok,
      YouTube, Pinterest). Reviews can take weeks, so start before the code is ready.
- [ ] Connect accounts: sign in with each network, store the tokens encrypted, refresh them, disconnect from Settings
- [ ] Run a queue worker and the scheduler, in `docker-compose.yml` too
- [ ] A job that publishes posts when they're due, retries on failure, and records the result per platform
- [ ] Post states for Publishing, Published (with a link to the live post) and Failed (with the reason)
- [ ] Tell people when a post fails, by email and in the app (the landing page already promises this)

## The rest of what the landing page sells

### Media

- [ ] Upload images and videos to a post, with each network's size and format rules
- [ ] Media library
- [ ] AI image generation (choose a provider)
- [ ] AI video generation (choose a provider)

### AI writing

- [ ] Generate several variations to choose from
- [ ] Save and reuse prompts
- [ ] More models: GPT and Gemini, or take them off the landing page
- [ ] Track AI usage and cost per person, and show it in Settings

### Automations

- [ ] Workflows: a trigger (e.g. every Monday at 9:00), then generate ideas, create posts, adapt them and schedule them
- [ ] A review step: generated posts wait in "Needs review" until someone approves them (the landing page promises this)

### Analytics

- [ ] Reach, engagement and clicks from each network, once publishing works
- [ ] Top-performing posts and per-platform performance

### Teams

- [ ] Workspaces with members and roles, for agencies and marketing teams
- [ ] Who can approve and publish, by role

## Before launch

- [ ] Privacy policy, terms and cookie pages. Google sign-in verification and the network app reviews ask for them.
- [ ] Fix dead links: every footer link goes to `#top`; Documentation, Guides and API all go to `#resources`
- [ ] Pricing page, plans and billing, with AI usage limited by plan
- [ ] Make the landing copy match what's built: the Security section's review and failure-alert claims, the AI
      section's model list, the team use cases
- [ ] Production setup: a real web server (not `php artisan serve`), Postgres or MySQL, queue worker and scheduler,
      a real mail service, HTTPS, error monitoring, backups
- [ ] Frontend tests, at least sign up → create a post → schedule it

## Done

- [x] Landing page
- [x] Sign up, log in, email confirmation, password reset, Google and GitHub sign-in
- [x] Composer with a live preview per platform and character limits
- [x] Drafts, scheduling, the posting queue, calendar and library
- [x] Analytics of your own output
- [x] AI writing and rewriting with Claude, streamed into the editor
