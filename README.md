# Perfect Ten (Điểm mười)

Teachers create classes, write multiple-choice exams, and assign them to a class or share a link. Students take timed
exams and get graded immediately. Built from the prototype "Điểm Mười: online exam authoring and testing".

Stack: TanStack Start + Router + Query (React 19), Supabase (Postgres, Auth, RLS), Cloudflare Workers.

## What's included

- Sign-up / sign-in as a teacher or student (Supabase Auth, email + password).
- Teachers: classes and class codes, student rosters (add one by one or paste a list), exams (multiple-choice
  questions, ordering, difficulty), publishing (private to a class / anyone with the link / public in the exam
  library), open time, deadline, attempt limit, question shuffling, answer shuffling, answer reveal; per-exam
  results and per-class statistics.
- Students: join a class with a code, browse the public exam library, take exams with a timer and per-question
  autosave, view results and wrong answers.
- People without an account can take "link" and "public" exams (Supabase anonymous sessions).
- Exam ratings (1–5, after submitting) shown in the library and on the teacher's results page.
- Leaderboards (`/xep-hang`): per-exam student ranking (best attempt; sort by score, speed, progress, exams taken),
  visible to the exam's teacher, class members and anyone who submitted; teachers can turn it off per exam. Public exam
  quality board (rating, discrimination, attempts, average score).

Not built yet (present in the prototype): AI question generation from documents, AI homework assistant, formula/diagram
editor, the "score garden" profile, forwarding questions to the teacher, the AI admin page.

## Security lives in the database

All permissions are enforced by RLS and `security definer` functions in `supabase/migrations/`, not by the UI:

- The `questions` table (which holds the answers) is readable only by the exam's teacher. Test-takers get questions
  through `attempt_questions()` (no answers) and results through `attempt_review()` (answers are shown only when the
  teacher allows it and the exam is closed).
- Attempts are written only through RPCs: `start_attempt` checks the open time, class roster, and attempt limit;
  `save_answer` rejects writes after the deadline (+30 seconds); `submit_attempt` grades on the server.
- Users cannot promote themselves to teacher after signing up (only the `full_name` column is editable).
- Only allowlisted emails become teachers (see below); everyone else is a student whatever the sign-up form sends.
- Once any student has answered a question, its number of options is locked (answers are stored by option position).

## Adding teachers

Sign-up creates a teacher only if the email matches a row in `public.teacher_allowlist` (not readable or writable by
app users; run as the database owner in the Supabase SQL editor). A pattern is a full lowercase email or a domain
starting with `@`:

```sql
insert into public.teacher_allowlist (pattern) values ('co.ha@gmail.com'), ('@truong.edu.vn');
```

Add the email **before** the teacher signs up; an account created earlier stays a student. To promote one, run
`update public.profiles set role = 'teacher' where id = (select id from auth.users where email = 'co.ha@gmail.com');`.
Local `supabase db reset` seeds `@truong.edu.vn` from `supabase/seed.sql` (used by the e2e test).

## Run locally

Requires Node 22+, pnpm, and Docker (for local Supabase).

```sh
pnpm install
pnpm supabase start           # prints the API URL and anon key
cp .env.example .env          # fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
pnpm supabase db reset        # run migrations
pnpm dev                      # http://localhost:3000
```

Checks:

```sh
pnpm test                     # unit tests + RLS/grading checks on PGlite (no Docker needed)
pnpm typecheck
```

## Deploy

1. Create a project on supabase.com, then:
   ```sh
   pnpm supabase login
   pnpm supabase link --project-ref <ref>
   pnpm supabase db push
   ```
   In Dashboard → Authentication: enable **Anonymous sign-ins**, keep **Confirm email** on (students are admitted to
   classes by email), and set the Site URL to your Cloudflare domain.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env` (Vite inlines them at build time).
3. ```sh
   pnpm wrangler login
   pnpm run deploy
   ```

## CI/CD

GitHub Actions (`.github/workflows/`):

- `ci.yml`: on every PR and push to `main` — typecheck, tests, `pnpm audit` (fails on high/critical), build.
- `deploy.yml`: on push to `main`, after CI passes — build and `wrangler deploy` (code only, never touches the database).
- `migrate.yml`: manual (Actions tab → Run workflow) `supabase db push`, with a dry run first. Runs in the
  `production-db` environment; add required reviewers there. Run it before merging a PR that adds a migration, and keep
  migrations backward compatible (add columns/tables first, drop old ones in a later migration).
- `codeql.yml`: CodeQL static analysis on PRs, `main`, and weekly.
- `dependabot.yml`: weekly grouped dependency and Actions version updates.

Repo secrets (Settings → Secrets and variables → Actions): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` (migrate only), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
Also enable Dependabot alerts, secret scanning, and push protection under Settings → Code security.
