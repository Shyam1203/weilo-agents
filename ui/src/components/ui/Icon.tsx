// Lucide, the Weilo icon set, by our own short names.
import {
  ArrowDown, ArrowUp, Bell, Bot, Brain, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Copy, Download, ExternalLink, FileText, Globe, Info, Key, List, LoaderCircle, Mail, Mic, MousePointer2,
  PanelRight, Paperclip, Plug, Plus, Puzzle, RotateCcw, Search, Settings, Share, Sparkles, Square, Sun, TriangleAlert, User, X,
} from "lucide-react";

const ICONS = {
  plus: Plus,
  pointer: MousePointer2,
  clock: Clock,
  check: Check,
  close: X,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  arrowUp: ArrowUp,
  arrowDown: ArrowDown,
  bell: Bell,
  search: Search,
  settings: Settings,
  agent: Bot,
  plug: Plug,
  sparkle: Sparkles,
  puzzle: Puzzle,
  globe: Globe,
  panel: PanelRight,
  attach: Paperclip,
  mic: Mic,
  alert: TriangleAlert,
  info: Info,
  sun: Sun,
  key: Key,
  brain: Brain,
  user: User,
  mail: Mail,
  list: List,
  file: FileText,
  download: Download,
  external: ExternalLink,
  copy: Copy,
  share: Share,
  retry: RotateCcw,
} as const;

export type IconName = keyof typeof ICONS | "spinner" | "stop";

export function Icon({ name, size = 16, className = "" }: { name: IconName; size?: number; className?: string }) {
  if (name === "spinner") return <LoaderCircle size={size} className={`animate-spin ${className}`} aria-hidden="true" />;
  // Stop is a solid square, like a media stop button.
  if (name === "stop") return <Square size={size} fill="currentColor" className={className} aria-hidden="true" />;
  const Shape = ICONS[name];
  return <Shape size={size} className={className} aria-hidden="true" />;
}
