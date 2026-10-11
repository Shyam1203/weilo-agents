import { useEffect, useState } from "react";

// Avatars: a colored character with a face. An avatar is a spec (shape + color): add a shape to
// SHAPES or a color to COLORS, and the picker and every place that shows avatars can show it.

export interface AvatarSpec {
  /** A key of SHAPES. */
  shape: string;
  /** A #rrggbb color. */
  color: string;
}

/** Each shape: its outline in a 100×100 box, and the height of its eyes. */
export const SHAPES: Record<string, { path: string; eyes: number }> = {
  blob: { path: "M50 10C78 10 94 30 94 56C94 80 76 94 50 94C24 94 6 80 6 56C6 30 22 10 50 10Z", eyes: 62 },
  ghost: { path: "M14 54C14 28 30 12 50 12C70 12 86 28 86 54V90C79 84 72 84 65 90C58 96 54 84 50 84C46 84 42 96 35 90C28 84 21 84 14 90Z", eyes: 58 },
  cat: { path: "M12 60C12 44 16 32 20 22L22 8L38 22C42 21 46 20 50 20C54 20 58 21 62 22L78 8L80 22C84 32 88 44 88 60C88 82 72 94 50 94C28 94 12 82 12 60Z", eyes: 62 },
  bunny: {
    path: "M30 34C26 22 26 6 34 4C42 2 44 18 42 32C45 31 48 31 50 31C52 31 55 31 58 32C56 18 58 2 66 4C74 6 74 22 70 34C82 40 90 52 90 66C90 84 72 94 50 94C28 94 10 84 10 66C10 52 18 40 30 34Z",
    eyes: 64,
  },
  drop: { path: "M50 8C50 8 88 46 88 66C88 84 71 94 50 94C29 94 12 84 12 66C12 46 50 8 50 8Z", eyes: 70 },
  cloud: { path: "M26 88C12 88 4 78 4 66C4 54 14 46 25 47C27 30 39 18 55 18C70 18 81 28 84 42C93 44 96 54 96 64C96 78 86 88 74 88Z", eyes: 66 },
  bear: {
    path: "M24 22C14 22 10 30 12 38C8 46 6 54 6 62C6 82 26 94 50 94C74 94 94 82 94 62C94 54 92 46 88 38C90 30 86 22 76 22C70 22 66 26 64 30C60 28 55 27 50 27C45 27 40 28 36 30C34 26 30 22 24 22Z",
    eyes: 64,
  },
  sprout: { path: "M50 30C50 30 46 16 34 10C34 10 46 6 52 18C56 8 68 6 70 8C64 12 56 18 53 30C76 32 94 46 94 64C94 82 74 94 50 94C26 94 6 82 6 64C6 46 26 32 50 30Z", eyes: 68 },
};

/** The colors a default avatar gets. */
export const COLORS = ["#D85A30", "#7F77DD", "#1D9E75", "#D4537E", "#378ADD", "#5DCAA5", "#BA7517", "#639922"];

/** What the picker calls each color. */
export const COLOR_NAMES: Record<string, string> = { "#D85A30": "Orange", "#7F77DD": "Purple", "#1D9E75": "Green", "#D4537E": "Pink", "#378ADD": "Blue", "#5DCAA5": "Mint", "#BA7517": "Gold", "#639922": "Olive" };

const INK = "#2C2C2A";

/** What a working avatar acts out, by the tool it is using: reading with glasses and a book, searching with a magnifying glass, typing at a laptop. Anything else (thinking, other tools) just bobs and looks around. */
type Scene = "read" | "search" | "type" | null;
const SCENES: Record<string, Scene> = { read: "read", grep: "search", find: "search", ls: "search", fetch_knowledge: "search", memory: "search", bash: "type", edit: "type", write: "type", browser: "type" };
// A tool's scene stays up at least this long (ms) after the tool is gone: many tools finish in a blink, and the list's copy is polled.
const SCENE_MIN_MS = 1500;
function useLingering(doing?: string | null) {
  const [shown, setShown] = useState(doing);
  useEffect(() => {
    if (doing) return setShown(doing);
    const timer = setTimeout(() => setShown(null), SCENE_MIN_MS);
    return () => clearTimeout(timer);
  }, [doing]);
  return doing || shown;
}
const sceneOf = (doing?: string | null): Scene => (doing ? (SCENES[doing] ?? null) : null);

