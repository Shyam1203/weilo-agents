/** The Weilo mark: the phoenix (public/logo.svg, also the favicon). */
export function Logo({ size = 28 }: { size?: number }) {
  return <img src="/logo.svg" width={size} height={size} alt="" className="shrink-0" />;
}
