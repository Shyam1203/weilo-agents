// The parts of noVNC's RFB client the live view uses (the package ships no types).
declare module "@novnc/novnc" {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: { shared?: boolean });
    viewOnly: boolean;
    scaleViewport: boolean;
    background: string;
    disconnect(): void;
    focus(): void;
    /** Presses and releases a key (with `down` given, only the one). `code` is the physical key, if known. */
    sendKey(keysym: number, code: string | null, down?: boolean): void;
  }
}
