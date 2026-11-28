import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import IconChevronRight from '@tabler/icons-react/dist/esm/icons/IconChevronRight.mjs';
import IconCheck from '@tabler/icons-react/dist/esm/icons/IconCheck.mjs';

// Kept inside DatabasePopover so its outside-click and Escape boundaries remain shared.
export function LayoutChoice({ label, value, choices, onChange }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({});
  const root = useRef(null);
  const trigger = useRef(null);
  const menu = useRef(null);
  const selected = choices.find(choice => choice.value === value);
  const focusChoice = choice => {
    if (!choice || !menu.current) return;
    choice.focus({ preventScroll: true });
    const item = choice.getBoundingClientRect();
    const bounds = menu.current.getBoundingClientRect();
    const top = bounds.top + menu.current.clientTop;
    const bottom = top + menu.current.clientHeight;
    if (item.top < top) menu.current.scrollTop += item.top - top;
    else if (item.bottom > bottom) menu.current.scrollTop += item.bottom - bottom;
  };
  useLayoutEffect(() => {
    if (!open) return;
    let frame;
    const place = () => {
      const bounds = trigger.current.getBoundingClientRect();
      const width = Math.min(220, window.innerWidth - 16);
      const height = menu.current.offsetHeight;
      const right = bounds.right + 4;
      const left = Math.max(8, Math.min(right + width <= window.innerWidth - 8 ? right : bounds.left - width - 4, window.innerWidth - width - 8));
      const top = Math.max(8, Math.min(bounds.top, window.innerHeight - height - 8));
      setPosition(current => current.left === left && current.top === top && current.width === width ? current : { left, top, width });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    place();
    focusChoice(menu.current.querySelector('[aria-checked="true"]') || menu.current.querySelector('button'));
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(trigger.current);
    observer?.observe(menu.current);
    const panel = trigger.current.closest('.db-v9-popover');
    if (panel) observer?.observe(panel);
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  return <div ref={root} className="db-gallery-choice" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => {
    if (open && event.target === trigger.current && event.key === 'Escape' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <button ref={trigger} type="button" className="db-v9-menu-row" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><span>{label}</span><small>{selected?.label || '选择'}</small><IconChevronRight size={14} aria-hidden="true" /></button>
    {open && <div ref={menu} className="db-gallery-choice-menu" role="menu" aria-label={label} style={position} onKeyDown={event => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      const buttons = [...menu.current.querySelectorAll('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      event.preventDefault(); event.stopPropagation(); focusChoice(buttons[next]);
    }}>
      {choices.map(choice => <button key={choice.value} type="button" role="menuitemradio" aria-checked={choice.value === value} onClick={() => { onChange(choice.value); close(); }}><span>{choice.label}</span>{choice.value === value && <IconCheck size={15} aria-hidden="true" />}</button>)}
    </div>}
  </div>;
}

export function GallerySettings({ source, config, onChange, onProperties, visibleCount }) {
  const files = source.properties.filter(entry => entry.type === 'files');
  return <div className="db-gallery-settings">
    <LayoutChoice label="画廊预览" value={config.preview.kind} choices={[{ value: 'none', label: '无' }, { value: 'page-cover', label: '页面封面' }, { value: 'files-property', label: '附件属性' }, { value: 'page-content', label: '页面内容' }]} onChange={kind => onChange({ ...config, preview: { ...config.preview, kind } })} />
    {config.preview.kind === 'files-property' && <LayoutChoice label="画廊附件属性" value={config.preview.propertyId || ''} choices={[{ value: '', label: '选择' }, ...files.map(entry => ({ value: entry.id, label: entry.name }))]} onChange={propertyId => onChange({ ...config, preview: { ...config.preview, propertyId: propertyId || null } })} />}
    <LayoutChoice label="画廊卡片大小" value={config.cardSize} choices={[{ value: 'small', label: '小' }, { value: 'medium', label: '中' }, { value: 'large', label: '大' }]} onChange={cardSize => onChange({ ...config, cardSize })} />
    {config.preview.kind !== 'none' && <button type="button" className="db-v9-menu-row db-gallery-fit" role="switch" aria-label="适应媒体" aria-checked={config.imageFit === 'contain'} onClick={() => onChange({ ...config, imageFit: config.imageFit === 'contain' ? 'cover' : 'contain' })}><span>适应媒体</span><i aria-hidden="true" /></button>}
    <button type="button" className="db-v9-menu-row" onClick={onProperties}><span>卡片属性</span><small>{visibleCount}</small><IconChevronRight size={14} aria-hidden="true" /></button>
  </div>;
}
