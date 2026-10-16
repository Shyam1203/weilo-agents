import { Icon } from "../../components/ui/Icon";
import { kindOf } from "../files/kinds";
import { useFileUrl, usePreview } from "../files/PreviewContext";

const CARD = "rounded-2xl border border-line bg-page";

export function FileCard({ path, name }: { path: string; name: string }) {
  const url = useFileUrl()(path);
  const preview = usePreview();
  const kind = kindOf(path);
  return (
    <div className={`${CARD} max-w-sm overflow-hidden`}>
      {kind === "image" && (
        <button type="button" onClick={() => preview(path, name)} aria-label={`Preview ${name}`} className="block w-full">
          <img src={url} alt={name} className="max-h-72 w-full object-contain" />
        </button>
      )}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <Icon name="attach" size={15} className="shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1 truncate text-[13.5px]">{name}</span>
        {kind !== "other" && kind !== "image" && (
          <button type="button" onClick={() => preview(path, name)} className="shrink-0 text-[13px] font-medium underline underline-offset-2">
            Preview
          </button>
        )}
        <a href={url} download={name} className="shrink-0 text-[13px] font-medium underline underline-offset-2">
          Download
        </a>
      </div>
    </div>
  );
}
