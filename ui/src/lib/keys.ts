export const finePointer = () => matchMedia("(pointer: fine)").matches;

export const isFreeKey = (event: KeyboardEvent) => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false;
  if (document.querySelector('[role="dialog"]')) return false;
  const target = event.target as HTMLElement | null;
  return !target || target === document.body || target.tagName === "BUTTON" || target.tagName === "A";
};
