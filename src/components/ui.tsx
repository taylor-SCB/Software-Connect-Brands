import { TAG_COLORS, TAG_LABELS, type LineItemTagValue } from "@/lib/constants";

// Presentational primitives with no hooks, so they can be rendered from
// server components and client components alike.

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
  leading,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  // A picture to the left of the title: a company's logo, a contact's photo.
  leading?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-4">
        {leading}
        <div>
          {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="muted mt-1 text-sm">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  children,
  className = "",
  lit = false,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  lit?: boolean;
  id?: string;
}) {
  return (
    <div id={id} className={`card ${lit ? "card-lit" : ""} ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3.5">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <p className="faint mt-0.5 text-xs">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && (
        <div
          className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl"
          style={{
            background: "color-mix(in srgb, var(--brand) 14%, transparent)",
            color: "var(--brand)",
          }}
        >
          {icon}
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {body && <p className="faint mt-1 max-w-sm text-xs leading-relaxed">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// A budget bar: what has been spent, what is committed and what is left
// of an amount. Amber past 85% of the budget, red once it is over.
export function Meter({
  segments,
  max,
  label,
  height = 22,
}: {
  segments: { cents: number; tone: "spent" | "committed" }[];
  max: number;
  label: string;
  height?: number;
}) {
  const used = segments.reduce((sum, segment) => sum + Math.max(0, segment.cents), 0);
  const over = max > 0 && used > max;
  const share = max > 0 ? used / max : 0;
  const tight = share > 0.85;
  const color = over ? "var(--danger)" : tight ? "var(--warn)" : "var(--brand)";
  // With nothing awarded yet, anything spent fills the whole bar: there
  // is no budget to be inside of.
  const scale = max > 0 ? max : used;

  return (
    <div
      className="flex overflow-hidden rounded-full border border-[rgb(255_255_255/0.08)] bg-[rgb(255_255_255/0.06)]"
      style={{ height }}
      role="img"
      aria-label={label}
      data-testid="meter"
      data-over={over ? "1" : "0"}
    >
      {segments.map((segment, index) => {
        const width = scale > 0 ? Math.min(100, (Math.max(0, segment.cents) / scale) * 100) : 0;
        if (width === 0) return null;
        return (
          <div
            key={index}
            style={{
              width: `${width}%`,
              background:
                segment.tone === "spent"
                  ? color
                  : `repeating-linear-gradient(135deg, ${color} 0 5px, rgb(255 255 255 / 0.12) 5px 10px)`,
            }}
          />
        );
      })}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: string;
}) {
  const color = accent ?? "var(--brand)";
  return (
    <div className="card card-hover relative overflow-hidden p-4">
      <div
        className="absolute -right-6 -top-8 h-20 w-20 rounded-full opacity-40 blur-2xl"
        style={{ background: color }}
      />
      <p className="eyebrow">{label}</p>
      <p className="num mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="faint mt-1 text-xs">{hint}</p>}
    </div>
  );
}

// Tinted pill. `color` is any CSS color; the background/border are mixed
// from it so a single hue drives the whole chip.
export function Badge({
  children,
  color = "var(--text-dim)",
  dot = false,
}: {
  children: React.ReactNode;
  color?: string;
  dot?: boolean;
}) {
  return (
    <span
      className="badge"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 32%, transparent)`,
      }}
    >
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}

export function TagBadge({ tag }: { tag: LineItemTagValue }) {
  return <Badge color={TAG_COLORS[tag]}>{TAG_LABELS[tag]}</Badge>;
}

const STATUS_COLORS: Record<string, string> = {
  LEAD: "#fbbf24",
  CUSTOMER: "#34d399",
  ARCHIVED: "#64748b",
  NEW: "#38bdf8",
  CONTACTED: "#fbbf24",
  QUOTE_SENT: "#a78bfa",
  CONTRACT_SENT: "#f97316",
  WON: "#34d399",
  LOST: "#fb7185",
  DRAFT: "#94a3b8",
  SENT: "#38bdf8",
  ACCEPTED: "#34d399",
  DECLINED: "#fb7185",
  SIGNED: "#34d399",
  PENDING: "#fbbf24",
  ACTIVE: "#34d399",
  PAUSED: "#f97316",
  REJECTED: "#fb7185",
  APPROVED: "#34d399",
  EXPIRED: "#64748b",
  INACTIVE: "#64748b",
  CANCELLED: "#64748b",
  OPEN: "#38bdf8",
  PAID: "#34d399",
  DUE: "#fbbf24",
  OVERDUE: "#fb7185",
  AWARDED: "#818cf8",
  COMPLETED: "#64748b",
  // A job on hold reads "Delayed"; see STATUS_LABELS below.
  ON_HOLD: "#f97316",
};

// Where the plain-words label isn't just the status with a capital
// letter. A job that is ON_HOLD is "Delayed" everywhere it shows.
const STATUS_LABELS: Record<string, string> = {
  ON_HOLD: "Delayed",
};

export function StatusBadge({ status }: { status: string }) {
  const label =
    STATUS_LABELS[status] ?? status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
  return (
    <Badge color={STATUS_COLORS[status] ?? "var(--text-dim)"} dot>
      {label}
    </Badge>
  );
}

// Lives in its own client file because it reads the navigation trail;
// re-exported here so every page keeps importing it from the UI kit.
export { BackLink } from "./back-link";

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    // role=alert so the failure is announced rather than silently drawn
    // below a form the user is still looking at the top of.
    <p
      role="alert"
      className="rounded-lg border border-[rgb(251_113_133/0.3)] bg-[rgb(251_113_133/0.09)] px-3 py-2 text-xs text-[var(--danger)]"
    >
      {message}
    </p>
  );
}

export function FormSuccess({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className="rounded-lg border border-[rgb(52_211_153/0.3)] bg-[rgb(52_211_153/0.09)] px-3 py-2 text-xs text-[var(--ok)]"
    >
      {message}
    </p>
  );
}

export function Field({
  label,
  name,
  type = "text",
  placeholder,
  defaultValue,
  required = false,
  hint,
  step,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string | number;
  required?: boolean;
  hint?: string;
  // A number input rejects decimals unless told otherwise; money fields
  // pass "0.01".
  step?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
        {!required && <span className="faint font-normal"> · optional</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        step={step}
        className="input"
      />
      {hint && <p className="faint mt-1 text-xs">{hint}</p>}
    </div>
  );
}

export function TextareaField({
  label,
  name,
  placeholder,
  defaultValue,
  rows = 4,
  required = false,
  hint,
}: {
  label: string;
  name: string;
  placeholder?: string;
  defaultValue?: string;
  rows?: number;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      <textarea
        id={name}
        name={name}
        rows={rows}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        className="textarea"
      />
      {hint && <p className="faint mt-1 text-xs">{hint}</p>}
    </div>
  );
}

export function SelectField({
  label,
  name,
  options,
  defaultValue,
  hint,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      <select id={name} name={name} defaultValue={defaultValue} className="select">
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && <p className="faint mt-1 text-xs">{hint}</p>}
    </div>
  );
}
