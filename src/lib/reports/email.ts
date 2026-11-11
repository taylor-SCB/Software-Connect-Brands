import { escapeHtml } from "@/lib/email-marketing";
import type { Headline, SummaryTable } from "@/lib/reports/common";
import { changeText, formatValue, headlineValue } from "@/lib/reports/format";

// The report as an email (Nov 10, 2026): the business's name, the
// write-up, the headline numbers, one small table and a link to the full
// report on the site. Plain HTML tables with inline styles, light on dark
// text, because that is what every mail program draws the same way.

export function reportEmail(input: {
  businessName: string;
  reportLabel: string;
  periodText: string;
  whoFor: string;
  narrative: string;
  headlines: Headline[];
  table: SummaryTable;
  url: string;
  settingsUrl: string;
  cadenceLabel: string;
}) {
  const subject = `${input.businessName} · ${input.reportLabel} — ${input.periodText}`;
  const paragraphs = input.narrative.split(/\n{2,}/).filter(Boolean);
  const headlines = input.headlines.slice(0, 6);

  const text = [
    `${input.businessName} — ${input.reportLabel}`,
    `${input.periodText} · ${input.whoFor}`,
    "",
    ...paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...headlines.map((headline) => {
      const moved = changeText(headline);
      return `${headline.label}: ${headlineValue(headline)}${moved ? ` (${moved.text})` : ""}`;
    }),
    "",
    input.table.title,
    input.table.columns.map((column) => column.label).join(" | "),
    ...input.table.rows.slice(0, 10).map((row) => row.map((cell, index) => cellText(cell, input.table.columns[index]?.format)).join(" | ")),
    "",
    `Open the full report: ${input.url}`,
    "",
    `You get this ${input.cadenceLabel.toLowerCase()}. Change or stop it in Settings → My Account: ${input.settingsUrl}`,
  ].join("\n");

  const tile = (headline: Headline) => {
    const moved = changeText(headline);
    const tone = moved?.tone === "good" ? "#0f7a52" : moved?.tone === "bad" ? "#b42318" : "#667085";
    return `<td style="padding:10px 12px;border:1px solid #e4e7ec;border-radius:8px;vertical-align:top;width:33%">
      <div style="font-size:11px;color:#667085;text-transform:uppercase;letter-spacing:.06em">${escapeHtml(headline.label)}</div>
      <div style="font-size:20px;font-weight:600;color:#101828;margin-top:4px">${escapeHtml(headlineValue(headline))}</div>
      ${moved ? `<div style="font-size:12px;color:${tone};margin-top:2px">${escapeHtml(moved.text)}</div>` : ""}
      ${headline.hint ? `<div style="font-size:12px;color:#667085;margin-top:2px">${escapeHtml(headline.hint)}</div>` : ""}
    </td>`;
  };
  const tileRows: string[] = [];
  for (let i = 0; i < headlines.length; i += 3) {
    tileRows.push(`<tr>${headlines.slice(i, i + 3).map(tile).join("")}</tr>`);
  }

  const rows = input.table.rows.slice(0, 10);
  const html = `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#101828">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:24px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:12px;padding:24px">
    <tr><td>
      <div style="font-size:12px;color:#667085;text-transform:uppercase;letter-spacing:.08em">${escapeHtml(input.businessName)}</div>
      <h1 style="font-size:22px;margin:6px 0 2px">${escapeHtml(input.reportLabel)}</h1>
      <div style="font-size:13px;color:#667085">${escapeHtml(input.periodText)} · ${escapeHtml(input.whoFor)}</div>
      ${paragraphs.map((paragraph) => `<p style="font-size:15px;line-height:1.55;margin:16px 0 0">${escapeHtml(paragraph)}</p>`).join("")}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin-top:18px">${tileRows.join("")}</table>
      ${
        rows.length
          ? `<h2 style="font-size:14px;margin:20px 0 8px">${escapeHtml(input.table.title)}</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">
        <tr>${input.table.columns.map((column, index) => `<th style="text-align:${index === 0 ? "left" : "right"};padding:6px 8px;border-bottom:1px solid #e4e7ec;color:#667085;font-weight:600">${escapeHtml(column.label)}</th>`).join("")}</tr>
        ${rows
          .map(
            (row) =>
              `<tr>${row
                .map(
                  (cell, index) =>
                    `<td style="text-align:${index === 0 ? "left" : "right"};padding:6px 8px;border-bottom:1px solid #f2f4f7">${escapeHtml(cellText(cell, input.table.columns[index]?.format))}</td>`,
                )
                .join("")}</tr>`,
          )
          .join("")}
      </table>`
          : ""
      }
      <p style="margin:22px 0 0"><a href="${escapeHtml(input.url)}" style="display:inline-block;background:#101828;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px">Open the full report</a></p>
      <p style="font-size:12px;color:#667085;margin:18px 0 0">You get this ${escapeHtml(input.cadenceLabel.toLowerCase())}. <a href="${escapeHtml(input.settingsUrl)}" style="color:#667085">Change or stop it in Settings → My Account</a>.</p>
    </td></tr>
  </table></td></tr></table></body></html>`;

  return { subject, text, html };
}

function cellText(cell: string | number, format: string | undefined) {
  if (typeof cell === "number" && format && format !== "text") return formatValue(cell, format as Headline["format"]);
  return String(cell);
}
