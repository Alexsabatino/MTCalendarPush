# Rotation Planner

Plans a rotating class schedule and creates each class in **Mariana Tek**, which can only repeat a class on fixed weekdays.

The rotation (defaults, all editable in the app):

| Day | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|
| Class | Strength 1 | Endurance 1 | Longevity 1 | Strength 2 | Endurance 2 | Longevity 2 | Strength 3 | Endurance 3 | Longevity 3 |

Day 10 starts over at Strength 1. The studio is open every day, so every calendar day counts. All classes on a day share that day's genre and level. Classes are 50 minutes.

## Run it (Windows PowerShell)

```
git clone <repo-url> rotation-planner
cd rotation-planner
npm install
npm run dev
```

Open the `Local:` link it prints. Without Mariana Tek credentials it runs in **demo mode**: pushes go to a pretend studio saved in `data/store.json`.

## Using it

1. **Rotation settings:** Day 1 date, genre order, number of levels, daily class times, class length, time zone, and optional skipped classes (skipping removes a class but does not shift the rotation).
2. **Calendar:** month view and the next 9 days.
3. **Mariana Tek:** match each genre/level to a Mariana Tek class type and pick the room layout, choose how far ahead to schedule, preview the changes, then push. A CSV export is also available.

Pushing is safe to repeat. The tool remembers which Mariana Tek class it created for each date and time, so it never makes duplicates. When settings change it only touches future classes it created:
- adds missing classes,
- changes the class type of classes whose genre/level changed,
- deletes classes no longer in the rotation.

Classes that already have bookings are never changed or deleted; they are listed for staff to handle in Mariana Tek. Past classes are never touched.

## Connecting to Mariana Tek

1. The studio emails **integrations@marianatek.com** to request Admin API access, agrees to the API Terms of Service, and gets a sandbox site to test with.
2. In Mariana Tek, create one class type per genre and level (for example "Strength 1" … "Longevity 3"), each 50 minutes. The class length comes from the class type.
3. Create a `.env`-style setup by setting environment variables before `npm run dev` (never commit them):

```
$env:MARIANATEK_TENANT = "yourstudio"
$env:MARIANATEK_API_TOKEN = "paste-token-here"
npm run dev
```

`MARIANATEK_TENANT` is the subdomain in `https://yourstudio.marianatek.com`. The token stays on the server and is never sent to the browser. The header shows which site is connected.

**Test against the sandbox site first.** The integration follows Mariana Tek's published Admin API (`/api/class_sessions/`, `/api/class_session_types/`, `/api/layouts/`, JSON:API, Bearer token) but has not yet been run against a real Mariana Tek site.

## Development

```
npm test          # unit + API tests
npm run typecheck
npm run build
```

- `shared/rotation.ts` — rotation math (genre/level for any date, class slots).
- `shared/sync.ts` — compares the plan with classes already pushed.
- `server/mariana.ts` — Mariana Tek API client and the demo studio.
- `server/app.ts` — API routes. `src/` — React UI.
