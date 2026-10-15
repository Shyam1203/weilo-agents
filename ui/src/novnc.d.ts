declare module "@novnc/novnc" {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: { shared?: boolean });
    viewOnly: boolean;
    scaleViewport: boolean;
    background: string;
    disconnect(): void;
    focus(): void;
    sendKey(keysym: number, code: string | null, down?: boolean): void;
  }
}