/**
 * An avatar. Below 24px only the eyes show (blush and mouth would be smudges). `working`: it bobs
 * and looks around. Hovering it squishes it and it blinks (index.css, `.avatar`).
 */
export function Avatar({ spec, size = 36, working = false, doing }: { spec: AvatarSpec; size?: number; working?: boolean; /** The tool it is using; a working avatar acts it out. */ doing?: string | null }) {
  const shape = SHAPES[spec.shape] ?? SHAPES.blob;
  const y = shape.eyes;
  const detailed = size >= 24;
  const lingering = useLingering(doing);
  const scene = working && detailed ? sceneOf(lingering) : null;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`avatar block shrink-0 overflow-visible ${working ? "avatar-working" : ""}`}
    >
      <g className="avatar-body">
        <path d={shape.path} fill={spec.color} stroke={spec.color} strokeWidth={4} strokeLinejoin="round" />
        <g className="avatar-look">
          <g className="avatar-eyes">
            <ellipse cx={37} cy={y} rx={7.5} ry={9} fill={INK} />
            <ellipse cx={63} cy={y} rx={7.5} ry={9} fill={INK} />
          </g>
          {detailed && (
            <>
              <circle cx={39.5} cy={y - 3} r={2.4} fill="#fff" />
              <circle cx={65.5} cy={y - 3} r={2.4} fill="#fff" />
            </>
          )}
        </g>
        {detailed && (
          <>
            <ellipse cx={25} cy={y + 10} rx={7} ry={4} fill="#fff" opacity={0.35} />
            <ellipse cx={75} cy={y + 10} rx={7} ry={4} fill="#fff" opacity={0.35} />
            <path d={`M45 ${y + 9} Q47.5 ${y + 13} 50 ${y + 9} Q52.5 ${y + 13} 55 ${y + 9}`} stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" />
          </>
        )}
        {scene === "read" && (
          <>
            {/* Glasses on the eyes, and an open book whose page turns. */}
            <g fill="#fff" fillOpacity={0.3} stroke={INK} strokeWidth={3}>
              <circle cx={37} cy={y} r={12} />
              <circle cx={63} cy={y} r={12} />
            </g>
            <path d={`M49 ${y - 1} Q50 ${y - 3} 51 ${y - 1}`} stroke={INK} strokeWidth={2.5} fill="none" />
            <g stroke={INK} strokeWidth={2} strokeLinejoin="round">
              <path d="M24 78L50 84V102L24 96Z" fill="#fff" />
              <path d="M76 78L50 84V102L76 96Z" fill="#f1efe8" />
              <path className="avatar-page" d="M76 78L50 84V102L76 96Z" fill="#fff" />
            </g>
          </>
        )}
        {scene === "search" && (
          <g className="avatar-magnify">
            <circle r={14} fill="#fff" fillOpacity={0.3} stroke={INK} strokeWidth={4} />
            <path d="M10 10L24 24" stroke={INK} strokeWidth={5} strokeLinecap="round" />
          </g>
        )}
        {scene === "type" && (
          <g>
            {/* A laptop at the bottom with lines of code that appear. */}
            <rect x={22} y={70} width={56} height={28} rx={3} fill={INK} />
            <g stroke="#fff" strokeWidth={2.4} strokeLinecap="round">
              <path className="avatar-type-line" d="M29 77H50" />
              <path className="avatar-type-line" d="M29 84H62" />
              <path className="avatar-type-line" d="M29 91H44" />
            </g>
            <rect className="avatar-cursor" x={47} y={88} width={3} height={6} fill="#fff" />
            <rect x={14} y={98} width={72} height={5} rx={2.5} fill={INK} />
          </g>
        )}
      </g>
    </svg>
  );
}
