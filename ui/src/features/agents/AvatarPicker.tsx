import { Avatar, COLOR_NAMES, COLORS, SHAPES, type AvatarSpec } from "../../components/ui/Avatar";

// The shapes and the colors in even rows, four a row on a phone and eight on a computer, each color under a shape.
export function AvatarPicker({ value, onChange }: { value: AvatarSpec; onChange: (avatar: AvatarSpec) => void }) {
  return (
    <div className="flex items-center gap-4">
      <Avatar spec={value} size={64} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div role="radiogroup" aria-label="Avatar shape" className="grid w-max grid-cols-4 gap-0.5 sm:grid-cols-8">
          {Object.keys(SHAPES).map((shape) => (
            <button
              key={shape}
              type="button"
              role="radio"
              aria-checked={value.shape === shape}
              aria-label={shape}
              title={shape}
              onClick={() => onChange({ ...value, shape })}
              className={`rounded-lg p-1 transition-colors ${value.shape === shape ? "bg-select ring-1 ring-line-strong" : "hover:bg-select"}`}
            >
              <Avatar spec={{ shape, color: value.color }} size={26} />
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Avatar color" className="grid w-max grid-cols-4 gap-x-4 gap-y-2 px-[7px] sm:grid-cols-8">
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={value.color === color}
              aria-label={COLOR_NAMES[color] ?? color}
              onClick={() => onChange({ ...value, color })}
              style={{ background: color }}
              className={`size-5 rounded-full transition-transform hover:scale-110 ${value.color === color ? "ring-2 ring-ink ring-offset-2 ring-offset-raised" : ""}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
