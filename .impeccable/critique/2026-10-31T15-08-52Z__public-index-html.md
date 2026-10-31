---
target: public/index.html
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/mockcomic/projects/DynamicBoard/public/index.html"
target_fingerprint: "sha256:80f91c1881fedccca44bad36200d4338b4234540b224ead9987a699003c9a83d"
target_path: /home/mockcomic/projects/DynamicBoard/public/index.html
timestamp: 2026-10-31T15-08-52Z
slug: public-index-html
---
Method: dual-agent (A: sa-0-a30f65a2 · B: sa-1-c1edc711)

#### Design Health Score

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 1 | Preview is only a grid editor; nothing shows what's on the physical board now/next; no rotation countdown |
| 2 | Match System / Real World | 2 | "Auto Text Formatting" is actually the primary composer; event cards dump raw "Repeat Every Year: false"; tagline calls messages "events" |
| 3 | User Control and Freedom | 3 | Delete→Undo toast + rollback everywhere, but no edit path for a saved message — delete and retype |
| 4 | Consistency and Standards | 1 | Two "Submit" primaries with different meanings; two different "Clear"s; destructive actions one-click while saves get spinners; grid validates chars, text composer doesn't |
| 5 | Error Prevention | 2 | Text path skips all char validation (emoji/Arabic/accented saved silently vs 132-cell board); no capacity check |
| 6 | Recognition Rather Than Recall | 2 | "Schedule applies to the NEXT message you submit" is pure recall burden; syntax only behind Legend |
| 7 | Flexibility and Efficiency | 3 | Ctrl+Enter, grid arrow nav, schedule presets — but no reorder, no duplicate, no edit |
| 8 | Aesthetic and Minimalist Design | 2 | Duplicate Ctrl+Enter hints; API key + timezone buried in footer; yellow event card is a color shout |
| 9 | Error Recovery | 3 | Server detail + rollback, but danger toast auto-dismisses at 2.5s ("Send failed: Invalid API key" vanishes unreadable) |
| 10 | Help and Documentation | 1 | Legend modal only; no lifecycle explanation; no pointer to where the Vestaboard write key comes from |
| **Total** | | **20/40** | **Acceptable — significant improvements needed** |

#### Design Specificity Verdict

**LLM assessment:** ~20% authored, 80% category-interchangeable Bulma dashboard. The one genuinely authored artifact is the 22×6 split-flap preview (real bezel, monospace uppercase, aspect-ratio 22/6; styles.css:144-184) plus its keyboard model with wrap-around (grid.js:54-103). Everything around it is stock: generic tagline "A dynamic board for creating and managing events" (index.html:38), identical centered-title .box sections, no flap animation, no countdown, nothing showing what's currently on the physical board. A Vestaboard app whose hero element never mirrors the board's live state is a domain miss.

