<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep desktop Autopilot orchestration in `electron/autopilot.cjs`, with injected scanner and sender functions; this reuses existing safety checks without duplicating scanners.
- Keep browser Autopilot simulation isolated from real leads and outbound services; preview approvals must never send real messages.
- Store the desktop Telegram token encrypted with Electron safeStorage and never return it to the renderer; remote callbacks are authorized by chat and bound to a specific batch.
- Keep email records, SMTP attempts, suppression and templates in the desktop email module, separate from SMS storage; channel separation prevents accidental cross-channel sending.
- SMTP/IMAP credentials belong to the local Mac and use safeStorage, never project secrets or browser storage; preview email actions remain simulated.
- Keep email template defaults in shared JSON used by desktop and preview; both channels must resolve the same subject/body Spintax rules.
- Optional GitHub libs (whois-json, deep-email-validator, fingerprint-generator/injector) load via try/catch require in electron/main.cjs with native DNS/UA-pool fallbacks, so the app never crashes when a package fails.
- Domain suggestions (.pl) share one rule set between electron/main.cjs (WHOIS/DNS check) and src/lib/domain-check.ts (browser simulation); keep both in sync when changing stopwords or candidate patterns.
- The desktop widget is the `/widget` route rendered in a frameless transparent BrowserWindow; both windows share one cached UI server port and use narrowly scoped widget stats/show/openMain IPC, with mock data as the browser-preview fallback.
- Keep global channel context in the app shell and sidebar; channel-specific views reuse existing separate SMS/email stores so navigation never mixes outbound records.
- Keep secondary-display geometry and cancellable window interpolation in `electron/window-motion.cjs`; isolating pure geometry allows tests without launching Electron.
- Define Apple glass colors and shadows in global CSS tokens; reuse glass utilities across views rather than duplicating surface colors.
- OLX response normalization and bounded pagination live in electron/olx-results.cjs with injected API/DOM readers, so nested response shapes and collection limits can be tested without launching Electron.
- Weekly time fields keep focused input local and commit on blur; parent snapshots merge unsaved time drafts until successful explicit save, so background updates cannot undo edits.
- The Telegram remote command tree (menu, /skan wizard, REMOTE_ADD_*) lives in electron/autopilot.cjs poll loop with owner-chat authorization; the browser preview uses the pure mock in src/components/telegram-simulator.tsx, which must never call the Electron bridge or send real messages.
- Poland stays SMS-only (email UI for Polish leads was removed at the user's request). Foreign markets use e-mail: country-rules.json is the single source for channel, footer, send window, daily limit and refusal keywords, shared by src/lib/market-outreach.ts and electron/email.cjs. English content is prepared in the Sniper (preview = sent text) and stored on the row as email_prepared_*; the engine only appends the country footer. Never send cold SMS outside Poland.
- The 40-niche catalog has one source of truth in niches-catalog.json, shared by src/lib/niches-catalog.ts (UI pickers) and electron/autopilot.cjs (Telegram wizard); change niches only there.
- Phone-as-remote: Telegram commands reach the renderer as "remote:command" events (preload onRemoteCommand, src/lib/remote-command.ts); SearchTab executes the same full scan path as manual search and reports back via autopilot:remoteReport. Keep the background scan in autopilot.cjs only as a no-window fallback.
- macOS releases are built by .github/workflows/release.yml via scripts/package-mac.mjs (unsigned, ad-hoc codesign); the packager keeps only modules required by electron/*.cjs, so new main-process deps must be loaded with require(). Never add "productName" or rename "name" in package.json: Electron derives the userData folder (leads, settings, blacklist) from it.
- SMS tempo presets live in shared JSON; electron/sms-speed.cjs owns the interruptible deadline, separate from the single-flight Bottleneck sender, so live changes never stack stale waits. Include the shared JSON in desktop packages.
