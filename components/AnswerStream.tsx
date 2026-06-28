"use client";

import React from "react";

// Lightweight inline formatter: **bold**, `code`, and [n] footnote-style citation
// markers that link to the matching entry in the Sources list. Avoids pulling a
// full markdown dependency while still rendering the agent's typical output well.
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[\d+\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${idx++}`;
    if (tok.startsWith("**")) {
      nodes.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      nodes.push(<code key={k}>{tok.slice(1, -1)}</code>);
    } else {
      const n = tok.slice(1, -1);
      nodes.push(
        <a
          key={k}
          href={`#source-${n}`}
          className="mx-px inline-flex items-center rounded bg-signal/15 px-1 align-super font-mono text-[0.62em] text-signal no-underline"
          style={{ borderBottom: "none" }}
        >
          {n}
        </a>
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderBlocks(text: string): React.ReactNode {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = (key: string) => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    out.push(
      <Tag key={key}>
        {list.items.map((it, i) => (
          <li key={i}>{renderInline(it, `${key}-${i}`)}</li>
        ))}
      </Tag>
    );
    list = null;
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*[-*]\s+(.*)/);
    const ol = line.match(/^\s*\d+\.\s+(.*)/);
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (ul) {
      if (!list || list.ordered) flush(`l-${i}`);
      list = list ?? { ordered: false, items: [] };
      list.items.push(ul[1]);
    } else if (ol) {
      if (!list || !list.ordered) flush(`l-${i}`);
      list = list ?? { ordered: true, items: [] };
      list.items.push(ol[1]);
    } else if (h) {
      flush(`l-${i}`);
      const level = h[1].length;
      out.push(
        <p key={`h-${i}`} className="font-semibold text-fg">
          {renderInline(h[2], `h-${i}`)}
        </p>
      );
    } else if (line.trim() === "") {
      flush(`l-${i}`);
    } else {
      flush(`l-${i}`);
      out.push(<p key={`p-${i}`}>{renderInline(line, `p-${i}`)}</p>);
    }
  });
  flush("l-end");
  return out;
}

export function AnswerStream({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  if (!text && !streaming) return null;
  return (
    <div className="prose-answer">
      {renderBlocks(text)}
      {streaming && <span className="caret" />}
    </div>
  );
}
