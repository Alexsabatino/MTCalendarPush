# Rotation Planner

Plans a rotating class schedule and creates each class in **Mariana Tek**, which can only repeat a class on fixed weekdays.

How the schedule is built:

1. **Weekly schedule:** for each day of the week, set the class times and each class's level. Every Monday uses Monday's times and levels, and so on.
2. **Genre rotation:** the genre moves to the next one every calendar day (Strength → Endurance → Longevity → Strength …), starting from the Day 1 date. The studio is open every day, so weekends and holidays count. Every class that day gets that day's genre.

**Importing your weekly grid:** on the Weekly schedule tab, open **Import from a spreadsheet**. Use a sheet with times down the first column (e.g. `6:15 AM`) and day names across the top row, and `Level 1/2/3` somewhere in each cell. Emoji, percentages and other text are ignored; blank or `-` means no class. Upload it as CSV (Google Sheets: File → Download → CSV) or paste cells copied from the sheet. Days missing from the sheet keep their current schedule. Check the result, click **Save settings**, then push from the Mariana Tek tab.

Example: if Monday is 6:00 L1 and 9:00 L3, one Monday's classes might be Strength 1 and Strength 3, the next Monday's Endurance 1 and Endurance 3. Classes are 50 minutes.

## Run it (Windows PowerShell)

```
git clone <repo-url> rotation-planner
cd rotation-planner
npm install
npm run dev
```

Open the `Local:` link it prints. Without Mariana Tek credentials it runs in **demo mode**: pushes go to a pretend studio saved in `data/store.json`.

## Using it

1. **Weekly schedule & rotation:** each weekday's class times and levels (with Copy to Mon–Fri / weekend / every day), Day 1 date, genre order, number of levels, class length, time zone, a 2-week preview, and optional skipped classes (skipping removes a class but does not shift the rotation).
2. **Calendar:** month view and the next 9 days.
3. **Mariana Tek:** match each genre/level to a Mariana Tek class type and pick the room layout, choose how far ahead to schedule, preview the changes, then push. A CSV export is also available.
4. **Import CSV:** upload a whole schedule and push it in one go. The file replaces the rotation for the classes it lists.

### CSV format

| Date | Start | Genre | Level |
|---|---|---|---|
| 2026-12-01 | 06:00 | Strength | 1 |
| 12/2/2026 | 5:30 PM | Endurance | 1 |

- **Date:** `2026-12-01` or `12/1/2026`. **Start:** `06:00`, `17:30` or `5:30 PM`.
- Instead of Genre + Level you can use one **Class name** column such as `Strength 2` or `Longevity L3`.
- Other columns are ignored, so the app's own CSV export can be edited and re-imported.
- The preview lists every bad row by row number (bad date/time, unknown genre, level out of range, duplicate date and time). Nothing is pushed until all rows are valid.
- Rows in the past are skipped. Tick **Also remove…** to delete classes this tool created between the file's first and last date that aren't in the file.

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
- `shared/csvImport.ts` — reads and validates schedule CSVs.
- `server/mariana.ts` — Mariana Tek API client and the demo studio.
- `server/app.ts` — API routes. `src/` — React UI.
