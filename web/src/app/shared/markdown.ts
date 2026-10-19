/** A deliberately small markdown renderer for user notes: headings, lists,
    quotes, fences, rules, emphasis, inline code and safe links. Everything is
    HTML-escaped first, so the returned string only ever carries tags we emit. */

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });

const inline = (text: string): string => {
  const codes: string[] = [];
  let out = text.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) =>
    /^(https?:\/\/|mailto:)/i.test(href)
      ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : match,
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, index: string) => codes[Number(index)]);
};

const blockStart = /^ {0,3}(```|#{1,6}\s|>|[-*+]\s|\d+[.)]\s|([-*_])(?:\s*\2){2,}\s*$)/;

const lines = (text: string): string => inline(escapeHtml(text)).replace(/\n/g, '<br>');

/** Render the small markdown subset the card body supports. */
export function renderMarkdown(source: string): string {
  const src = source.replace(/\r\n?/g, '\n');
  if (!src.trim()) return '';
  const rows = src.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < rows.length) {
    const row = rows[i];
    if (!row.trim()) {
      i++;
      continue;
    }

    if (/^ {0,3}```/.test(row)) {
      const code: string[] = [];
      i++;
      while (i < rows.length && !/^ {0,3}```/.test(rows[i])) code.push(rows[i++]);
      i++; // closing fence (or end of input)
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = row.match(/^ {0,3}(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(escapeHtml(heading[2].trim()))}</h${level}>`);
      i++;
      continue;
    }

    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(row)) {
      out.push('<hr>');
      i++;
      continue;
    }

    if (/^ {0,3}>\s?/.test(row)) {
      const quote: string[] = [];
      while (i < rows.length && /^ {0,3}>\s?/.test(rows[i])) {
        quote.push(rows[i++].replace(/^ {0,3}>\s?/, ''));
      }
      out.push(`<blockquote>${lines(quote.join('\n'))}</blockquote>`);
      continue;
    }

    if (/^ {0,3}[-*+]\s+/.test(row)) {
      const items: string[] = [];
      while (i < rows.length) {
        const item = rows[i].match(/^ {0,3}[-*+]\s+(.*)$/);
        if (!item) break;
        items.push(`<li>${inline(escapeHtml(item[1]))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^ {0,3}\d+[.)]\s+/.test(row)) {
      const items: string[] = [];
      while (i < rows.length) {
        const item = rows[i].match(/^ {0,3}\d+[.)]\s+(.*)$/);
        if (!item) break;
        items.push(`<li>${inline(escapeHtml(item[1]))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    const paragraph: string[] = [];
    while (i < rows.length && rows[i].trim() && !blockStart.test(rows[i])) {
      paragraph.push(rows[i++]);
    }
    out.push(`<p>${lines(paragraph.join('\n'))}</p>`);
  }

  return out.join('\n');
}
