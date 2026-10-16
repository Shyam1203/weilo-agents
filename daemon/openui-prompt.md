ui is a small program in OpenUI Lang, built only from the components below.

## Syntax Rules

1. Each statement is on its own line: `identifier = Expression`
2. `root` is the entry point — every program must define `root = Stack(...)`
3. Expressions are: strings ("..."), numbers, booleans (true/false), null, arrays ([...]), objects ({...}), or component calls TypeName(arg1, arg2, ...)
4. Use references for readability: define `name = ...` on one line, then use `name` later
5. EVERY variable (except root) MUST be referenced by at least one other variable. Unreferenced variables are silently dropped and will NOT render. Always include defined variables in their parent's children/items array.
6. Arguments are POSITIONAL (order matters, not names). Write `SomeComp([children], "row", "l")` NOT `SomeComp([children], direction: "row", gap: "l")` — colon syntax is NOT supported and silently breaks
7. Optional arguments can be omitted from the end
- Strings use double quotes with backslash escaping

## Component Signatures

Arguments marked with ? are optional. Sub-components can be inline or referenced; prefer references for better streaming.
Props typed `ActionExpression` accept one @step, or Action([@steps...]) for several. See the Action section for available steps (@ToAssistant, @OpenUrl).

### Layout
Stack(children: (Text | Metric | Tag | Image | File | Table | Chart | Form | Buttons | any)[], direction?: "column" | "row", gap?: "s" | "m" | "l") — Lays things out in a column (the default) or a wrapping row.
Card(children: (Text | Metric | Tag | Image | File | Table | Chart | Form | Buttons | any)[], title?: string) — A bordered box, with an optional title, around related things.

### Content
Text(markdown: string) — Markdown text.
Metric(label: string, value: string | number, note?: string) — One key number with its label.
Tag(text: string) — A small label, such as a status.
Image(src: string, alt?: string) — A picture from an https:// address (a product photo, say).
File(path: string, name?: string) — A file you made in the workspace, for the user to download; pictures show in the chat. path: from your folder, or in full.
Table(columns: string[], rows: (string | number)[][]) — Rows and columns to compare things.
Chart(shape: "bar" | "line", labels: string[], values: number[]) — A bar or line chart: one value per label.

### Forms
Form(name: string, fields: Field[], buttons: Buttons) — Fields the user fills in, then a button to send them to you.
Field(label: string, input: Input | TextArea | Select, hint?: string) — A labelled form field.
Input(name: string, placeholder?: string, type?: "text" | "email" | "number" | "url" | "date", rules?: {required?: boolean, email?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number}, value?: string) — A one-line text box.
TextArea(name: string, placeholder?: string, rules?: {required?: boolean, email?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number}, value?: string) — A text box for a few lines.
Select(name: string, options: string[], placeholder?: string, rules?: {required?: boolean, email?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number}, value?: string) — Choose one of a few options.
Buttons(buttons: Button[]) — A row of buttons.
Button(label: string, variant?: "primary" | "secondary", action?: ActionExpression) — Sends its label (inside a Form, with the form's values) as the user's reply. Give it @OpenUrl(url) to open a link instead.
- Every field inside a Form needs a unique name; the reply lists each field's value by name.

## Action — Button Behavior

An action wires a button click to operations. Pass one @-prefixed step bare, e.g. Button("Ask", @ToAssistant("Tell me more")). Put several steps in Action([...]), e.g. Button("Read", Action([@OpenUrl("https://example.com"), @ToAssistant("Summarize this page")])). Steps execute in order.
Buttons without an action automatically send their label to the assistant (equivalent to @ToAssistant(label)).

Available steps:
- @ToAssistant(message: string, context?: any) — Send a message to the assistant (for conversational buttons like "Tell me more", "Explain this"). The optional context is any value (object, array, string, number) passed to the assistant as hidden data, e.g. @ToAssistant("Show details", {orderId: 42})
- @OpenUrl(url: string) — Navigate to a URL

Example — simple nav:
```
viewBtn = Button("View", @OpenUrl("https://example.com"))
```

- An action can be assigned to a variable or inlined: Button("Go", onSubmit) and Button("Go", Action([...])) both work

## Hoisting & Streaming (CRITICAL)

openui-lang supports hoisting: a reference can be used BEFORE it is defined. The parser resolves all references after the full input is parsed.

During streaming, the output is re-parsed on every chunk. Undefined references are temporarily unresolved and appear once their definitions stream in. This creates a progressive top-down reveal — structure first, then data fills in.

**Recommended statement order for optimal streaming:**
1. `root = Stack(...)` — UI shell appears immediately
2. Component definitions — fill in as they stream
3. Data values — leaf content last

Always write the root = Stack(...) statement first so the UI shell appears immediately, even before child data has streamed in.

## Examples

root = Stack([summary, form])
summary = Card([Stack([Metric("Visits", 1240, "+12%"), Metric("Signups", 38)], "row"), Chart("bar", ["Mon", "Tue", "Wed"], [310, 420, 510])], "This week")
form = Card([Form("call", [Field("Your email", Input("email", "you@example.com", "email", {required: true, email: true})), Field("Topic", Select("topic", ["Billing", "Setup", "Other"]))], Buttons([Button("Send")]))], "Book a call")

## Important Rules
- Choose components that best represent the content (tables for comparisons, charts for trends, forms for input, etc.)

## Final Verification
Before finishing, walk your output and verify:
1. root = Stack(...) is the FIRST line (for optimal streaming).
2. Every referenced name is defined. Every defined name (other than root) is reachable from root.

- A Button's second argument is its variant and its third the action: Button("Open site", "secondary", @OpenUrl("https://example.com")).
- Give every Select a placeholder, such as "Choose one".
