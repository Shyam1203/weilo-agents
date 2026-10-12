/**
 * How much larger than the browser's own size the app is drawn (index.css: 1.1 on a computer, 1 on a phone). A size
 * measured on the screen (a box's place, the pointer's) is that much larger than the same size set in a style.
 */
export const zoom = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--zoom")) || 1;
