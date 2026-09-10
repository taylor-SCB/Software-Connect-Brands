// A person's or company's picture, or their initial on the brand color
// when there isn't one. No hooks, so it renders on the server and on
// customer-facing documents alike.
export function Avatar({
  url,
  name,
  size = 32,
  round = false,
  color,
}: {
  url: string | null | undefined;
  name: string;
  size?: number;
  round?: boolean;
  // Overrides the brand variable, for documents printed on white.
  color?: string;
}) {
  const radius = round ? "9999px" : `${Math.max(6, Math.round(size / 5))}px`;
  if (url) {
    return (
      // Tenant-supplied picture; plain img on purpose (see layout.tsx).
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className="shrink-0 border border-[var(--border)] object-cover"
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center font-bold text-white"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: Math.max(10, Math.round(size * 0.42)),
        background: color ?? "var(--brand)",
      }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
