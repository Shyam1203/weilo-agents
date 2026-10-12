import { randomUUID } from "node:crypto";
import { AUTH, fail, INSTALL, MODELS, updateJson } from "../common.mjs";
import { PI_SDK, PROVIDERS, SIGN_IN_AS, SIGN_IN_STEP_MS, SIGN_IN_TIMEOUT_MS } from "../config.mjs";
import { syncCompaction } from "./providers.mjs";

// Signing in to a provider with an account (Claude Pro or Max, ChatGPT, GitHub Copilot…) instead of a key: pi's own
// login, which saves the tokens in auth.json and renews them itself. One sign-in at a time per provider.
//
// The browser that signs in is never inside this container, so where a provider offers a way that works from another
// device (a code to copy, a device code) it is taken, and a provider that sends the browser back to a localhost address
// (pi listens for it in here, out of the browser's reach) has that address pasted in. What the UI shows is the sign-in's `view`:
//   { state: "working" | "waiting" | "done" | "failed", message?, url?, code?, ask? }
//   url   the page to open; code  a code to type there (a device code)
//   ask   what the user answers: { type: "text" | "secret" | "select" | "paste", message, placeholder?, options? }

const logins = new Map();

// The choice that works from another device: "copy code", "device code".
const remoteChoice = (options) => options.find((o) => /code/i.test(o.id))?.id;

// This installation's id, made once (ChatGPT's sign-in names the device it signs in).
async function installId() {
  const { id } = await updateJson(INSTALL, (data) => (data.id ? data : { ...data, id: randomUUID() }));
  return id;
}

function check(id) {
  if (!PROVIDERS.some((p) => p.id === id && p.signIn)) throw fail(404, "This provider has no sign-in");
}

// The sign-in's view changed: whoever waits for the next step goes on.
function show(login, change) {
  Object.assign(login.view, change);
  const wake = login.wake;
  login.wake = null;
  wake?.();
}

// Waits for the sign-in to need the user (a page, a code, a question) or to end, or for a while; then its view.
async function settle(login) {
  const ready = () => login.view.state !== "working";
  const end = Date.now() + SIGN_IN_STEP_MS;
  while (!ready() && Date.now() < end) {
    await new Promise((resolve) => {
      login.wake = resolve;
      setTimeout(resolve, end - Date.now());
    });
  }
  return login.view;
}

export async function startSignIn(id) {
  check(id);
  logins.get(id)?.controller.abort();
  const device = await installId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SIGN_IN_TIMEOUT_MS);
  const login = { controller, view: { state: "working" }, answer: null, wake: null };
  logins.set(id, login);

  const interaction = {
    signal: controller.signal,
    notify(event) {
      if (event.type === "auth_url") show(login, { state: "waiting", url: event.url });
      else if (event.type === "device_code") show(login, { state: "waiting", url: event.verificationUri, code: event.userCode });
      else if (event.message) show(login, { message: event.message });
    },
    prompt(prompt) {
      if (prompt.type === "select") {
        const remote = remoteChoice(prompt.options);
        if (remote) return Promise.resolve(remote);
      }
      return new Promise((resolve, reject) => {
        const { type, message, placeholder, options } = prompt;
        const ask = { type: type === "manual_code" ? "paste" : type, message, placeholder, options: options?.map(({ id, label }) => ({ id, label })) };
        const cancel = () => {
          if (login.answer !== resolve) return;
          login.answer = null;
          show(login, { state: login.view.url ? "waiting" : "working", ask: undefined });
          reject(new Error("Cancelled"));
        };
        prompt.signal?.addEventListener("abort", cancel, { once: true });
        controller.signal.addEventListener("abort", cancel, { once: true });
        login.answer = resolve;
        show(login, { state: "waiting", ask });
      });
    },
  };

  void (async () => {
    try {
      const { ModelRuntime } = await import(PI_SDK);
      const runtime = await ModelRuntime.create({ authPath: AUTH, modelsPath: MODELS });
      await runtime.login(id, "oauth", interaction, { agentName: SIGN_IN_AS, getDeviceId: () => device });
      void syncCompaction();
      show(login, { state: "done", url: undefined, code: undefined, ask: undefined, message: undefined });
    } catch (err) {
      const message = controller.signal.aborted ? "The sign-in was stopped. Try again." : err.message;
      show(login, { state: "failed", url: undefined, code: undefined, ask: undefined, message });
    } finally {
      clearTimeout(timer);
    }
  })();
  return settle(login);
}

function current(id) {
  check(id);
  const login = logins.get(id);
  if (!login) throw fail(404, "No sign-in is going on");
  return login;
}

export const signInStatus = (id) => current(id).view;

export async function answerSignIn(id, answer) {
  const login = current(id);
  if (!login.answer) throw fail(409, "The sign-in is not asking anything now");
  if (typeof answer !== "string") throw fail(400, "Type an answer");
  const resolve = login.answer;
  login.answer = null;
  show(login, { state: "working", ask: undefined, message: undefined });
  resolve(answer.trim());
  return settle(login);
}

export function stopSignIn(id) {
  check(id);
  logins.get(id)?.controller.abort();
  logins.delete(id);
}
