import React from "react";

function isSafeExternalHref(href) {
  try {
    const parsed = new URL(href);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function renderInline(text, keyPrefix = "in") {
  const tokens = [];
  const pattern = /(\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*)/g;
  let lastIndex = 0;
  let match;
  let seq = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) tokens.push(text.slice(lastIndex, match.index));
    seq += 1;
    const key = `${keyPrefix}-${seq}`;
    if (match[2] !== undefined && match[3] !== undefined && isSafeExternalHref(match[3])) {
      const href = match[3];
      tokens.push(
        <a
          key={key}
          href={href}
          className="assistant-md-link"
          rel="noopener noreferrer"
          onClick={(event) => {
            if (window.lifeAtlas?.app?.openExternal) {
              event.preventDefault();
              void window.lifeAtlas.app.openExternal({ url: href });
            }
          }}
        >
          {match[2]}
        </a>,
      );
    } else if (match[4] !== undefined) {
      tokens.push(<code key={key} className="assistant-md-code">{match[4]}</code>);
    } else if (match[5] !== undefined) {
      tokens.push(<strong key={key}>{renderInline(match[5], `${key}-b`)}</strong>);
    } else if (match[6] !== undefined) {
      tokens.push(<em key={key}>{match[6]}</em>);
    } else {
      tokens.push(match[0]);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) tokens.push(text.slice(lastIndex));
  return tokens.length ? tokens : text;
}

export function AssistantMarkdown({ content }) {
  const raw = typeof content === "string" ? content.replace(/\r\n?/g, "\n") : "";
  if (!raw) return null;

  const lines = raw.split("\n");
  const elements = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trimStart().startsWith("```")) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      elements.push(
        <pre key={`code-${index}`} className="assistant-md-pre" data-lang={lang || undefined}>
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const Tag = level === 1 ? "h4" : level === 2 ? "h5" : "h6";
      elements.push(<Tag key={`h-${index}`} className={`assistant-md-h is-l${level}`}>{renderInline(heading[2], `h-${index}`)}</Tag>);
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      const start = index;
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      elements.push(
        <ul key={`ul-${start}`} className="assistant-md-list">
          {items.map((item, itemIdx) => <li key={itemIdx}>{renderInline(item, `ul-${start}-${itemIdx}`)}</li>)}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      const start = index;
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      elements.push(
        <ol key={`ol-${start}`} className="assistant-md-list">
          {items.map((item, itemIdx) => <li key={itemIdx}>{renderInline(item, `ol-${start}-${itemIdx}`)}</li>)}
        </ol>,
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      const start = index;
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      elements.push(
        <blockquote key={`q-${start}`} className="assistant-md-quote">
          {renderInline(quoteLines.join("\n"), `q-${start}`)}
        </blockquote>,
      );
      continue;
    }

    const paragraphLines = [];
    const start = index;
    while (
      index < lines.length
      && lines[index].trim()
      && !lines[index].trimStart().startsWith("```")
      && !/^(#{1,3})\s+/.test(lines[index])
      && !/^\s*[-*]\s+/.test(lines[index])
      && !/^\s*\d+\.\s+/.test(lines[index])
      && !/^>\s?/.test(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    elements.push(
      <p key={`p-${start}`} className="assistant-md-p">
        {paragraphLines.map((part, partIdx) => (
          <React.Fragment key={partIdx}>
            {partIdx > 0 && <br />}
            {renderInline(part, `p-${start}-${partIdx}`)}
          </React.Fragment>
        ))}
      </p>,
    );
  }

  return <div className="assistant-md">{elements}</div>;
}
