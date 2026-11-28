import { useMemo, useState } from "react";
import "../../ui/themes/mobai/travel-packing.css";

const SCENES = {
  city: {
    label: "城市漫游",
    items: [
      { id: "p1", group: "证件财务", name: "身份证 / 护照", weight: 50, done: true },
      { id: "p2", group: "数码充电", name: "充电宝 + 快充线", weight: 280, done: true },
      { id: "p3", group: "数码充电", name: "降噪耳机", weight: 240, done: false },
      { id: "p4", group: "衣物鞋帽", name: "轻便徒步鞋", weight: 650, done: false },
      { id: "p5", group: "衣物鞋帽", name: "折叠晴雨伞", weight: 220, done: false },
      { id: "p6", group: "洗护药包", name: "便携护肤小样", weight: 150, done: false },
    ],
  },
  island: {
    label: "海岛度假",
    items: [
      { id: "i1", group: "证件财务", name: "护照 + 机酒行程单", weight: 60, done: true },
      { id: "i2", group: "防晒装备", name: "SPF50+ 防晒霜", weight: 140, done: false },
      { id: "i3", group: "防晒装备", name: "偏光太阳镜 + 草帽", weight: 180, done: false },
      { id: "i4", group: "衣物鞋帽", name: "泳衣 + 速干浴巾", weight: 420, done: false },
      { id: "i5", group: "数码充电", name: "手机防水袋", weight: 70, done: false },
    ],
  },
  business: {
    label: "商务差旅",
    items: [
      { id: "b1", group: "数码充电", name: "笔记本电脑 + 氮化镓充电器", weight: 1550, done: true },
      { id: "b2", group: "证件财务", name: "身份证 + 公司门禁卡", weight: 40, done: true },
      { id: "b3", group: "衣物鞋帽", name: "免烫衬衫 × 2", weight: 460, done: false },
      { id: "b4", group: "洗护药包", name: "蒸汽眼罩 + 便携漱口水", weight: 120, done: false },
    ],
  },
  outdoor: {
    label: "户外露营",
    items: [
      { id: "o1", group: "户外装备", name: "冲锋衣 + 保暖抓绒", weight: 880, done: false },
      { id: "o2", group: "户外装备", name: "头灯 / 营地灯", weight: 190, done: false },
      { id: "o3", group: "补给药包", name: "保温水壶 + 能量棒", weight: 520, done: false },
      { id: "o4", group: "补给药包", name: "驱蚊液 + 急救贴", weight: 160, done: false },
    ],
  },
};

function sceneItems(scene, demonstration) {
  return scene.items.map((item) => ({ ...item, done: demonstration && item.done }));
}

function normalizeState(raw, demonstration) {
  const scene = Object.hasOwn(SCENES, raw?.scene) ? raw.scene : "city";
  const otherScenes = Object.fromEntries(Object.keys(SCENES)
    .filter((key) => key !== scene && Array.isArray(raw?.otherScenes?.[key]))
    .map((key) => [key, raw.otherScenes[key]]));
  return {
    scene,
    items: Array.isArray(raw?.items) ? raw.items : sceneItems(SCENES[scene], demonstration),
    otherScenes,
  };
}

function estimatedGrams(item) {
  return Number(item.weight) || 100;
}

export function TravelPackingWidget({ state: rawState, onChange, locked = false, demonstration = false }) {
  const data = useMemo(() => normalizeState(rawState, demonstration), [rawState, demonstration]);
  const [text, setText] = useState("");
  const [group, setGroup] = useState("随身物品");

  const doneCount = data.items.filter((i) => i.done).length;
  const pct = data.items.length ? Math.round((doneCount / data.items.length) * 100) : 0;
  const totalKg = (data.items.reduce((sum, item) => sum + estimatedGrams(item), 0) / 1000).toFixed(2);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const item of data.items) {
      const g = item.group || "其他";
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(item);
    }
    return Array.from(map.entries());
  }, [data.items]);

  function patch(next) {
    if (locked) return;
    onChange?.({ ...data, ...next });
  }

  function selectScene(scene) {
    if (locked || data.scene === scene) return;
    const { [scene]: saved, ...otherScenes } = data.otherScenes;
    patch({
      scene,
      items: saved ?? sceneItems(SCENES[scene], demonstration),
      otherScenes: { ...otherScenes, [data.scene]: data.items },
    });
  }

  function addItem(event) {
    event.preventDefault();
    const name = text.trim();
    if (!name || locked) return;
    patch({
      items: [...data.items, { id: `pk-${Date.now().toString(36)}`, group: group.trim() || "随身物品", name, weight: 150, done: false }],
    });
    setText("");
  }

  return (
    <section
      className="mw-card mw-packing"
      contentEditable={false}
      aria-label="旅行智能打包清单"
      onMouseDown={(e) => e.stopPropagation()}
      onDragStart={(e) => e.preventDefault()}
    >
      <header className="mw-pack-head">
        <h3>旅行智能打包清单</h3>
        <div className="mw-seg" role="group" aria-label="出行场景">
          {Object.entries(SCENES).map(([key, sc]) => (
            <button
              key={key}
              type="button"
              className={data.scene === key ? "is-active" : ""}
              aria-pressed={data.scene === key}
              disabled={locked}
              onClick={() => selectScene(key)}
            >
              {sc.label}
            </button>
          ))}
        </div>
      </header>

      <div className="mw-pack-summary">
        <div className="mw-pack-count" aria-live="polite"><strong>{doneCount}/{data.items.length}</strong> 已装入</div>
        <div className="mw-pack-estimate">预估重量 <strong>{totalKg} kg</strong></div>
        <div className="mw-progress-bar" role="progressbar" aria-label="打包进度" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="mw-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {!locked && (
        <form className="mw-pack-add" onSubmit={addItem}>
          <label>物品
            <input type="text" className="mw-input" placeholder="例如充电线" value={text} onChange={(event) => setText(event.target.value)} aria-label="物品名称" required />
          </label>
          <label>分类
            <input type="text" className="mw-input" value={group} onChange={(event) => setGroup(event.target.value)} />
          </label>
          <button type="submit" className="mw-btn mw-btn-primary">加入清单</button>
        </form>
      )}

      <div className="mw-pack-groups">
        {grouped.map(([groupName, items]) => (
          <div key={groupName} className="mw-pack-group">
            <h4>{groupName} <span>{items.filter((item) => item.done).length}/{items.length} 已装入</span></h4>
            {items.map((item) => (
              <div key={item.id} className="mw-pack-item">
                <label className={`mw-check-row${item.done ? " is-done" : ""}`}>
                  <input
                    type="checkbox"
                    checked={Boolean(item.done)}
                    disabled={locked}
                    onChange={() => patch({ items: data.items.map((x) => (x.id === item.id ? { ...x, done: !x.done } : x)) })}
                  />
                  <span>{item.name}</span>
                  <small>{estimatedGrams(item)} g</small>
                </label>
                {!locked && (
                  <button
                    type="button"
                    className="mw-btn-ghost mw-pack-remove"
                    aria-label={`删除 ${item.name}`}
                    onClick={(e) => {
                      e.preventDefault();
                      patch({ items: data.items.filter((x) => x.id !== item.id) });
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      {!grouped.length && <p className="mw-pack-empty">{locked ? "这个场景还没有物品。" : "清单为空，可以从上方加入物品。"}</p>}
    </section>
  );
}
