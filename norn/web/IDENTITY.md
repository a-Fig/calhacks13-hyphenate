# Norn's identity

The ECR screens use Primer's list, timeline, tabs, menus and evidence dialog. Norn supplies the
workspace identity: a light warm header, copper drawing mark, teal links, a wordmark, and ECR
numbers in drawing title-block cells. The same SVG is the header mark, bot avatar and favicon.
The title block shows the request number and program; it invents no part revision.

`src/ui/EngineeringIcons.tsx` draws the engineering symbols on one 24-unit grid. ECRs use a
redlined drawing, released ECOs a stamp, revisions a lettered triangle and changes a caliper.
Other symbols are a cracked part (NCR), gauge (impact), crate (supply), serial plate (cut-in),
aircraft (program), board table (CCB), BOM tree and cost sheet. Search, discussion, check-state
and disclosure controls retain their familiar generic icons. Draft drawings are dashed;
rejected ones are crossed. Status pills also spell out the state.

The screen audit covers the open and closed lists, all three detailed ECRs, each of the five
impact checks, changes, revisions, summary-only ECRs and the evidence dialog. It removes the
repository band and team slug, gives revisions a timeline and engineering badges, makes the
summary-only state a bordered panel with links to available assessments, and keeps cards and
tables usable on narrow screens. Wide data tables scroll inside their cards. The date heading
uses the revision's date rather than appending a hard-coded year.

`/spike` is an isolated developer diagnostic, excluded from the demo navigation and this visual
redesign. The audit does not run its database-mutating smoke scripts.

## Reproduce the visual audit

From `norn/`, after `npm ci`:

```powershell
# Start the isolated preview; saved runs and labelled mock narrative are the default.
npm run dev -w @norn/web -- --port 5186
# Capture before changing the identity, into a fresh output directory.
node web/screenshots/capture-identity.mjs before C:/path/to/media
# Capture the final screens, exercise controls and mobile layouts, and record the demo flow.
node web/screenshots/capture-identity.mjs after C:/path/to/media --gif
# Check the web package and produce the production bundle.
npm run typecheck -w @norn/web
npm run build -w @norn/web
```

These captures use saved real cost runs plus labelled mock narrative. They verify the visual
path without connecting to or modifying a live database. They do not establish live integration
coverage. `NORN_WEB` can point the capture script at another isolated preview port.

Evidence colours stay functional: facts remain blue, assumptions orange, computations green and
judgments pink, including inside the evidence dialog. They are independent of Norn's teal links.
The app currently serves at the origin root, matching its existing absolute route URLs.
