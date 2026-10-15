import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { updateAgent, type Agent } from "../../api/agents";
import { addSkills, removeSkill, type Skill } from "../../api/skills";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { List } from "../../components/ui/List";
import { Menu, MenuItem } from "../../components/ui/Menu";
import { Page, Row } from "../../components/ui/Row";
import { matches, Search } from "../../components/ui/Search";
import { useAction } from "../../lib/useAction";
import { avatarOf } from "../agents/avatars";

const CONFIRM_MS = 4000;

interface Props {
  skills: Skill[];
  agents: Agent[];
  onChange: () => void;
}

export function SkillsPage({ skills, agents, onChange }: Props) {
  const picker = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const change = (name: string, action: () => Promise<unknown>) =>
    run(name, async () => {
      await action();
      onChange();
    });

  useEffect(() => {
    if (!confirm) return;
    const timer = setTimeout(() => setConfirm(null), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirm]);

  const add = (e: ChangeEvent<HTMLInputElement>) => {
    const [file] = e.target.files ?? [];
    e.target.value = "";
    if (file) void change("add", () => addSkills(file));
  };
  const remove = (id: string) => (confirm === id ? (setConfirm(null), void change(id, () => removeSkill(id))) : setConfirm(id));
  const turnOn = (skill: Skill, agent: Agent) => void change(skill.id, () => updateAgent(agent.id, { ...agent, skills: [...agent.skills, skill.id] }));

  return (
    <Page
      title="Skills"
      description="Skills teach agents how to do tasks. Turn a skill on for an agent here or in Edit agent."
      action={
        <>
          <input ref={picker} type="file" accept=".zip,.md" onChange={add} className="hidden" />
          <Button size="sm" icon="plus" busy={busy === "add"} onClick={() => picker.current?.click()}>
            Add
          </Button>
        </>
      }
    >
      <ErrorText>{error}</ErrorText>
      {skills.length > 0 && <Search value={query} onChange={setQuery} label="Search skills" />}
      <List items={skills.filter((s) => matches(query, s.name, s.description))} empty={skills.length ? "No skills match." : "No skills yet. Add a skill as a .zip file or a SKILL.md file."}>
        {(s) => {
          const users = agents.filter((a) => a.skills.includes(s.id));
          const others = agents.filter((a) => !users.includes(a));
          return (
            <Row
              key={s.id}
              icon="sparkle"
              title={s.name}
              description={
                <>
                  <span title={s.description} className="line-clamp-2">
                    {s.description}
                  </span>
                  <span className="mt-1.5 flex items-center gap-1.5 text-ink-2">
                    {users.length > 0 && (
                      <span className="flex -space-x-1.5">
                        {users.slice(0, 4).map((a) => (
                          <Avatar key={a.id} spec={avatarOf(a)} size={18} />
                        ))}
                      </span>
                    )}
                    {users.length === 0 ? "Not used by any agent" : users.length === 1 ? `Used by ${users[0].name}` : `Used by ${users.length} agents`}
                  </span>
                </>
              }
            >
              {others.length > 0 && (
                <Menu
                  trigger={({ toggle }) => (
                    <Button size="sm" variant="ghost" icon="plus" busy={busy === s.id} onClick={toggle}>
                      Turn on
                    </Button>
                  )}
                >
                  {(close) =>
                    others.map((a) => (
                      <MenuItem
                        key={a.id}
                        label={
                          <span className="flex min-w-0 items-center gap-2">
                            <Avatar spec={avatarOf(a)} size={20} />
                            <span className="truncate">{a.name}</span>
                          </span>
                        }
                        onClick={() => (close(), turnOn(s, a))}
                      />
                    ))
                  }
                </Menu>
              )}
              <Button size="sm" variant={confirm === s.id ? "danger" : "ghost"} disabled={busy === s.id} onClick={() => remove(s.id)}>
                {confirm === s.id ? "Tap to delete" : "Delete"}
              </Button>
            </Row>
          );
        }}
      </List>
    </Page>
  );
}
