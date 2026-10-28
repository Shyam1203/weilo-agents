import type { SVGProps } from "react";

/** Icons drawn as in the approved mock: 1.75 stroke, round caps. */
type GlyphProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function glyph(paths: React.ReactNode, defaults: { strokeWidth?: number; join?: boolean } = {}) {
  return function Glyph({ size = 16, strokeWidth, ...rest }: GlyphProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth ?? defaults.strokeWidth ?? 1.75}
        strokeLinecap="round"
        strokeLinejoin={defaults.join === false ? undefined : "round"}
        aria-hidden="true"
        focusable="false"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const HomeIcon = glyph(<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />);
export const RoutinesIcon = glyph(<path d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7v5l3 2" />);
export const ConnectionsIcon = glyph(<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5" />);
export const SettingsIcon = glyph(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </>,
);
export const InboxIcon = glyph(<path d="M4 13h4l2 3h4l2-3h4M5 13l2-8h10l2 8v6H5z" />);
export const CodeIcon = glyph(<path d="M8 8l-4 4 4 4M16 8l4 4-4 4" />);
export const PlusIcon = glyph(<path d="M12 5v14M5 12h14" />);
export const ChevronDownIcon = glyph(<path d="M6 9l6 6 6-6" />, { strokeWidth: 2.5 });
export const CloseIcon = glyph(<path d="M6 6l12 12M18 6L6 18" />, { strokeWidth: 2.5 });
export const CheckIcon = glyph(<path d="M5 12l5 5 9-10" />);
export const AlertIcon = glyph(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16v.5" />
  </>,
);
export const SearchIcon = glyph(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </>,
);
export const PanelIcon = glyph(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </>,
  { join: false },
);
export const SidebarIcon = glyph(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </>,
);
export const MailIcon = glyph(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7l9 6 9-6" />
  </>,
);
export const ScreenIcon = glyph(
  <>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </>,
);
export const ChatIcon = glyph(<path d="M4 5h16v11H8l-4 4z" />);
export const AgentsIcon = glyph(
  <>
    <circle cx="9" cy="9" r="3.5" />
    <circle cx="17" cy="10" r="2.5" />
    <path d="M3 20c0-3.5 3-6 6-6s6 2.5 6 6M15 20c0-2 1-4 3-4s3 1.5 3 4" />
  </>,
);
export const YouIcon = glyph(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
  </>,
);
export const MoreIcon = glyph(
  <>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </>,
  { strokeWidth: 2 },
);
export const BackIcon = glyph(<path d="M15 6l-6 6 6 6" />);
export const SendIcon = glyph(<path d="M12 19V5M6 11l6-6 6 6" />, { strokeWidth: 2 });
export const XCircleIcon = glyph(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 9l6 6M15 9l-6 6" />
  </>,
);
export const SpinnerIcon = glyph(<path d="M12 3a9 9 0 1 0 9 9" />);
export const FolderIcon = glyph(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />);
export const FileIcon = glyph(<path d="M6 3h8l4 4v14H6zM14 3v4h4" />);
export const TodoIcon = glyph(<path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />);
export const TerminalIcon = glyph(<path d="M4 6l5 6-5 6M12 18h8" />);
/** A step that ended before it finished: a circle with a bar, quiet. */
export const StopIcon = glyph(<path d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M8 12h8" />);
