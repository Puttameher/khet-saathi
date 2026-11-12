/** Hand-tuned 24px line icons (1.75 stroke). Decorative by default; pass aria-label to expose. */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 24): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round",
});
const svg = (paths: React.ReactNode) => function Icon({ size, ...p }: P) {
  return <svg {...base(size)} aria-hidden={p["aria-label"] ? undefined : true} {...p}>{paths}</svg>;
};

export const IconField = svg(<><path d="M3 20h18" /><path d="M6 20c0-4 1-7 3-9" /><path d="M12 20V9" /><path d="M18 20c0-4-1-7-3-9" /><path d="M12 9c-2.5 0-4-1.6-4-4 2.5 0 4 1.6 4 4Z" /><path d="M12 9c2.5 0 4-1.6 4-4-2.5 0-4 1.6-4 4Z" /></>);
export const IconTasks = svg(<><rect x="4" y="4" width="16" height="17" rx="3" /><path d="M9 3v3h6V3" /><path d="m8.5 13 2.2 2.2L15.5 10.5" /></>);
export const IconTalk = svg(<><path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0" /><path d="M12 17.5V21" /></>);
export const IconMic = IconTalk;
export const IconStop = svg(<rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor" stroke="none" />);
export const IconPlay = svg(<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" stroke="none" />);
export const IconPause = svg(<><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" /><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" /></>);
export const IconSpeaker = svg(<><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" /><path d="M15.5 9a4 4 0 0 1 0 6" /><path d="M18 6.5a7.5 7.5 0 0 1 0 11" /></>);
export const IconSend = svg(<><path d="M5 12h13" /><path d="m12 5 7 7-7 7" /></>);
export const IconKeyboard = svg(<><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>);
export const IconClose = svg(<><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>);
export const IconCheck = svg(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const IconClock = svg(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>);
export const IconArrowRight = svg(<><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>);
export const IconRefresh = svg(<><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" /><path d="M20 20v-4h-4" /></>);
export const IconSun = svg(<><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>);
export const IconMoon = svg(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />);
export const IconAlert = svg(<><path d="M12 3.5 2.8 19.5h18.4L12 3.5Z" /><path d="M12 10v4" /><path d="M12 17h.01" /></>);
export const IconSparkle = svg(<path d="M12 3c.5 4.2 2.8 6.5 7 7-4.2.5-6.5 2.8-7 7-.5-4.2-2.8-6.5-7-7 4.2-.5 6.5-2.8 7-7Z" />);
export const IconCloudRain = svg(<><path d="M7 15a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 7.5a3.75 3.75 0 0 1 0 7.5H7Z" /><path d="M8 18l-1 2M12 18l-1 2M16 18l-1 2" /></>);
export const IconWind = svg(<><path d="M3 9h11a3 3 0 1 0-3-3" /><path d="M3 14h15a3 3 0 1 1-3 3" /></>);

/** Task-type glyphs */
export const IconSpray = svg(<><path d="M8 10h6v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10Z" /><path d="M9.5 10V7h3v3" /><path d="M12.5 7H15l1.5-1.5" /><path d="M18.5 4.5h.01M20 7h.01M18.5 9.5h.01M21.5 4h.01" /></>);
export const IconDrop = svg(<path d="M12 3.5s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z" />);
export const IconSack = svg(<><path d="M9 3.5h6l-1.5 3h-3L9 3.5Z" /><path d="M10.5 6.5C6.5 8.5 5 12 5 15.5 5 19 7.5 21 12 21s7-2 7-5.5c0-3.5-1.5-7-5.5-9" /><path d="M10 14h4" /></>);
export const IconSickle = svg(<><path d="M14 4a7 7 0 0 1 1.5 12.5" /><path d="M14 4a5 5 0 0 0-2 8.5l-6 6" /><path d="m4.5 17 2.5 2.5" /></>);
export const IconDots = svg(<><circle cx="6" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="18" cy="12" r="1.2" fill="currentColor" /></>);
