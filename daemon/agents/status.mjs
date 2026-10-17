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
