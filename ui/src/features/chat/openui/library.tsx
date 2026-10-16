import {
  action,
  createLibrary,
  defineComponent,
  FormNameContext,
  FormValidationContext,
  parseStructuredRules,
  useCreateFormValidation,
  useFormName,
  useFormValidation,
  useIsStreaming,
  useStateField,
  useTriggerAction,
  type ActionPlan,
  type PromptOptions,
} from "@openuidev/react-lang";
import { useEffect, useMemo, type ReactNode } from "react";
import { z } from "zod/v4";
import { Button as UiButton } from "../../../components/ui/Button";
import { Select as UiSelect } from "../../../components/ui/Select";
import { Tag as UiTag } from "../../../components/ui/Tag";
import { CardText } from "../AgentText";
import { link, workspacePath } from "../blockData";
import { FileCard } from "../FileCard";
import { Bars, Line } from "../Charts";

// The components an agent may use in an `openui` show block. Each one renders with the app's own
// components and Tailwind tokens; the prompt the agent sees is generated from these schemas
// (npm run openui-prompt writes it to daemon/openui-prompt.md).

const CARD = "rounded-2xl border border-line bg-page";
const GAPS = { s: "gap-1.5", m: "gap-2.5", l: "gap-4" } as const;

const rules = z
  .object({ required: z.boolean().optional(), email: z.boolean().optional(), numeric: z.boolean().optional(), min: z.number().optional(), max: z.number().optional(), minLength: z.number().optional(), maxLength: z.number().optional() })
  .optional();

const Text = defineComponent({
  name: "Text",
  description: "Markdown text.",
  props: z.object({ markdown: z.string() }),
  component: ({ props }) => <CardText text={props.markdown} />,
});

const Metric = defineComponent({
  name: "Metric",
  description: "One key number with its label.",
  props: z.object({ label: z.string(), value: z.union([z.string(), z.number()]), note: z.string().optional() }),
  component: ({ props }) => (
    <div className={`${CARD} min-w-[9rem] flex-1 px-3.5 py-3`}>
      <p className="text-xs text-ink-3">{props.label}</p>
      <p className="mt-0.5 text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">{props.value}</p>
      {props.note && <p className="mt-0.5 text-xs text-ink-2">{props.note}</p>}
    </div>
  ),
});

const Tag = defineComponent({
  name: "Tag",
  description: "A small label, such as a status.",
  props: z.object({ text: z.string() }),
  component: ({ props }) => <span className="self-start"><UiTag>{props.text}</UiTag></span>,
});

const Image = defineComponent({
  name: "Image",
  description: "A picture from an https:// address (a product photo, say).",
  props: z.object({ src: z.string(), alt: z.string().optional() }),
  component: ({ props }) => {
    const src = link(props.src);
    return src ? <img src={src} alt={props.alt ?? ""} loading="lazy" referrerPolicy="no-referrer" className="max-h-56 w-full rounded-xl bg-white object-contain p-2" /> : null;
  },
});

const File = defineComponent({
  name: "File",
  description: "A file you made in the workspace, for the user to download; pictures show in the chat. path: from your folder, or in full.",
  props: z.object({ path: z.string(), name: z.string().optional() }),
  component: ({ props }) => {
    const path = workspacePath(props.path);
    return path ? <FileCard path={path} name={props.name || path.split("/").pop()!} /> : null;
  },
});

