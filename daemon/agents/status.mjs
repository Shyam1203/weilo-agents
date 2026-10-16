// Tells the open apps that the agent list changed (an agent started or stopped working, replied, or
// was changed), so they read it again instead of asking every few seconds.
const watchers = new Set();
let timer = null;

export function agentsChanged() {
  if (timer || !watchers.size) return;
  timer = setTimeout(() => {
    timer = null;
    watchers.forEach((send) => send());
  }, 200);
}

export function watchAgents(send) {
  watchers.add(send);
  return () => watchers.delete(send);
}

export const watchingAgents = () => watchers.size > 0;
