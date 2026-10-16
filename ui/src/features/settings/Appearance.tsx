import { useState } from "react";
import { Card, Page, Row } from "../../components/ui/Row";
import { Select } from "../../components/ui/Select";
import { getTheme, setTheme, type Theme } from "../../lib/theme";

const THEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "weilo", label: "Weilo Theme" },
];

export function Appearance() {
  const [theme, setChoice] = useState<Theme>(getTheme);
  return (
    <Page section title="Appearance">
      <Card>
        <Row title="Theme" description="Light, dark, or like your computer.">
          <div className="w-40">
            <Select label="Theme" value={theme} options={THEMES} onChange={(t) => (setTheme(t as Theme), setChoice(t as Theme))} />
          </div>
        </Row>
      </Card>
    </Page>
  );
}
