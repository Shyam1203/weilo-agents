export const finePointer = () => matchMedia("(pointer: fine)").matches;

export const composing = (event: KeyboardEvent) => event.isComposing || event.keyCode === 229;

const OWN_KEYS = '[role="menu"], [role="listbox"], [role="radiogroup"], [role="tablist"]';

export const isFreeKey = (event: KeyboardEvent) => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || composing(event)) return false;
  if (document.querySelector('[role="dialog"]')) return false;
  const target = event.target as HTMLElement | null;
  if (target?.closest?.(OWN_KEYS)) return false;
  return !target || target === document.body || target.tagName === "BUTTON" || target.tagName === "A";
};
