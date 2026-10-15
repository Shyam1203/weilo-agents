# Spike: OpenUI as the generative-UI layer

Branch `spike/openui`. This is a proof of concept, not ready to merge.

## What the branch does

- **New show block** `{type: "openui", source: "<OpenUI Lang>"}` (`daemon/weilo.mjs`, `ui/src/features/chat/blockData.ts`).
- **Our own component library** (`ui/src/features/chat/openui/library.tsx`), built with `@openuidev/react-lang`: Stack, Card, Text, Metric, Tag, Table, Chart, Form, Field, Input, TextArea, Select, Buttons and Button. Each one renders with `components/ui/*`, the chart renderers (now in `Charts.tsx`) and the Tailwind tokens. OpenUI's `react-ui` styling is not used.
- **Prompt from the library**: `npm run openui-prompt --prefix ui` writes `daemon/openui-prompt.md` from `library.prompt()`, and `weilo.mjs` appends it to the show tool's description.
- **Replies**: a Button sends its label as the user's reply. Inside a Form, the reply also lists each field by name (`- team: Billing`), after validation (`required`, `email`, `min`, …). `@OpenUrl` opens https links only. A show with a Form or Button counts as a choice, so the agent is told to end its turn.
- **Lazy loading**: OpenUI loads only when the first `openui` block appears.
- **Harness**: `ui/spike.html` plus `ui/src/spike.tsx` replay a show call the way pi's RPC streams it (`npx vite` in `ui`, then open `/spike.html`; `?stop=0.55` freezes at 55%, `?ms=` sets the speed).

## Streaming: yes, but the UI had to learn tool-call deltas

pi's RPC mode (`toJsonEvent` in pi-coding-agent 1.2.0) strips `partial` from `message_update`. A tool call reaches the UI as `toolcall_start` (id, toolName), then raw JSON `toolcall_delta` strings, then `toolcall_end` with the full call. Before this branch, `conversation.ts` ignored all three, so show blocks only appeared at `message_end`.

The branch now builds up the JSON for `show` calls and parses it as it grows (`partialJson.ts` closes open strings and brackets). It marks the item `streaming` until the message ends. OpenUI's streaming parser then renders whatever statements are complete. With `root = Stack(...)` first, the shell appears at once and the parts fill in (screenshot: the metrics and chart are drawn at 55% of the arguments, before the form). Inputs stay disabled until the call ends.

This change is independent of OpenUI: the existing JSON blocks (tables, cards) now stream too.

## Bundle-size cost

| | JS, min | gzip |
|---|---|---|
| Before: eager | 527.4 kB | 161.3 kB |
| After: eager (index + shared chunk) | 528.8 kB | 163.3 kB |
| After: lazy `OpenUIBlock` chunk | 198.5 kB | 60.9 kB |

So the cost is about +2 kB gzip up front, plus about 61 kB gzip the first time an agent shows an `openui` block. By source size, zod (v4, needed for the schemas) is about 2/3 of that chunk, `lang-core` (parser and evaluator) about 1/3, and `react-lang` is small.

## Fit with pi's tool-call flow

- **Good fit.** The OpenUI source is one string argument of the existing `show` tool, so nothing changes in pi, the runner, or how messages are stored. Old chats render as before.
- **Prompt cost.** The generated prompt adds about **1,450 tokens**, and the show tool grows from about 980 to about 2,540 tokens (o200k tokenizer as a proxy). That is sent on every request, though it is cached.
- **Escaping.** The source travels inside a JSON string, so every `"` becomes `\"`. This adds about 20% over the raw OpenUI text.
- **Generated prompt.** It assumes the program is the whole response ("Final verification: root = … is the FIRST line"). It reads fine as part of a tool description, but it was written for a different setup.
- **Not built.** Interactive features (`$state`, `@Set`, `Query`/`Mutation` with a tool provider) are switched off in the prompt. Query/Mutation could later call daemon endpoints, which is where generative UI gets interesting, but it is a security surface of its own.

## Tokens: OpenUI compared with JSON blocks

These are tokens of the whole `show` arguments, as the model writes them (o200k):

| Content | JSON blocks | `openui` block | Change |
|---|---|---|---|
| 3 metrics + 5-bar chart | 111 | 106 | −5% |
| 8×4 table | 131 | 175 | +34% |
| 3-field form + submit | 296 (a `page` block of hand-written HTML/JS) | 117 | −60% |

Simple data costs about the same, or more for tables (OpenUI repeats `"` escapes and `, ` separators). The savings come only where today's blocks have no fit and the agent falls back to a `page`. Forms are the clear case. A form is also safer and looks native (app styling, validation, no iframe).

## Things to know

- **Telemetry.** `@openuidev/lang-core` has a postinstall script that sends pseudonymous install telemetry to PostHog. npm's script policy blocked it here. The Docker build stage now sets `OPENUI_TELEMETRY_DISABLED=1`. Runtime telemetry is opt-in and stays off.
- **Dev-mode CDN script.** In development, `react-lang` auto-mounts a devtools widget. It loads `@openuidev/devtools@0` from jsDelivr into the page (a floating version, cache-busted every 5 minutes) and shows a "deploy to Vercel" promo. Production builds leave it out (checked: no jsdelivr or posthog in `dist`). This branch also points the alias in `vite.config.ts` at a no-op stub, so dev is clean too.
- **Young library.** react-lang and lang-core are at 1.0.1. There is a peer dependency on zod and an optional one on `@modelcontextprotocol/sdk`.
- **Permissive parser.** Unknown components and bad arguments are dropped without any error shown, so a model mistake renders as a missing piece. `onError` could log these back to the agent.
- **Loose child types.** Layout children are typed `(... | any)[]` in the prompt so Card and Stack can nest.
- **Not done.** Form values aren't kept after a reload, and an answered form stays editable (its buttons no longer send).
- **Not verified with a live agent.** I tested in the harness, using the real reducer and renderer and pi's event shapes. I did not run a pi agent with a real model, so I haven't measured how reliably models write valid OpenUI Lang from this prompt.

## Recommendation

**Add OpenUI alongside the blocks. Don't replace them.**

- Keep the JSON blocks as the default for single things: tables, metrics, cards, buttons, charts. They cost the same or fewer tokens, and they need no parser or extra prompt.
- Use `openui` for forms and for layouts that combine several of those things. This replaces most hand-written `page` HTML for input.
- **Before merging:** run a small eval with the agents' real models to measure how often the output parses and renders completely. If it isn't reliable, the cheaper path is a native `form` JSON block, with no dependency and no extra prompt.
- **Land the tool-call streaming change (`conversation.ts`, `partialJson.ts`) either way.** It makes every show block draw while it's being written.
