# Rotation Planner

Plans a rotating class schedule and creates each class in **Mariana Tek**, which can only repeat a class on fixed weekdays.

It works in two pushes:

1. **Weekly classes** tab: set each day's class times and levels (every Monday uses Monday's, and so on), then push. Every class goes into Mariana Tek at its time with a level-only class type (`Level 1/2/3`), usually months ahead.
2. **Genre rotation** tab: set the Day 1 date and genre order, then push. The genre moves to the next one every calendar day (Strength → Endurance → Longevity …), weekends and holidays included, and each class already in Mariana Tek is switched to its genre's class type (`Level 2` → `Strength 2`), usually about 3 weeks at a time. It never adds or removes classes.

Re-pushing either one only sends what changed. Changing the weekly schedule later keeps the genre on classes that already have one.

**Importing your weekly grid:** on the Weekly classes tab, open **Import from a spreadsheet**. Use a sheet with times down the first column (e.g. `6:15 AM`) and day names across the top row, and `Level 1/2/3` somewhere in each cell. Emoji, percentages and other text are ignored; blank or `-` means no class. Upload it as CSV (Google Sheets: File → Download → CSV) or paste cells copied from the sheet. Days missing from the sheet keep their current schedule. Check the result, click **Save settings**, then push.

**Quick one-date changes:** on the Calendar tab, click a date to change a class's genre or level, cancel it, or add an extra class, for that date only (a dot marks changed dates). The bar at the top shows how many changes aren't in Mariana Tek yet; **Push changes** sends only those.

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

1. **Mariana Tek setup** (once): match class types — one per level for the weekly push (`Level 1–3`) and one per genre and level for the genre push (`Strength 1` … `Longevity 3`) — and pick the room layout.
2. **Weekly classes:** each weekday's times and levels (Copy to Mon–Fri / weekend / every day), the week at a glance, skipped classes, and the weekly push.
3. **Genre rotation:** Day 1 date, genre order, time zone, a 2-week preview, CSV export, and the genre push.
4. **Calendar:** month view, next 9 days, and one-date changes with a **Push changes** bar.
5. **Import schedule:** upload a whole schedule and push it in one go. The file replaces the rotation for the classes it lists.

### Importing a schedule (e.g. from Gemini)

The **Import schedule** tab takes the schedule spreadsheet as CSV and pushes it to Mariana Tek. To change something later, edit the same sheet and upload it again: the tool compares it with the classes it already created and pushes only the new, changed and removed classes (removal is limited to the file's first–last date and can be turned off). Booked and past classes are never touched.

Two layouts are accepted:

- **Grid:** class times down the first column, days across the top, `Level 1/2/3` in each cell (emoji, percentages and `-` are ignored). Headers can be dates (`Mon 12/7`, `Dec 7`, `2026-12-07`) or plain day names plus a "Week 1 starts on" date. Several weeks can be stacked, each with its own header row. See `examples/gemini-3-weeks.csv`.
- **One row per class:** described below.

The genre comes from the file if a cell, header, genre row or Genre column names one; otherwise from the genre rotation (Day 1 date + genre order on the Weekly schedule tab).

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
