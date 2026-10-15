export const zoom = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--zoom")) || 1;
