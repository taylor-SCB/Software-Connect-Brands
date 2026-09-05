import Link from "next/link";
import { TAG_COLORS, TAG_LABELS, type LineItemTagValue } from "@/lib/constants";

// Presentational primitives with no hooks, so they can be rendered from
// server components and client components alike.

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="muted mt-1 text-sm">{subtitle}</p>}
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
  WON: "#34d399",
  LOST: "#fb7185",
  DRAFT: "#94a3b8",
  SENT: "#38bdf8",
  ACCEPTED: "#34d399",
  DECLINED: "#fb7185",
  SIGNED: "#34d399",
};

export function StatusBadge({ status }: { status: string }) {
  const label =
    status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
  return (
    <Badge color={STATUS_COLORS[status] ?? "var(--text-dim)"} dot>
      {label}
    </Badge>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="faint mb-3 inline-flex items-center gap-1.5 text-xs hover:text-[var(--text)]">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      {label}
    </Link>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="rounded-lg border border-[rgb(251_113_133/0.3)] bg-[rgb(251_113_133/0.09)] px-3 py-2 text-xs text-[var(--danger)]">
      {message}
    </p>
  );
}

export function FormSuccess({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="rounded-lg border border-[rgb(52_211_153/0.3)] bg-[rgb(52_211_153/0.09)] px-3 py-2 text-xs text-[var(--ok)]">
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
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string | number;
  required?: boolean;
  hint?: string;
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
