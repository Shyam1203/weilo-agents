import { useRef, useState, type ChangeEvent } from "react";
import { addSkills, removeSkill, type Skill } from "../../api/skills";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { List } from "../../components/ui/List";
import { Page, Row } from "../../components/ui/Row";
import { matches, Search } from "../../components/ui/Search";
import { useAction } from "../../lib/useAction";

interface Props {
  skills: Skill[];
  onChange: () => void;
}

export function SkillsPage({ skills, onChange }: Props) {
  const picker = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const { busy, error, run } = useAction();
  const change = (name: string, action: () => Promise<void>) =>
    run(name, async () => {
      await action();
      onChange();
    });

  const add = (e: ChangeEvent<HTMLInputElement>) => {
    const [file] = e.target.files ?? [];
    e.target.value = "";
    if (file) void change("add", () => addSkills(file));
  };

  return (
    <Page
      title="Skills"
      description="Skills teach agents how to do tasks. Turn on skills for each agent in Edit agent."
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
        {(s) => (
          <Row key={s.id} icon="sparkle" title={s.name} description={s.description}>
            <Button size="sm" variant="ghost" busy={busy === s.id} onClick={() => change(s.id, () => removeSkill(s.id))}>
              Delete
            </Button>
          </Row>
        )}
      </List>
    </Page>
  );
}
