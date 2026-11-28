import { useId, useMemo, useRef, useState } from "react";
import { IconArrowLeft, IconArrowRight, IconSwitchHorizontal } from "@tabler/icons-react";

const DEFAULT_CARDS = [
  { id: "c1", front: "什么是「费曼学习法」的核心？", back: "用最朴素、无术语的语言向一个初学者讲清楚概念；讲卡壳的地方，正是你真正的知识盲区。", level: "good" },
  { id: "c2", front: "「复利思维」在日常笔记中的意义", back: "每天记录 1 条可复用的原子想法，一年后你的知识库不是 365 篇孤岛，而是可互相连接的网络。", level: "new" },
  { id: "c3", front: "旅途黄金法则 · 留白 30%", back: "每天行程只排满 70%，把 30% 留给偶遇的咖啡馆、街角夕阳和意料之外的好风景。", level: "hard" },
];
const RATINGS = [
  { id: "hard", label: "不熟" },
  { id: "mid", label: "模糊" },
  { id: "good", label: "已掌握" },
];

function normalizeState(raw, demonstration) {
  const cards = Array.isArray(raw?.cards) && raw.cards.length ? raw.cards
    : demonstration ? DEFAULT_CARDS : DEFAULT_CARDS.map((card) => ({ ...card, level: "new" }));
  return { cards };
}

export function FlashcardQuoteWidget({ state: rawState, onChange, locked = false, demonstration = false }) {
  const data = useMemo(() => normalizeState(rawState, demonstration), [rawState, demonstration]);
  const formId = useId();
  const stage = useRef(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [adding, setAdding] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");

  const safeIndex = index % data.cards.length;
  const card = data.cards[safeIndex];
  const mastered = data.cards.filter((c) => c.level === "good").length;
  const rating = RATINGS.find((item) => item.id === card.level)?.label || "未评价";

  function step(delta) {
    setFlipped(false);
    setIndex((i) => (i + delta + data.cards.length) % data.cards.length);
  }

  function rate(level) {
    if (locked) return;
    onChange?.({ cards: data.cards.map((c) => (c.id === card.id ? { ...c, level } : c)) });
    step(1);
  }

  function addCard(event) {
    event.preventDefault();
    if (!front.trim() || !back.trim() || locked) return;
    const next = [...data.cards, { id: `fc-${Date.now().toString(36)}`, front: front.trim(), back: back.trim(), level: "new" }];
    onChange?.({ cards: next });
    setIndex(next.length - 1);
    setFlipped(false);
    setFront("");
    setBack("");
    setAdding(false);
    stage.current?.focus();
  }

  return (
    <section
      className="mw-card mw-flashcard"
      contentEditable={false}
      aria-label="复习闪卡与金句"
      onMouseDown={(e) => e.stopPropagation()}
      onDragStart={(e) => e.preventDefault()}
    >
      <header className="mw-head">
        <div className="mw-head-title">
          <strong>复习闪卡</strong>
          <small>已掌握 {mastered} / {data.cards.length} 张</small>
        </div>
        {!locked && <button type="button" className="mw-btn" aria-expanded={adding}
          aria-controls={adding ? formId : undefined} onClick={() => setAdding((v) => !v)}>
          {adding ? "取消" : "+ 新闪卡"}
        </button>}
      </header>

      {adding && !locked && (
        <form id={formId} className="mw-fc-form" onSubmit={addCard}>
          <label><span>正面</span><textarea className="mw-textarea" autoFocus required rows={2}
            placeholder="写下问题或金句" value={front} onChange={(event) => setFront(event.target.value)} /></label>
          <label><span>背面</span><textarea className="mw-textarea" required rows={2}
            placeholder="写下答案或注解" value={back} onChange={(event) => setBack(event.target.value)} /></label>
          <button type="submit" className="mw-btn mw-btn-primary" disabled={!front.trim() || !back.trim()}>保存卡片</button>
        </form>
      )}

      <button
        type="button"
        ref={stage}
        className={`mw-fc-stage${flipped ? " is-flipped" : ""}`}
        onClick={() => setFlipped((f) => !f)}
      >
        <span className="mw-fc-inner">
          {[
            { key: "front", side: "正面", action: "查看背面", shown: !flipped },
            { key: "back", side: "背面", action: "查看正面", shown: flipped },
          ].map(({ key, side, action, shown }) => (
            <span key={key} className={`mw-fc-face mw-fc-${key}`} aria-hidden={!shown}>
              <span className="mw-fc-tag"><span>{side}</span><span>{rating}</span></span>
              <span className="mw-fc-content">{card[key]}</span>
              <span className="mw-fc-flip"><IconSwitchHorizontal size={16} aria-hidden="true" />{action}</span>
            </span>
          ))}
        </span>
      </button>

      <footer className="mw-fc-footer">
        <div className="mw-fc-navigation" role="group" aria-label="切换卡片">
          <button type="button" className="mw-btn" onClick={() => step(-1)} disabled={data.cards.length < 2}>
            <IconArrowLeft size={16} aria-hidden="true" />上一张
          </button>
          <small role="status">第 {safeIndex + 1} / {data.cards.length} 张</small>
          <button type="button" className="mw-btn" onClick={() => step(1)} disabled={data.cards.length < 2}>
            下一张<IconArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
        {!locked && <div className="mw-fc-rate" role="group" aria-label="记忆熟练度">
          {RATINGS.map(({ id, label }) => (
            <button key={id} type="button" className={`mw-btn is-${id}${card.level === id ? " is-active" : ""}`}
              aria-pressed={card.level === id} onClick={() => rate(id)}>{label}</button>
          ))}
        </div>}
      </footer>
    </section>
  );
}
