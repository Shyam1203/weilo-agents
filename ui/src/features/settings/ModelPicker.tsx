import { modelsOf, type Model } from "../../api/providers";
import { Loading } from "../../components/ui/List";
import { Toggles } from "../../components/ui/Toggles";

interface Props {
  providerId: string;
  models?: Model[];
  onChange: (ids: string[]) => void;
}

export function ModelPicker({ providerId, models, onChange }: Props) {
  if (!models) return <Loading />;
  const own = modelsOf(models, providerId);
  const enabled = own.filter((m) => m.enabled).map((m) => m.id);
  const others = models.filter((m) => m.enabled && !own.includes(m)).map((m) => m.id);

  return (
    <div className="mt-3 flex flex-col gap-2">
      {enabled.length === 0 && <p className="hint">None are on, so agents can choose any model.</p>}
      <Toggles label="models" items={own.map((m) => ({ id: m.id, name: m.name }))} empty="No models." value={enabled} onChange={(ids) => onChange([...others, ...ids])} />
    </div>
  );
}