const Table = defineComponent({
  name: "Table",
  description: "Rows and columns to compare things.",
  props: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.union([z.string(), z.number()]))) }),
  component: ({ props }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-[13.5px]">
        <thead>
          <tr>
            {props.columns.map((c, i) => (
              <th key={i} className="px-3.5 py-2 text-xs font-medium whitespace-nowrap text-ink-3">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(props.rows ?? []).map((row, r) => (
            <tr key={r} className="border-t border-line">
              {props.columns.map((_, c) => (
                <td key={c} className="px-3.5 py-2 align-top">
                  {row?.[c]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
});

const Chart = defineComponent({
  name: "Chart",
  description: "A bar or line chart: one value per label.",
  props: z.object({ shape: z.enum(["bar", "line"]), labels: z.array(z.string()), values: z.array(z.number()) }),
  component: ({ props }) => {
    const points = (props.labels ?? []).flatMap((label, i) => (Number.isFinite(props.values?.[i]) ? [{ label, value: props.values[i] }] : []));
    if (!points.length) return null;
    return <div className="pb-1">{props.shape === "line" ? <Line points={points} /> : <Bars points={points} />}</div>;
  },
});

function useField(name: string, value: string | undefined, fieldRules: z.infer<typeof rules>) {
  const streaming = useIsStreaming();
  const validation = useFormValidation();
  const field = useStateField(name, value);
  const parsed = useMemo(() => parseStructuredRules(fieldRules), [fieldRules]);
  useEffect(() => {
    if (streaming || !parsed.length || !validation) return;
    validation.registerField(field.name, parsed, () => field.value);
    return () => validation.unregisterField(field.name);
  }, [field.name, field.value, validation, parsed, streaming]);
  return { field, streaming, error: validation?.errors[field.name], clear: () => validation?.clearFieldError(field.name) };
}

const Checked = ({ error, children }: { error?: string; children: ReactNode }) => (
  <>
    {children}
    {error && <span className="text-xs text-bad">{error}</span>}
  </>
);

const Input = defineComponent({
  name: "Input",
  description: "A one-line text box.",
  props: z.object({ name: z.string(), placeholder: z.string().optional(), type: z.enum(["text", "email", "number", "url", "date"]).optional(), rules, value: z.string().optional() }),
  component: ({ props }) => {
    const { field, streaming, error, clear } = useField(props.name, props.value as string | undefined, props.rules);
    return (
      <Checked error={error}>
      <input
        className="input"
        name={field.name}
        type={props.type ?? "text"}
        placeholder={props.placeholder ?? ""}
        value={(field.value as string) ?? ""}
        disabled={streaming}
        onFocus={clear}
        onChange={(e) => field.setValue(e.target.value)}
      />
      </Checked>
    );
  },
});

const TextArea = defineComponent({
  name: "TextArea",
  description: "A text box for a few lines.",
  props: z.object({ name: z.string(), placeholder: z.string().optional(), rules, value: z.string().optional() }),
  component: ({ props }) => {
    const { field, streaming, error, clear } = useField(props.name, props.value as string | undefined, props.rules);
    return <Checked error={error}><textarea className="input min-h-20 resize-y" name={field.name} placeholder={props.placeholder ?? ""} value={(field.value as string) ?? ""} disabled={streaming} onFocus={clear} onChange={(e) => field.setValue(e.target.value)} /></Checked>;
  },
});

const Select = defineComponent({
  name: "Select",
  description: "Choose one of a few options.",
  props: z.object({ name: z.string(), options: z.array(z.string()), placeholder: z.string().optional(), rules, value: z.string().optional() }),
  component: ({ props }) => {
    const { field, streaming, error, clear } = useField(props.name, props.value as string | undefined, props.rules);
    const options = (props.options ?? []).map((o) => ({ value: o, label: o }));
    return <Checked error={error}><UiSelect label={props.name} value={(field.value as string) ?? ""} options={options} placeholder={props.placeholder ?? "Choose one"} disabled={streaming} onChange={(v) => (clear(), field.setValue(v))} /></Checked>;
  },
});

const Field = defineComponent({
  name: "Field",
  description: "A labelled form field.",
  props: z.object({ label: z.string(), input: z.union([Input.ref, TextArea.ref, Select.ref]), hint: z.string().optional() }),
  component: ({ props, renderNode }) => (
    <div className="flex flex-col gap-1.5">
      <span className="label">{props.label}</span>
      {renderNode(props.input)}
      {props.hint && <span className="hint">{props.hint}</span>}
    </div>
  ),
});

const Button = defineComponent({
  name: "Button",
  description: "Sends its label (inside a Form, with the form's values) as the user's reply. Give it @OpenUrl(url) to open a link instead.",
  props: z.object({ label: z.string(), variant: z.enum(["primary", "secondary"]).optional(), action: action().optional() }),
  component: ({ props }) => {
    const trigger = useTriggerAction();
    const form = useFormName();
    const validation = useFormValidation();
    const streaming = useIsStreaming();
    // Models often put the action second, where the variant goes (the generic action docs show it so): take it there too.
    const misplaced = typeof props.variant === "object" ? (props.variant as unknown as ActionPlan) : undefined;
    const variant = (misplaced ? undefined : props.variant) ?? (form ? "primary" : "secondary");
    const plan = (props.action as ActionPlan | undefined) ?? misplaced;
    return (
      <UiButton
        variant={variant}
        disabled={streaming}
        onClick={() => {
          if (validation && variant === "primary" && !validation.validateForm()) return;
          trigger(props.label, form, plan);
        }}
      >
        {props.label}
      </UiButton>
    );
  },
});

const Buttons = defineComponent({
  name: "Buttons",
  description: "A row of buttons.",
  props: z.object({ buttons: z.array(Button.ref) }),
  component: ({ props, renderNode }) => <div className="flex flex-wrap gap-2">{renderNode(props.buttons)}</div>,
});

const Form = defineComponent({
  name: "Form",
  description: "Fields the user fills in, then a button to send them to you.",
  props: z.object({ name: z.string(), fields: z.array(Field.ref), buttons: Buttons.ref }),
  component: ({ props, renderNode }) => {
    const validation = useCreateFormValidation();
    return (
      <FormValidationContext.Provider value={validation}>
        <FormNameContext.Provider value={props.name}>
          <div role="form" className="flex flex-col gap-3">
            {renderNode(props.fields)}
            {renderNode(props.buttons)}
          </div>
        </FormNameContext.Provider>
      </FormValidationContext.Provider>
    );
  },
});

const children = z.array(z.union([Text.ref, Metric.ref, Tag.ref, Image.ref, File.ref, Table.ref, Chart.ref, Form.ref, Buttons.ref, z.any()]));

const Card = defineComponent({
  name: "Card",
  description: "A bordered box, with an optional title, around related things.",
  props: z.object({ children, title: z.string().optional() }),
  component: ({ props, renderNode }) => (
    <section className={`${CARD} flex max-w-full flex-col gap-2.5 overflow-hidden px-3.5 py-3`}>
      {props.title && <h3 className="text-[13.5px] font-medium">{props.title}</h3>}
      {renderNode(props.children)}
    </section>
  ),
});

const Stack = defineComponent({
  name: "Stack",
  description: "Lays things out in a column (the default) or a wrapping row.",
  props: z.object({ children, direction: z.enum(["column", "row"]).optional(), gap: z.enum(["s", "m", "l"]).optional() }),
  component: ({ props, renderNode }) => <div className={`flex max-w-full ${props.direction === "row" ? "flex-row flex-wrap" : "flex-col"} ${GAPS[props.gap ?? "m"]}`}>{renderNode(props.children) as ReactNode}</div>,
});

export const library = createLibrary({
  root: "Stack",
  components: [Stack, Card, Text, Metric, Tag, Image, File, Table, Chart, Form, Field, Input, TextArea, Select, Buttons, Button],
  componentGroups: [
    { name: "Layout", components: ["Stack", "Card"] },
    { name: "Content", components: ["Text", "Metric", "Tag", "Image", "File", "Table", "Chart"] },
    { name: "Forms", components: ["Form", "Field", "Input", "TextArea", "Select", "Buttons", "Button"], notes: ["- Every field inside a Form needs a unique name; the reply lists each field's value by name."] },
  ],
});

export const PROMPT: PromptOptions = {
  preamble: "ui is a small program in OpenUI Lang, built only from the components below.",
  additionalRules: [
    `A Button's second argument is its variant and its third the action: Button("Open site", "secondary", @OpenUrl("https://example.com")).`,
    `Give every Select a placeholder, such as "Choose one".`,
  ],
  toolCalls: false,
  bindings: false,
  builtinFunctions: false,
  examples: [
    `root = Stack([summary, form])
summary = Card([Stack([Metric("Visits", 1240, "+12%"), Metric("Signups", 38)], "row"), Chart("bar", ["Mon", "Tue", "Wed"], [310, 420, 510])], "This week")
form = Card([Form("call", [Field("Your email", Input("email", "you@example.com", "email", {required: true, email: true})), Field("Topic", Select("topic", ["Billing", "Setup", "Other"]))], Buttons([Button("Send")]))], "Book a call")`,
  ],
};
