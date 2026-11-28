function render() {
  const records = data();
  const filter = $('#filter').value;
  const due = records.filter(record => stage(record) === 'due').length;
  const shown = records.filter(record => filter === 'all' || stage(record) === filter);
  if (!shown.some(record => record.id === active)) active = shown[0]?.id ?? null;

  $('#mode').textContent = demo ? '示例日志' : due ? `${due} 项待复盘` : '我的日志';
  $('#dataset').textContent = demo ? '返回我的日志' : '查看示例';
  $('#record-count').textContent = shown.length;

  const list = $('#list'), picker = $('#record-picker');
  list.replaceChildren(...shown.map(record => {
    const state = stage(record);
    const item = button('', () => {
      active = record.id;
      render();
      list.querySelector('[aria-current="true"]')?.focus();
    });
    item.setAttribute('aria-current', String(record.id === active));
    item.append(el('strong', '', record.title), group('record-meta',
      el('span', `record-state ${state}`, stageText[state]), el('time', '', dateLabel(record.due))));
    return item;
  }));
  picker.replaceChildren(...shown.map(record => {
    const option = el('option', '', `${stageText[stage(record)]} · ${record.title}`);
    option.value = record.id;
    return option;
  }));
  picker.hidden = !shown.length;
  picker.value = active ?? '';

  const detail = $('#detail'), record = shown.find(item => item.id === active);
  if (!record) {
    const heading = records.length ? '当前筛选下没有记录' : '开始一份决策日志';
    const message = records.length ? '切换筛选条件可查看其他决策。' : '先记下决定、理由和验收标准，等结果出现后再对照。';
    const empty = group('empty', el('h2', '', heading), el('p', '', message));
    if (records.length) empty.append(button('查看全部', () => { $('#filter').value = 'all'; render(); $('#filter').focus(); }));
    detail.replaceChildren(empty);
    return;
  }

  const state = stage(record);
  const title = el('h2', 'detail-title', record.title);
  const dates = group('detail-dates', el('span', `record-state ${state}`, stageText[state]),
    el('span', '', `记录于 ${dateLabel(record.created)}`),
    el('span', '', `${record.review ? '复盘于' : '计划复盘'} ${dateLabel(record.review?.date ?? record.due)}`));
  const reviewButton = button(record.review ? '更新复盘' : '填写复盘', () => openReview(record), 'primary');
  const copyButton = button('复制为 Markdown', () => copy(record), 'quiet');
  const heading = group('detail-header', title, dates, group('detail-actions', reviewButton, copyButton));

  const before = el('article', 'comparison-side before');
  const after = el('article', 'comparison-side after');
  const meter = el('progress');
  meter.max = 100;
  meter.value = record.confidence;
  meter.setAttribute('aria-label', '当时的把握');
  before.append(el('h3', '', '当时的判断'), el('h4', '', '依据'), el('p', '', record.why),
    el('h4', '', '预期及验收标准'), el('p', '', record.expect),
    group('confidence', el('span', '', `把握 ${record.confidence}%`), meter));
  after.append(el('h3', '', '实际与复盘'));
  if (record.review) {
    const verdict = record.review.verdict;
    after.append(el('span', `record-state ${verdict === 'met' ? 'done' : verdict === 'miss' ? 'miss' : ''}`, verdicts[verdict]),
      el('h4', '', '发生了什么'), el('p', '', record.review.actual));
    if (record.review.lesson) after.append(el('h4', '', '下次怎么做'), el('p', '', record.review.lesson));
  } else {
    after.append(el('p', 'secondary', state === 'due' ? '到复盘日期了。把实际结果和验收标准对照。' : '有实际结果后即可填写复盘。'));
  }
  detail.replaceChildren(heading, group('comparison', before, after));
}

async function copy(record) {
  const text = markdown(record);
  try {
    await navigator.clipboard.writeText(text);
    notice('已复制 Markdown。');
  } catch {
    const output = $('#copy-text');
    output.value = text;
    $('#copy-dialog').showModal();
    output.select();
  }
}