**Deterministic scan:** exit 2, 9 static findings in public/index.html: 7× cramped-padding (box ×4 at :81,:83,:107,:162; modal-card-body ×3 at :248,:374,:472) + 2× nested-cards (:83,:107 inside :81). All 7 cramped-padding are FALSE POSITIVES — Bulma supplies the padding and the live-rendered scan flagged zero. nested-cards is a true positive. Live headless scan @1280: 18 findings — 16× low-contrast (white on Bulma is-primary #00d1b2 = 2.0:1 on #api-key-banner-btn, #submit-grid-btn, #submit-text-btn, #timerInput-btn, #timezone-save-btn + card footers; white on is-danger #f14668 = 3.6:1; footer .has-text-grey 3.6:1 on #242424) + 2× nested-cards. Mobile @390: 17 findings. Overlay injection: 15 contrast + 2 nested-card labels in DOM.

**Visual overlays:** injection succeeded in the sub-agent's headless session (overlay labels visible in both screenshots); no persistent [Human] tab remains — the live-server was started and stopped (port 8400 closed, verified). Screenshots: /home/mockcomic/.hermes/cache/scratch/shot_desktop_1280.png, /home/mockcomic/.hermes/cache/scratch/shot_mobile_390.png.

#### Overall Impression

Solid self-hosted utility undermined by stock Bulma defaults. The delete→Undo toast and optimistic-rollback discipline show real care; the framework's 2.0:1 teal buttons and jargon section labels undermine it. Biggest opportunity: make the split-flap preview the source of truth — a LIVE MIRROR (current message, next in rotation, countdown) that both composers preview into.

#### What's Working

1. The grid is a real model of the device, not a decoration — bezel, monospace, uppercase, aspect-ratio 22/6, wrap-around arrow nav (grid.js:54-103).
2. Optimistic-write-with-rollback discipline everywhere (app.js:183-190, 207-218, 238-253, 349-361) — trustworthy engineering surfaced as design.
3. Schedule presets + disabled-until-enabled + summary line (index.html:384-406, schedule.js:90-148) — good progressive disclosure for the fiddliest form.

#### Priority Issues

1. **[P1] Text messages bypass the board's physical constraints and never appear in the preview.** submitData('text') skips findUnsupportedChars (validated live: emoji/Arabic/accented saved clean; grid path catches the same emoji); no char budget vs 132 cells. Fix: run the same codex check + capacity meter on text submit; render the about-to-send message into the grid preview. → /impeccable harden
2. **[P1] Send has no failure moment of its own.** Costliest action gets a 2.5s auto-dismiss toast (ui.js:127), no retry, no fix action, banner hedges "seems to be invalid" (index.html:56). Fix: persistent toast (duration 0) with "Enter API key"/"Retry", mirror failure into banner. → /impeccable clarify + harden
3. **[P2] Rotation timer can't represent its own state.** config.timer/60000 shown in a field with min="1" (app.js:195) — a live 5s config displays 0.08333333333333333 and re-saves as invalid. Fix: seconds stepper or unit toggle; "next rotation in…" countdown. → /impeccable clarify
4. **[P2] Modals are keyboard-hostile.** All four lack role="dialog"/aria-modal/labelledby (verified grep: 0 hits in index.html), no focus trap, no focus restore (activeElement=body after Legend). Fix: standard dialog wiring in openModal/closeModal (ui.js:149-163). → /impeccable audit + polish
5. **[P2] Saved messages are write-only: no edit, no reorder, no dedupe.** Cards expose only Send/Delete (app.js:490,499); typo costs delete+retype+re-position+re-schedule. Fix: Edit prefilled; up/down reorder. → /impeccable polish

#### Persona Red Flags

**Alex (power user):** No Edit on a saved card (app.js:486-502) — typo means delete+retype. Server-set 5s timer renders 0.0833… minutes and Update rejects it (app.js:195 vs :199-206). API key input + reset buried in the footer below the whole message list (index.html:528-553).

**Sam (screen reader / keyboard):** 132 sequential grid inputs in tab order before the composer (grid.js:107-114, verified tabbableGrid:132). Cell announcement malformed: "Row 1, column 2 of 6, 22" — dimensions reversed (grid.js:49-52). Modals unlabelled, focus lands nowhere. White on #00d1b2 = 1.95-2.0:1, on #f14668 = 3.6:1, .help #7a7a7a = 3.16:1 — all below AA. "Enabled" checkbox says nothing about what it enables (index.html:185-188).

**Riley (stress tester):** Text composer saves emoji/Arabic/1000 chars with zero warning while the grid path rejects the same emoji — inconsistent validation. Paste "HELLO" into a grid cell keeps only "H" silently (grid.js:88-95). Refresh evaporates draft text and pending schedule despite PWA service worker. Two tabs: full-config PUT with no rev/etag — stale tab resurrects deleted messages (app.js:145-162). Offline send: one 2.5s "Failed to fetch" toast, no queue, no offline indicator.

#### Minor Observations

- Tab title "🐴 Dynamicboard" — a horse for a flap board (index.html:6).
- Duplicate Ctrl+Enter hints (index.html:71-74 vs :85-87), second mislabels scope.
- Event card: yellow shout + literal "Repeat Every Year: false" (app.js:446-477) — say "Repeats yearly" or omit.
- Good copy worth keeping: "The key is stored on the server, never in the browser." (index.html:498-500).
- Empty state exists but no clear-all; toasts stack without dedupe and overlay the header zone on mobile (styles.css:104-114).
- Build stamp tiny grey-on-grey, not tappable to copy (index.html:554).
- Mobile 390px: no overflow, but grid tap targets ~13px cells, sub-24px.

#### Questions to Consider

1. If the split-flap preview is the product's identity, why is it an input widget instead of a live mirror showing current message, next in rotation, and a countdown — with both composers previewing into it?
2. Why do two composers with identical "Submit" labels and different validation strictness exist, rather than one job: "write a message, put it on the board"?
3. The cheapest physical failure is a wrong message clattering on a wall for hours — why does every action get a spinner except Send, the one with real-world cost?
