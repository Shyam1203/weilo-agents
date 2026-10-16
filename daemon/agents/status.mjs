// Tells the open apps what changed in the agent list. An agent's working state and browser come
// with the event itself, as they change often while it works; for anything else (a reply, a change
// to an agent) the app is told to read the list again, at most once a second.
const watchers = new Set();
let timer = null;

const send = (data) => watchers.forEach((write) => write(data));

export function agentsChanged() {
  if (timer || !watchers.size) return;
  timer = setTimeout(() => {
    timer = null;
    send({});
  }, 1000);
}

export function tellAgent(id, patch) {
  if (watchers.size) send({ id, ...patch });
}

export function watchAgents(write) {
  watchers.add(write);
  return () => watchers.delete(write);
}

export const watchingAgents = () => watchers.size > 0;
