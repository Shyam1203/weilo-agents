import { useCallback, useEffect, useRef, useState } from "react";
import { listAgents, type Agent } from "./api/agents";
import { messageOf } from "./api/http";
import { listExtensions, type Extension } from "./api/extensions";
import { listPlugins, type Plugin } from "./api/plugins";
import { listModels, listProviders, setEnabledModels, type Model, type Provider } from "./api/providers";
import { listSkills, type Skill } from "./api/skills";
import { getUser, type User } from "./api/user";
import { FullScreenStatus } from "./components/FullScreenStatus";
import { Workspace } from "./features/workspace/Workspace";

export function App() {
  const [data, setData] = useState<{ agents: Agent[]; providers: Provider[]; skills: Skill[]; plugins: Plugin[]; extensions: Extension[]; user: User }>();
  const [models, setModels] = useState<Model[]>();
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [agents, providers, skills, plugins, extensions, user] = await Promise.all([listAgents(), listProviders(), listSkills(), listPlugins(), listExtensions(), getUser()]);
      setData({ agents, providers, skills, plugins, extensions, user });
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // After a chat or an agent changes, only the agent list (newest messages) needs reading again.
  const reloadAgents = useCallback(() => listAgents().then((agents) => setData((d) => d && { ...d, agents }), () => {}), []);

  // Models come from pi and take a moment; load them in the background, again when the keys change.
  const keys = data?.providers.filter((p) => p.connected).map((p) => p.id).join();
  useEffect(() => {
    if (keys === undefined) return;
    if (!keys) return setModels([]);
    let current = true;
    listModels().then((m) => current && setModels(m), () => current && setModels([]));
    return () => {
      current = false;
    };
  }, [keys]);

  // Shown at once, saved behind it one save at a time (so the last one wins); if a save fails the list is read back.
  const saving = useRef(Promise.resolve());
  const enableModels = (ids: string[]) => {
    setModels((all) => all?.map((m) => ({ ...m, enabled: ids.includes(m.id) })));
    saving.current = saving.current.then(() => setEnabledModels(ids).catch(() => listModels().then(setModels, () => {})));
  };

  if (!data) return <FullScreenStatus error={error} onRetry={reload} />;
  return <Workspace agents={data.agents} providers={data.providers} skills={data.skills} plugins={data.plugins} extensions={data.extensions} user={data.user} models={models} onModels={enableModels} reload={reload} reloadAgents={reloadAgents} />;
}
