import { fail } from "./common.mjs";
import { CONTACT_TIMEOUT_MS, CONTACT_URL, MAX_CONTACT_EMAIL, MAX_CONTACT_MESSAGE, MAX_CONTACT_NAME } from "./config.mjs";
import { BUILD } from "./version.mjs";

// "Contact us": the user's message goes to Weilo through weilo-api's contact form. What is sent is what the user typed (name,
// email, message) and the app's version, so a report says which build it is about; nothing else leaves the computer.
const TOPICS = ["Problem", "Idea", "Question", "Other"];

const text = (value, max, what) => {
  const one = typeof value === "string" ? value.trim() : "";
  if (one.length > max) throw fail(400, `The ${what} is too long. Use ${max} characters at most.`);
  return one;
};

export async function sendContact({ name, email, message, topic } = {}) {
  const from = text(email, MAX_CONTACT_EMAIL, "email");
  if (!/^\S+@\S+\.\S+$/.test(from)) throw fail(400, "Type your email, so we can answer you.");
  const body = text(message, MAX_CONTACT_MESSAGE, "message");
  if (body.length < 10) throw fail(400, "Write at least 10 characters.");
  const kind = TOPICS.includes(topic) ? topic : "Other";
  const sent = `[${kind}] ${body}

(Weilo Agents ${BUILD.version}, build ${BUILD.commit.slice(0, 7)}, pi ${BUILD.pi})`;
  let res;
  try {
    res = await fetch(CONTACT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: text(name, MAX_CONTACT_NAME, "name"), email: from, message: sent }),
      signal: AbortSignal.timeout(CONTACT_TIMEOUT_MS),
    });
  } catch {
    throw fail(502, "Could not reach Weilo. Check your internet connection and try again.");
  }
  if (res.status === 400) throw fail(400, "Weilo could not accept this message. Check your email and message.");
  if (!res.ok) throw fail(502, "Weilo could not take the message just now. Try again later.");
}
