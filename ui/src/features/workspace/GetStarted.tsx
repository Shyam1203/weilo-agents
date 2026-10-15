import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";

export function GetStarted({ onCreateAgent }: { onCreateAgent: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="flex animate-rise flex-col items-center text-center">
        <div className="mb-6 flex size-14 items-center justify-center rounded-2xl bg-panel shadow-pop ring-1 ring-line">
          <Icon name="agent" size={26} />
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight">Create an agent</h1>
        <Button variant="primary" size="lg" icon="plus" onClick={onCreateAgent} className="mt-6">
          New agent
        </Button>
      </div>
    </div>
  );
}
