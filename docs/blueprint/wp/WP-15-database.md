# WP-15 数据库体验补齐

- 规模：L · 前置：WP-14 · 分支：`wp/15-database`
- 停止点：步骤 0（理解确认）、步骤 7（纯函数全部完成）、步骤 12（表格界面完成）、步骤 17（收尾）
- 必读：`01-需求与范围.md` 第 3.5 节；`09-执行手册.md`（4.5 节）；`AGENTS.md`（不使用右侧面板）；源码 `src/domain/database.js`、`databaseProperties.js`、`formula/engine.js`、`viewRegistry.js`、`src/components/DatabaseView.jsx`（`DatabaseTable`、`BaseViewSettings`）、`PropertyEditor.jsx`（`DraftText`、`DateEditor`、`MultiPicker`、`PropertyConfigDialog`）、`RecordProperties.jsx`、`DatabaseQuerySettings.jsx`、`src/App.jsx`（`createDatabaseItem`、`updateDatabaseItemValue`、`addDatabaseProperty`、`updateDatabaseProperty`、`createSubPage`、`databaseRuntime`）；WP-10 的 `applyRelationChange`；WP-13 加在日期编辑器里的“提醒”下拉框；`12-视觉规范-墨白.md` 第 0、3、6、7、8 节和 2.12 节列出的参照画面；`design/mobai/theme/database.css`（WP-20 已经给表格、看板和其他视图写好的样式）；`design/mobai/product-shots-views/` 和 `design/mobai/sample-database.json`（2.13 节）；源码 `src/components/DatabaseBasicViews.jsx`（画廊的封面、`DatabaseCalendar`）、`src/data/coverGallery.js`；WP-12 加在 `tests/browser/harness.mjs` 里的 `shootBothModes`、WP-05 加在 `tests/desktop/helpers.mjs` 里的 `shootWindowBothModes`

## 0. 一页纸

- **要做到**：数据库表格用起来像 Notion：单元格平时只显示值，点开才是编辑器（选项是彩色标签、日期弹出日历）；列宽、列顺序、隐藏、换行、表头菜单（改类型、排序、筛选、删除属性）；列底部统计；数字格式；公式函数扩充到 50 个左右，并支持 `prop("属性名")`；行菜单、多选批量删除、复制记录；点开记录在页面中央弹出预览；CSV 导入；ID（自动编号）、创建者、最后编辑者属性；视图内搜索；1 万条记录的表格依然流畅；画廊卡片显示页面封面，日历有星期一行、标出今天（2.13 节）。
- **交付物**：`src/domain/numberFormat.js`、`databaseStats.js`、`propertyChanges.js`、`csv.js`、`formula/help.js`；改造后的 `formula/engine.js`、`database.js`、`databaseProperties.js`、`viewRegistry.js`；新组件 `src/components/DatabaseTable.jsx`、`OptionPicker.jsx`、`DatePicker.jsx`、`RecordPeek.jsx`、`CsvImportDialog.jsx`、`FormulaEditor.jsx`；改造后的 `PropertyEditor.jsx`、`DatabaseView.jsx`、`DatabaseBasicViews.jsx`、`src/data/coverGallery.js`；9 个单元测试文件；浏览器场景 `wp15-database`；桌面端到端 `tests/desktop/database.e2e.mjs`；墨白样式 `src/ui/themes/mobai/database-editing.css`；白天和夜间的截图与对照图。
- **绝对不要**：引入任何新依赖（CSV、虚拟滚动、日期选择都自己写）；使用 `eval`、`new Function`；做右侧面板；做本地自动化、按钮属性、冻结列、条件颜色、公式里的列表字面量和 `let`；修改时间脉络视图（WP-09）的代码——唯一的例外是 2.8 节：`DatabaseView` 传给它的 `onOpenItemPage` 换成 `openRecord`，以及步骤 10 按规定给 `wp09-roadmap` 场景加“打开完整页面”那一行；删除或放宽现有测试的断言。
- **什么时候停**：步骤 0、7、12 之后各停一次；步骤 17 的 wp-check 退出码为 0 或 2 时停。

## 1. 已知事实（总设计师 2026-11-01 核对源码与本机 Node 24）

| 事实 | 对你的影响 |
| --- | --- |
| 现在的表格每个单元格都是 `PropertyEditor`：单选/状态是原生 `<select>`，日期是 `<input type="date">`，多选/人员/关联/文件是 `<details>` 加复选框，新建成员用 `window.prompt` | 第 2.6 节改造 `PropertyEditor` 本身（表格、记录属性、表单都在用它，改一处全部生效） |
| 现有浏览器场景按这些 `aria-label` 操作单元格：`链接 · Alpha 项目`、`邮箱 · Alpha 项目`、`电话 · Alpha 项目`（文本框）、`负责人 · Alpha 项目: 周宁`、`附件 · Alpha 项目: 设计说明.pdf`（复选框，先点 `[data-property-id="…"] summary` 展开）、`地点 · Alpha 项目 名称`、`日期 · Alpha 项目 开始`（直接 `fill`）、`确认 · Alpha 项目`（复选框） | 新组件**保留这些标签和 `<details>`/`<summary>` 结构**；只有日期需要先展开，见步骤 8 规定的测试改动 |
| 现有测试读取 `DatabaseView.jsx` 的源码，要求其中出现 `onOpenItemPage`、`Linked View`、`DatabaseTable`、`DatabaseBoard`、`DatabaseList`、`DatabaseGallery`、`DatabaseCalendar`、`DatabaseTimeline`、`DatabaseDashboard`、`onCreateItem`、每种视图的 `case "<类型>"` | 表格代码搬到新文件 `DatabaseTable.jsx`，`DatabaseView.jsx` 导入并使用它，这些字样都保留 |
| `tests/core-parity-phase2.test.mjs` 检查公式：`{{amount}} >= 10 and not false` 为真、`dateAdd({{date}}, 2, "days")` 返回 `end: null` 的日期、深度 66 的括号报错、`engine.js` 源码里没有 `eval(` 和 `Function(` 等 | 第 2.3 节的改造已经用这些用例验证过（总设计师在临时目录跑过一个参考实现），不要改动这些用例 |
| `and`、`or`、`not` 现在是运算符，`empty` 现在被当成 `null` 字面量 | 第 2.3 节规定：后面紧跟 `(` 时改为函数名 |
| `projectViewItems` 对每条记录用 `pages.find` 找记录页面，`DatabaseTable` 对每一行用 `databaseItems.find` 算缩进层级：1 万条记录时是 1 亿次比较 | 第 2.9 节改成先建 `Map` |
| `new TextDecoder("gbk")` 在 Node 24 和 Chromium 里都可用；`new TextDecoder("utf-8", { fatal: true })` 遇到 GBK 字节会抛 `TypeError`；`TextDecoder("utf-8")` 默认去掉 BOM | CSV 编码检测照 2.8 节做 |
| `Intl.NumberFormat("en-US", …)` 的四舍五入：`2.5 → "3"`、`-0.5 → "-1"` | 2.1 节的已知答案就是这样算出来的 |
| 现有的 `id` 属性类型显示的是记录内部 ID（一串 UUID），不是 Notion 的自动编号 | 新增类型 `unique_id`（显示名“ID”），`id` 的显示名改为“内部 ID” |
| `bigWorkspace({ pages, records })`（WP-04）里整页数据库页面的 ID 是 `big-db-page`，数据源 `big-ds` 有 `title`、`status`（todo/doing/done）、`amount`、`due` 四个属性，表格视图是 `big-view`（`big-db-page.databaseViewId` 指向它） | 性能测试用它 |

## 2. 设计要点（规定，照做）

### 2.1 属性类型、显示名与数字格式

- `PROPERTY_LABELS` 改为（键不变，只改文字，新增 3 个键）：`title: "名称"`、`text: "文本"`、`number: "数字"`、`select: "单选"`、`multi_select: "多选"`、`status: "状态"`、`date: "日期"`、`checkbox: "复选框"`、`people: "人员"`、`url: "URL"`、`email: "电子邮件"`、`phone: "电话"`、`files: "文件和媒体"`、`place: "地点"`、`relation: "关联"`、`rollup: "汇总"`、`formula: "公式"`、`id: "内部 ID"`、`created_time: "创建时间"`、`modified_time: "上次编辑时间"`、`unique_id: "ID"`、`created_by: "创建者"`、`last_edited_by: "最后编辑者"`。
- `DATABASE_PROPERTY_TYPES` 末尾加 `"unique_id"`、`"created_by"`、`"last_edited_by"`；`READ_ONLY_PROPERTY_TYPES` 加同样 3 个。
- `unique_id`：`config: { prefix: "", nextNumber: 1 }`。记录的值是整数，存在 `values[属性ID]`；显示为 `prefix ? \`${prefix}-${n}\` : String(n)`。前缀只能是 0–10 个 `A–Z a–z 0–9 -` 字符。
- `created_by`、`last_edited_by`：不存值；`resolvePropertyValue` 返回字符串 `"我"`（单用户软件）。
- **数字格式**：数字、公式、汇总属性的 `config.numberFormat = { format, decimals }`；`format` 取 `number`（默认）、`number_with_commas`、`percent`、`cny`、`usd`、`eur`；`decimals` 取 `null`（默认）或 0–4。新文件 `src/domain/numberFormat.js`（照抄）：

  ```js
  const SYMBOLS = { cny: "¥", usd: "$", eur: "€" };

  export const NUMBER_FORMATS = [
    ["number", "数字"], ["number_with_commas", "带千位分隔符的数字"], ["percent", "百分比"],
    ["cny", "人民币"], ["usd", "美元"], ["eur", "欧元"],
  ];

  export function formatNumber(value, config = {}) {
    if (value === null || value === undefined || value === "") return "";
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    const format = config.format || "number";
    const decimals = Number.isInteger(config.decimals) && config.decimals >= 0 && config.decimals <= 4 ? config.decimals : null;
    const digits = (fallbackMax, grouping) => new Intl.NumberFormat("en-US", {
      useGrouping: grouping, minimumFractionDigits: decimals ?? 0, maximumFractionDigits: decimals ?? fallbackMax,
    });
    if (format === "number_with_commas") return digits(20, true).format(number);
    if (format === "percent") return `${digits(2, false).format(number * 100)}%`;
    if (SYMBOLS[format]) {
      const fixed = new Intl.NumberFormat("en-US", { useGrouping: true, minimumFractionDigits: decimals ?? 2, maximumFractionDigits: decimals ?? 2 }).format(Math.abs(number));
      return `${number < 0 ? "-" : ""}${SYMBOLS[format]}${fixed}`;
    }
    return decimals === null ? String(number) : digits(0, false).format(number);
  }
  ```

  已知答案（单元测试照抄）：

  | 调用 | 结果 |
  | --- | --- |
  | `formatNumber(1234.5, { format: "cny" })` | `¥1,234.50` |
  | `formatNumber(-1234.5, { format: "usd" })` | `-$1,234.50` |
  | `formatNumber(1234.5, { format: "eur", decimals: 0 })` | `€1,235` |
  | `formatNumber(0.256, { format: "percent", decimals: 1 })` | `25.6%` |
  | `formatNumber(0.5, { format: "percent" })` | `50%` |
  | `formatNumber(0, { format: "percent" })` | `0%` |
  | `formatNumber(1234567.891, { format: "number_with_commas", decimals: 2 })` | `1,234,567.89` |
  | `formatNumber(1234567.891, { format: "number_with_commas" })` | `1,234,567.891` |
  | `formatNumber(3.14159, { format: "number", decimals: 2 })` | `3.14` |
  | `formatNumber(2.5, { format: "number", decimals: 0 })` | `3` |
  | `formatNumber(-0.5, { format: "number", decimals: 0 })` | `-1` |
  | `formatNumber(1234567, {})` | `1234567` |
  | `formatNumber(null, { format: "cny" })` | 空字符串 |
  | `formatNumber(0, { format: "cny" })` | `¥0.00` |

- `formatPropertyValue`：`number` 类型、以及结果是数字的 `formula`/`rollup`，有 `config.numberFormat` 时用 `formatNumber`；`unique_id` 按上面的规则；`created_by`/`last_edited_by` 显示 `我`。没有 `numberFormat` 时显示结果与现在完全相同（现有场景检查公式单元格显示 `240`）。
- **日期显示**：`databaseProperties.js` 新增 `formatDateLabel(value)`：`"2026-09-05"` → `2026年9月5日`；`"2026-09-05T09:00"` → `2026年9月5日 09:00`；有 `end` 时 `开始 → 结束`。只用于新的日期单元格和底部统计；`formatPropertyValue` 的日期输出**不变**（搜索、导出和现有测试依赖它）。

### 2.2 唯一 ID 的编号规则（`src/domain/propertyChanges.js`）

- `assignUniqueIds(workspace, { sourceId, propertyId })`：该数据源全部记录按 `createdAt` 升序、相同时按 `id` 升序编号 1、2、3…（回收站里的记录也编号），`nextNumber = 记录数 + 1`。新增 `unique_id` 属性时（`App.jsx` 的 `addDatabaseProperty`）在同一个 `setWorkspace` 更新函数里调用。
- 新建记录（`createDatabaseItem`、CSV 导入、复制记录）：在 `setWorkspace` 的更新函数里，从 `current` 中该属性的 `config.nextNumber` 取号写进新记录，并把 `nextNumber` 加 1。更新函数只能依赖 `current`（React 严格模式可能调用两次）。
- 删除记录、记录进回收站都**不**减少 `nextNumber`，号码不会被重复使用。

### 2.3 公式引擎（改造 `src/domain/formula/engine.js`）

1. **错误信息改中文**，错误码不变（`PARSE`、`TYPE`、`EVAL`、`REF`、`CYCLE`）：

   | 位置 | 新信息 |
   | --- | --- |
   | 词法/语法错误（`SyntaxError`） | `第 <位置+1> 个字符：<原因>`；原因依次为：`属性引用缺少 }}`、`属性引用为空`、`字符串缺少结束引号`、`无法识别的字符`、`这里应该是 <期望>`、`公式嵌套太深`、`未知的名称：<名称>`、`这里应该是一个值`、`公式末尾有多余的内容`、`prop() 需要一个属性名称字符串`；位置取出错的那个记号的 `start` |
   | 计算错误 | `需要数字`、`不能除以 0`、`不能对 0 取余`、`需要有效的日期`、`需要两个有效的日期`、`不支持的时间单位`、`未知函数：<名称>`、`公式计算步骤过多`、`公式嵌套太深`、`不支持的运算符`、`无法计算的表达式`、`不能对负数开平方`、`结果超出范围`、`无法转换为数字`、`小数位数必须是 0–10 的整数` |
   | `database.js` | `公式循环引用：<属性名>`、`找不到属性：<ID>` |

2. **关键字函数**（`and(…)`、`or(…)`、`empty(…)`）：**在语法分析里判断，不改词法分析的分类**。如果在词法里把“`and` 后面跟 `(`”当成函数名，`{{a}} > 1 and ({{b}} or {{c}})` 这种正常的写法就会报错。照下面两处改（总设计师已在现有 `engine.js` 上试过，11 个例子的语法树都正确）：
   - `tokenizeFormula`：把 `else if (lower === "null" || lower === "empty") push("literal", null, start);` 拆成两行：`null` 照旧；`empty` 改为 `tokens.push({ type: "literal", value: null, start, word: "empty" });`（多一个 `word` 字段，其余不变）。`and`、`or`、`not` 仍然是 `op`。
   - `parseFormula` 的 `primary` 里，`const token = take();` 之后、判断 `literal` 之前，加：

     ```js
     const call = (name) => {
       take(); // "("
       const args = [];
       if (current().type !== ")") {
         do { args.push(expression()); if (current().type !== ",") break; take(); } while (true);
       }
       expect(")", ")");
       return node("CallExpression", { name, args });
     };
     if (current().type === "(" && ((token.type === "op" && (token.value === "and" || token.value === "or")) || (token.type === "literal" && token.word === "empty"))) return call(token.value ?? "empty");
     ```

     `primary` 只在“这里需要一个值”的位置被调用，所以 `{{a}} and ({{b}})` 里的 `and` 仍然是运算符，`and({{a}}, {{b}})` 才是函数。`not` 不用改：`not(x)` 和 `not x` 都按现在的一元运算处理，结果相同；但函数表（第 6 条）里仍然要实现 `not`，因为第 7 条的帮助测试要求 `FORMULA_HELP` 里的每个名称引擎里都有。
3. **`prop("属性名")`**：解析函数调用时，名称（不区分大小写）是 `prop` 且只有一个字符串字面量参数，就生成 `{ kind: "PropertyRef", propertyName: "<名称>" }`；参数不对时报 `prop() 需要一个属性名称字符串`。计算时 `options.resolveName(名称)` 返回属性 ID，再走 `lookup`；找不到返回 `formulaError("REF", "找不到属性：<名称>")`。`resolvePropertyValue` 调用时传 `{ now: Date.now(), resolveName: (name) => source.properties.find((p) => p.name === name)?.id }`。`formulaDependencies(source, { resolveName } = {})` 同样把名称引用换成 ID（找不到的跳过）。
4. **日期按“墙上时间”解析**：没有时区后缀的 `YYYY-MM-DDTHH:mm` 当作 UTC 解析（等于末尾加 `:00Z`），这样 `hour`、`minute`、`formatDate` 返回的就是用户输入的时间，与电脑所在时区无关。只有日期的 `YYYY-MM-DD` 照旧按 UTC 零点。带时区后缀的照常 `Date.parse`。
5. **`dateAdd`/`dateSubtract` 返回单个日期**（`end: null`）；有时间的结果写成 `YYYY-MM-DDTHH:mm`（不带秒和 `Z`），只有日期的写成 `YYYY-MM-DD`。单位新增 `minute(s)`。`dateBetween` 新增单位 `minute(s)`、`year(s)`（按 365 天）。
6. **函数表**（新增的照下表实现；“例”一列就是单元测试用例，`now` 固定为 `new Date(2026, 9, 1, 8, 30).getTime()`，属性“金额”=12、“名称”=`"Alpha"`、“日期”=`2026-09-19`、“标签”=`["a","b"]`、“时间”=`{ start: "2026-09-19T10:45", end: "2026-09-21T08:00", includeTime: true }`）：

   | 分组 | 函数 | 说明 | 例 → 结果 |
   | --- | --- | --- | --- |
   | 逻辑 | `if(条件, 是, 否)` | 已有 | — |
   | 逻辑 | `ifs(条件1, 值1, 条件2, 值2, …, 否则?)` | 按顺序取第一个为真的条件对应的值；只计算用到的参数；都不成立且没有“否则”时为空 | `ifs(prop("金额") > 20, "大", prop("金额") > 10, "中", "小")` → `"中"`；`ifs(false, 1)` → `null`；`ifs(false, 1, 2)` → `2` |
   | 逻辑 | `and(…)`、`or(…)`、`not(x)` | 全部为真 / 任一为真 / 取反 | `and(true, false)` → `false`；`and(1, "x", true)` → `true`；`or(false, 0, "")` → `false`；`not(false)` → `true` |
   | 逻辑 | `empty(x)` | 用 `isEmptyProperty` 判断 | `empty("")` → `true`；`empty(prop("标签"))` → `false`；`empty(null)` → `true` |
   | 文本 | `concat`、`string`、`length`、`lower`、`upper`、`contains` | 已有；`length` 改为按字符计（`Array.from`） | `length("你好")` → `2` |
   | 文本 | `format(x)` | 转成文字：布尔 `true`/`false`，日期 `start`（有 `end` 时 `start → end`），数组用 `, ` 连接 | `format(prop("标签"))` → `"a, b"`；`format(prop("日期"))` → `"2026-09-19"` |
   | 文本 | `join(列表, 分隔符 = ", ")` | 数组各项转文字后连接；不是数组时等于 `format` | `join(prop("标签"), "、")` → `"a、b"` |
   | 文本 | `replace(文本, 查找, 替换)`、`replaceAll(…)` | 按**原样文字**替换第一处 / 全部（不是正则；替换文字里的 `$&` 没有特殊含义；查找为空时原样返回） | `replace("a-b-c", "-", "+")` → `"a+b-c"`；`replaceAll("a-b-c", "-", "+")` → `"a+b+c"`；`replace("x", "x", "$&$&")` → `"$&$&"` |
   | 文本 | `slice(文本, 开始, 结束?)` | 按字符切，支持负数 | `slice("你好世界", 1, 3)` → `"好世"`；`slice("你好世界", -2)` → `"世界"` |
   | 文本 | `padStart(文本, 长度, 填充 = " ")`、`trim(文本)` | — | `padStart("7", 3, "0")` → `"007"`；`trim("  a ")` → `"a"` |
   | 文本 | `toNumber(x)` | 数字原样；布尔 1/0；日期返回毫秒；空返回 `null`；其他文字不能转换时报错 `无法转换为数字` | `toNumber("42")` → `42`；`toNumber(true)` → `1`；`toNumber("")` → `null` |
   | 数学 | `abs`、`ceil`、`floor`、`sqrt`、`pow`、`mod` | `sqrt` 负数报错；`pow` 结果不是有限数报错；`mod` 除数为 0 报错，符号随被除数 | `floor(-1.2)` → `-2`；`pow(2, 10)` → `1024`；`mod(-7, 3)` → `-1` |
   | 数学 | `round(x, 位数 = 0)` | 用“科学计数法移位”取整，避免浮点误差；与 `Math.round` 一样 `-2.5 → -2` | `round(1.005, 2)` → `1.01`；`round(2.5)` → `3`；`round(-2.5)` → `-2` |
   | 数学 | `min(…)`、`max(…)`、`sum(…)` | 参数里的数组展开一层，忽略空值；没有数字时 `min`/`max` 为 `null`、`sum` 为 `0` | `sum(1, 2, 3)` → `6`；`min()` → `null` |
   | 日期 | `now()`、`today()` | 用 `options.now` 的**本地**时间；`now()` 返回含时间的日期，`today()` 返回只有日期的日期 | `format(today())` → `"2026-10-01"`；`format(now())` → `"2026-10-01T08:30"` |
   | 日期 | `dateAdd`、`dateSubtract`、`dateBetween`、`formatDate` | 已有，按上面第 4、5 条调整 | `format(dateAdd(prop("时间"), 90, "minutes"))` → `"2026-09-19T12:15"` |
   | 日期 | `year`、`month`（1–12）、`date`（几号 1–31）、`day`（星期几，0=周日…6=周六）、`hour`、`minute`、`week`（ISO 周数） | — | `day(prop("日期"))` → `6`；`week(prop("日期"))` → `38`；`week("2027-01-01")` → `53`；`week("2026-01-01")` → `1`；`hour(prop("时间"))` → `10` |
   | 日期 | `dateStart(d)`、`dateEnd(d)` | 取开始 / 结束（没有结束时取开始），结果 `end: null` | `format(dateEnd(prop("时间")))` → `"2026-09-21T08:00"` |
   | 引用 | `prop("属性名")` | 第 3 条 | `prop("金额") * 2` → `24` |

   错误用例（单元测试照抄，`[公式, 错误码, 信息]`）：`["sqrt(-1)", "TYPE", "不能对负数开平方"]`、`["mod(1, 0)", "TYPE", "不能对 0 取余"]`、`["1 / 0", "TYPE", "不能除以 0"]`、`["toNumber(\"abc\")", "TYPE", "无法转换为数字"]`、`["unknownFn(1)", "TYPE", "未知函数：unknownFn"]`、`["prop(\"不存在\")", "REF", "找不到属性：不存在"]`、`["prop(1)", "PARSE", "第 1 个字符：prop() 需要一个属性名称字符串"]`、`["1 +", "PARSE", "第 4 个字符：这里应该是一个值"]`、`["\"abc", "PARSE", "第 1 个字符：字符串缺少结束引号"]`、`["1 2", "PARSE", "第 3 个字符：公式末尾有多余的内容"]`、`["abs(\"x\")", "TYPE", "需要数字"]`、`["year(\"x\")", "TYPE", "需要有效的日期"]`、`["round(1.5, 1.5)", "TYPE", "小数位数必须是 0–10 的整数"]`。

   实现提示：`asNumber` 对 `null`、`undefined`、`""`、对象都报 `需要数字`；函数参数里有错误对象时直接返回那个错误；`if` 和 `ifs` 只计算用到的参数。
7. **帮助数据** `src/domain/formula/help.js`：`export const FORMULA_HELP = [{ name, group, signature, description, example }]`，每个函数一项，内容就是上表（`group` 取 逻辑/文本/数学/日期/引用）。单元测试检查：引擎里每个函数在 `FORMULA_HELP` 里都有，`FORMULA_HELP` 里每个名称（`prop` 除外）引擎里都有。

### 2.4 底部统计（`src/domain/databaseStats.js`）

- 视图配置：`view.config.table = { columnWidths: { [属性ID]: 宽度 }, wrapPropertyIds: [], calculations: { [属性ID]: 统计方式 } }`。`normalizeViewConfig` 新增 `table` 分支：宽度限制在 80–800 的整数，其他值丢掉；`wrapPropertyIds` 只留字符串；`calculations` 只留下表里的键。
- 统计方式（`CALCULATIONS`，键 → 显示名）：

  | 键 | 显示名 | 适用类型 |
  | --- | --- | --- |
  | `none` | 不计算 | 全部 |
  | `count_all` | 全部计数 | 全部 |
  | `count_values` | 值计数 | 除复选框外（数组按元素个数计） |
  | `count_unique` | 唯一值计数 | 除复选框外（数组展开；用 `formatPropertyValue` 转成文字后去重） |
  | `count_empty`、`count_not_empty` | 空值计数、非空值计数 | 除复选框外 |
  | `percent_empty`、`percent_not_empty` | 空值百分比、非空值百分比 | 除复选框外 |
  | `sum`、`average`、`median`、`min`、`max`、`range` | 求和、平均值、中位数、最小值、最大值、范围 | 数字；公式、汇总（只算数字结果） |
  | `earliest`、`latest`、`date_range` | 最早日期、最晚日期、日期范围 | 日期、创建时间、上次编辑时间 |
  | `checked`、`unchecked`、`percent_checked`、`percent_unchecked` | 已勾选、未勾选、已勾选百分比、未勾选百分比 | 复选框 |

- `availableCalculations(property)` → 适用的键数组（按上表顺序）。
- `computeColumnStat(workspace, source, items, property, calculation)` → `{ value, text }`：
  - 统计对象是**当前视图显示的记录**（筛选和视图内搜索之后）；
  - 百分比的 `value` 是 0–1，`text` 用 `formatNumber(value, { format: "percent" })`；
  - 数字统计的 `text` 用该属性的 `numberFormat`；没有记录时 `average`、`median`、`min`、`max`、`range` 的 `text` 为空；
  - `earliest` = 最小的 `start`，`latest` = 最大的（`end` 或 `start`），`text` 用 `formatDateLabel`；`date_range` 的 `value` 是天数（`latest` 减 `earliest`），`text` 为 `<天数> 天`；
  - `none` 返回 `{ value: null, text: "" }`。
- 单元测试数据（照抄进测试）：一个数据源，属性 `title`、`amount`（数字）、`done`（复选框）、`due`（日期）、`tags`（多选，选项 a/b/c）；5 条记录：
  1. amount 10，done true，due `2026-09-01`，tags [a, b]
  2. amount 20，done false，due `2026-09-05`→`2026-09-08`，tags [a]
  3. amount 空，done true，due 空，tags []
  4. amount 5，done false，due `2026-08-30`，tags [c]
  5. amount 15，done true，due 空，tags []

  期望：`count_all` 5；amount 的 `count_values` 4、`count_unique` 4、`count_empty` 1、`percent_empty` 0.2（`20%`）、`sum` 50、`average` 12.5、`median` 12.5、`min` 5、`max` 20、`range` 15；tags 的 `count_values` 4、`count_unique` 3、`count_empty` 2、`count_not_empty` 3；done 的 `checked` 3、`unchecked` 2、`percent_checked` 0.6（`60%`）；due 的 `earliest` 文字 `2026年8月30日`、`latest` 文字 `2026年9月8日`、`date_range` 9（`9 天`）。只保留前 2 条记录时 amount 的 `sum` 为 30。

### 2.5 更改属性类型与删除属性（`src/domain/propertyChanges.js`）

- `CONVERTIBLE_TYPES = ["text", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email", "phone"]`。只有当前类型和目标类型都在这个列表里时才能更改；`title` 不能更改也不能删除。
- `convertPropertyType(workspace, { sourceId, propertyId, nextType, now, idFactory })` → 新工作区：
  - 单选、状态、多选之间直接转换（保留选项 ID 和颜色）：单选/状态 → 多选 `[id]`；多选 → 单选/状态取第一个；单选 → 状态时给没有 `group` 的选项补 `group: "todo"`。
  - 其他组合先把旧值转成文字 `valueToText`，再转成新值 `textToValue`：

    | 旧类型 | `valueToText` |
    | --- | --- |
    | 文本、URL、电子邮件、电话 | 原文字 |
    | 数字 | `String(数字)` |
    | 单选、状态 | 选项名 |
    | 多选 | 选项名用 `, ` 连接 |
    | 日期 | `start`（有 `end` 时 `start → end`） |
    | 复选框 | `是` / `否` |

    | 新类型 | `textToValue` |
    | --- | --- |
    | 文本、URL、电子邮件、电话 | 文字；空字符串为 `null` |
    | 数字 | `parseCsvNumber`（2.8 节），不是数字为 `null` |
    | 复选框 | 小写后属于 `TRUE_WORDS`（2.8 节）为 `true`，否则 `false` |
    | 日期 | `parseCsvDate`（只取 `→` 之前的部分），得到 `{ start, end: null, includeTime: false, timeZone: null }`，失败为 `null` |
    | 单选、状态 | 按选项名（完全相同）找选项，找不到就新建 |
    | 多选 | 按 `,`、`，`、`、` 拆开、去掉空白和重复，每段按选项名找或新建 |

  - 新建选项：`{ id: idFactory("opt"), name, color: PALETTE[已有选项数 % 10] }`，`PALETTE = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"]`；状态选项另加 `group: "todo"`。
  - 属性的 `type` 改为新类型；值有变化的记录 `updatedAt = now`；各视图 `config.table.calculations` 里对新类型不适用的统计方式删除。
- `deleteProperty(workspace, { sourceId, propertyId })` → 新工作区：
  - 从数据源删除该属性；该数据源所有记录删除 `values[属性ID]`；
  - 该数据源的所有视图：`visiblePropertyIds`、`sorts` 去掉它；筛选树里引用它的条件删除（删除后没有子节点的条件组也删除）；`grouping` 的一级/二级分组是它时设为 `null`；`config` 里所有等于这个属性 ID 的字符串改为 `null`、数组里去掉它、以它为键的对象项删除（深度遍历）；
  - 关联属性：删除 `relations` 里 `sourceId`/`propertyId` 匹配的项；其他关联项的 `reciprocalPropertyId` 等于它时改为 `null`。

### 2.6 单元格编辑器（改造 `PropertyEditor.jsx`）

- **文本、数字、URL、电子邮件、电话**：仍然是现在的 `DraftText` 输入框（标签不变）；样式改为没有聚焦时看起来就是普通文字（写在 2.12 节的样式文件里：`.db-cell-input:not(:focus) { border-color: transparent; background: transparent; box-shadow: none; }`，悬停时 `--mb-hover` 底；聚焦时 WP-20 已经画了一圈 2 px 的浅蓝色内框，和 Notion 编辑单元格时一样，不要再写）。数字类型没有聚焦时显示 `formatNumber(值, 属性.config.numberFormat)`，聚焦后显示原始数字。
- **复选框**：仍是 `<input type="checkbox">`（标签不变），用 CSS 画成 12 第 6 节的复选框：照抄 WP-20 `editor.css` 里待办复选框的三条规则（`appearance: none`、16 px、圆角 3 px、1.5 px 描边；悬停 `--mb-hover` 底；勾选后 `--mb-accent` 底加一个 `data:image/svg+xml` 白色对勾），选择器换成 `.db-table td > input[type="checkbox"]`、`.db-record-property input[type="checkbox"]`；WP-20 给表格复选框写的尺寸和外边距不要改。
- **单选、状态、多选、人员、关联、文件** → 新组件 `src/components/OptionPicker.jsx`：
  - 结构：`<details className="db-option-picker"><summary aria-label={标签}>…</summary><div className="db-option-panel">…</div></details>`。`summary` 里显示彩色标签（`<span className="db-option-tag" data-color={颜色}>名称</span>`，人员/关联/文件用中性色）；状态是 Notion 的状态胶囊（2.12 节）：`<span className="db-status-tag" data-color={颜色} data-group={分组}><i aria-hidden="true"></i>名称</span>`，`颜色` 是选项自己的颜色；选项颜色是 `default`、没有或不认识时按分组取：`todo` → `gray`、`inProgress` → `blue`、`complete` → `green`（没有分组的按 `todo`）；没有值时显示 `—`（`--mb-faint` 色）。
  - **面板只在展开时渲染**（OptionPicker 和下面的 DatePicker 都一样）：组件里 `const [open, setOpen] = useState(false)`，`<details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>`，`{open && <div className="db-option-panel">…</div>}`。原因：收起的 `<details>` 里的元素仍然在页面上，日期面板里有 WP-13 的原生“提醒”下拉框，不这样做的话检查 1“`tbody` 里没有 `select`”一定失败；1 万行的表格也不能每格都渲染一个面板。
  - 面板：顶部搜索框 `aria-label="<标签> 搜索"`（展开时自动聚焦）；下面是选项列表（按搜索词过滤，不区分大小写）：
    - 多选、人员、关联、文件：每行 `<label><input type="checkbox" aria-label="<标签>: <名称>">…</label>`（与现在的标签完全相同，现有场景依赖它）；
    - 单选、状态：每行 `<button role="option" aria-selected>`，点击后选中并收起面板；有值时最上面多一行“清除”；
    - 状态按分组显示小标题：`todo` → “待办”、`inProgress` → “进行中”、`complete` → “完成”；
  - 搜索词不为空且没有同名选项时，列表末尾出现：单选/多选/状态 → `创建「<搜索词>」`（调用 `runtime.updateDatabaseProperty(sourceId, propertyId, { options: [...旧选项, 新选项] })` 后选中它，新选项颜色和分组按 2.5 节规则）；人员 → `新建成员「<搜索词>」`（`runtime.createPerson`，不再用 `window.prompt`）。
  - 关联：选项列表只在面板展开时计算，最多显示 50 条（有搜索词时显示前 50 条匹配的）；修改仍走 `onChange`（App 里已经用 `applyRelationChange` 同步反向关联，WP-10）。
  - 文件：保留“上传文件”和“＋ 添加链接附件”两个现有入口。
  - 键盘：面板里 `↑`/`↓` 移动高亮项、`Enter` 选择（多选时切换勾选）、`Esc` 收起面板并把焦点还给 `summary`。
- **日期** → 新组件 `src/components/DatePicker.jsx`：
  - 结构：`<details className="db-date-picker"><summary aria-label="<标签> 日期">{formatDateLabel(值) || "—"}</summary><div className="db-date-panel">…</div></details>`。
  - 面板内容（从上到下）：开始输入框 `aria-label="<标签> 开始"`（`type="text"`，接受 `YYYY-MM-DD`、`YYYY-MM-DD HH:mm`、`YYYY-MM-DDTHH:mm`，内容合法时立即保存，时间统一存成 `YYYY-MM-DDTHH:mm`）；打开“结束日期”后出现结束输入框 `aria-label="<标签> 结束"`；月历（标题 `2026年9月`，按钮“上个月”“下个月”，周一开头，每天一个按钮 `aria-label="2026-09-20"`，选中的日子 `aria-pressed="true"`）；开关“结束日期”（`<input type="checkbox" role="switch" aria-label="<标签> 结束日期">`）；开关“包含时间”（`aria-label="<标签> 包含时间"`，打开后显示时区输入框，沿用现在的时区校验）；WP-13 加的“提醒”下拉框（`aria-label` 保持 WP-13 的写法不变）；按钮“清除”（`aria-label="清除 <标签>"`）。
  - 点月历：结束日期关闭时，点击设置开始日期；打开时，第一次点设置开始并清空结束，第二次点设置结束（早于开始时两者交换）。
  - 校验沿用 `validatePropertyValue`，错误显示在面板底部（`role="alert"`）。
- **地点**：不改。**只读类型**：显示 `formatPropertyValue`（数字格式在这里生效）。
- **表格里没有原生下拉框和原生日期框**：`DatabaseTable` 的 `tbody` 里不能出现 `select`、`input[type="date"]`、`input[type="datetime-local"]`（场景检查）。

### 2.7 表格（新文件 `src/components/DatabaseTable.jsx`）

- **结构**：保留 `<table className="db-table">`，行 `tr[data-item-id]`、单元格 `td[data-property-id]`（现有场景依赖）。第一列是选择列（见“行”），之后是属性列（名称列固定为第一个属性列），最后一列是现有的“子项”列。
- **列宽**：每个表头单元格右边缘一个 6 px 的拖动条（`role="separator"`、`aria-orientation="vertical"`、`aria-label="调整 <属性名> 列宽"`、`tabIndex=0`）；拖动范围 80–800 px；松手时写入 `config.table.columnWidths`；聚焦时 `←`/`→` 每次 ±10 px。默认宽度：名称 260，其余 180。
- **列顺序**：表头单元格可拖动（HTML5 拖放，类型 `application/x-life-atlas-column`），落下后更新 `visiblePropertyIds` 的顺序（`visiblePropertyIds` 为 `null` 时先展开成全部属性 ID）；名称列不能拖动，其他列也不能拖到名称列前面。
- **表头按钮**保留 `className="db-property-header"` 和 `title={PROPERTY_LABELS[property.type]}`，再加一个 `data-type={property.type}`：WP-20 的 `database.css` 按它在属性名前面画属性类型图标（2.1 节改了“单选”“电子邮件”“文件和媒体”等显示名，只靠 `title` 这几列会没有图标）。
- **表头菜单**：点表头按钮（现有的 `aria-label="编辑 <属性名> 属性"` 按钮）弹出菜单 `role="menu"`、`aria-label="<属性名> 属性菜单"`，菜单项依次：“编辑属性…”（打开现有的属性设置对话框）、“更改类型”（子菜单列出 2.5 节允许的类型；选中后 `window.confirm("把“<属性名>”从<旧类型>改为<新类型>？无法转换的值会被清空。")`，确认后调用 `runtime.changePropertyType`）、“升序排序”、“降序排序”（把视图的 `sorts` 设为只有这一项）、“筛选…”（在筛选树根节点加一个条件 `{ kind: "condition", propertyId, operator: <该类型第一个操作符>, value: "" }` 并打开视图设置面板）、“隐藏”（名称列没有这项）、“换行显示”（勾选项，切换 `wrapPropertyIds`）、“向左移动”、“向右移动”（键盘可用的列顺序调整）、“删除属性”（名称列没有这项；`window.confirm("删除属性“<属性名>”？所有记录里这个属性的值都会被删除。")` 后调用 `runtime.deleteDatabaseProperty`）。不能用于当前属性的菜单项不显示。
- **底部统计**：`<tfoot>` 一行，每个属性列一个按钮 `aria-label="<属性名> 统计"`：已设置时显示 `显示名 文字`（如“求和 50”），没设置时只在悬停时显示灰色“计算”；点击弹出菜单（`role="menu"`，每项 `role="menuitemradio"`，内容是 `availableCalculations` 的显示名），选择后写入 `config.table.calculations`。
- **换行**：`wrapPropertyIds` 里的列单元格 `white-space: normal`，否则单行省略号。
- **键盘**：单元格 `td` 可聚焦（当前单元格 `tabIndex=0`，其余 `-1`）；焦点在 `td` 上（不在输入框里）时 `↑↓←→` 移动到相邻单元格；`Enter` 进入编辑（文本框聚焦、`details` 展开、复选框切换）；编辑器里 `Esc` 退出编辑并把焦点还给 `td`。
- **行**：
  - 选择列：每行一个复选框 `aria-label="选择 <标题>"`，表头一个 `aria-label="全选"`；悬停或有任何选中时才显示。有选中时表格上方出现 `<div role="toolbar" aria-label="批量操作">已选择 N 条</div>`，里面两个按钮“移到回收站”和“取消选择”。“移到回收站”先 `window.confirm("把选中的 N 条记录移到回收站？")`，再调用 `runtime.trashDatabaseItems(itemIds)`：App 里在一个 `setWorkspace` 更新函数中对每条记录的页面依次调用 WP-01 的 `trashPage(ws, 记录页面ID, now)`。
  - 行菜单：选择列旁边一个 `⋯` 按钮 `aria-label="记录操作 <标题>"`，菜单项“打开”（中心预览）、“在完整页面中打开”、“复制记录”、“移到回收站”。
  - 复制记录：纯函数 `duplicateDatabaseItem(workspace, { itemId, now, idFactory })`（`database.js`）：新记录（新 ID，`values` 复制；`unique_id` 取新号；关联值复制，并对每个关联属性用 `applyRelationChange` 让对方记录也指向新记录）；新记录页面复制原页面的标题、图标、封面、设置和正文（正文用 `cloneBlockDocument` 换新区块 ID），新页面 ID，`sortIndex` 紧跟原页面，`createdAt = updatedAt = now`，不复制评论。
- **名称列**：仍是 `<button className="db-title-cell">`（按钮名就是记录标题，现有场景用它找记录）；点击打开**中心预览**（2.8 节之前的“打开记录”规则）。

### 2.8 中心预览、视图内搜索与打开方式

- **打开方式**：`view.config.openRecordsIn` 取 `"peek"`（默认，没有这个键时也按 `peek`）或 `"page"`；`BaseViewSettings` 加一个下拉框 `aria-label="打开记录的方式"`（中心预览 / 完整页面）。`DatabaseView` 内部定义 `openRecord(pageId)`：`page` 时调用原来的 `onOpenItemPage(pageId)`，否则打开中心预览；传给所有视图组件的 `onOpenItemPage` 都换成 `openRecord`（表格、看板、列表、画廊、日历、时间线、时间脉络、地图、仪表盘）。
- **中心预览** `src/components/RecordPeek.jsx`：用 `createPortal` 渲染到 `document.body`；遮罩 + 居中对话框（`role="dialog"`、`aria-modal="true"`、`aria-label="记录预览"`，宽 `min(900px, 92vw)`，高 `86vh`，内容区可滚动）；顶部：路径“<数据库名> / <记录标题>”、按钮“打开完整页面”（`aria-label="打开完整页面"`，调用原来的 `onOpenItemPage` 并关闭预览）、按钮“关闭”（`aria-label="关闭预览"`）；内容：标题输入框（`aria-label="记录标题"`，修改走 `runtime.updateDatabaseItemValue(itemId, 名称属性ID, 新标题)`）、`<RecordProperties>`（它的 `aria-label="记录属性"` 不变）、记录页面的 `PageEditor`（`pageId` 为记录页面，`onChange` 调用新的 `runtime.updatePageContent(pageId, content)`；传给它的 runtime 里 `pageId` 换成记录页面，`createSubPage: (title) => runtime.createSubPage(title, 记录页面ID)`）。
  - App 的 `createSubPage(title, parentPageId = selectedPage?.id)`：新页面的父页面和文件夹取 `parentPageId` 对应的页面。
  - 关闭：点遮罩、点“关闭”、或焦点不在编辑器正文（`.bn-editor`）里时按 `Esc`。
- **视图内搜索**：视图工具条加一个放大镜按钮 `aria-label="搜索此视图"`，点开后变成输入框 `aria-label="在此视图中搜索"`；`database.js` 新增纯函数 `searchViewItems(workspace, source, items, query)`：标题、文本、URL、电子邮件、电话、单选/状态/多选（选项名）、数字（`formatPropertyValue` 的文字）任一包含查询词（不区分大小写）就保留；查询为空返回原数组。搜索词不保存；底部统计、“N 条记录”计数都按搜索后的结果计算。

### 2.9 性能（1 万条记录）

- `projectViewItems`：开头建 `pagesById = new Map(…)`，回收站判断用它；排序前给每条记录算一次排序键（每个排序属性每条记录只调用一次 `resolvePropertyValue` 和 `comparablePropertyValue`），再按键比较。结果与现在完全相同（现有排序测试必须仍然通过）。
- `DatabaseTable`：建 `itemsById = new Map(…)` 计算子项缩进层级；每个单元格的选项列表只在面板展开时计算。
- **虚拟滚动**：记录数大于 200 且没有换行列时启用：`.db-table-scroll` 加类名 `is-virtual`（`max-height: 70vh; overflow: auto`），行高固定 36 px；只渲染可见范围上下各多 10 行，上下用一个高度合适的空 `<tr aria-hidden="true">` 撑开；滚动时用 `requestAnimationFrame` 更新范围。不启用时行为与现在相同。

### 2.10 CSV 导入（`src/domain/csv.js` + `src/components/CsvImportDialog.jsx`）

- 纯函数（照抄，已用已知答案验证）：

  ```js
  export const TRUE_WORDS = ["true", "yes", "y", "是", "✓", "✔", "√", "x"];
  export const FALSE_WORDS = ["false", "no", "n", "否"];

  export function decodeCsvBytes(bytes, encoding = "auto") {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (encoding === "gbk") return { text: new TextDecoder("gbk").decode(view), encoding: "gbk" };
    if (encoding === "utf-8") return { text: new TextDecoder("utf-8").decode(view), encoding: "utf-8" };
    try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(view), encoding: "utf-8" }; }
    catch { return { text: new TextDecoder("gbk").decode(view), encoding: "gbk" }; }
  }

  export function parseCsv(text) {
    const input = String(text ?? "").replace(/^\uFEFF/, "");
    const rows = [];
    let row = [], field = "", quoted = false, fieldStarted = false, i = 0;
    while (i < input.length) {
      const ch = input[i];
      if (quoted) {
        if (ch === '"') { if (input[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
        field += ch; i++; continue;
      }
      if (ch === '"' && !fieldStarted) { quoted = true; fieldStarted = true; i++; continue; }
      if (ch === ",") { row.push(field); field = ""; fieldStarted = false; i++; continue; }
      if (ch === "\r" || ch === "\n") {
        row.push(field); rows.push(row); row = []; field = ""; fieldStarted = false;
        i += ch === "\r" && input[i + 1] === "\n" ? 2 : 1; continue;
      }
      field += ch; fieldStarted = true; i++;
    }
    if (quoted) throw new Error("CSV 里有没有闭合的引号");
    if (fieldStarted || field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter((entry) => !(entry.length === 1 && entry[0] === ""));
  }

  const DATE_PATTERNS = [/^(\d{4})-(\d{1,2})-(\d{1,2})$/, /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, /^(\d{4})年(\d{1,2})月(\d{1,2})日$/];
  export function parseCsvDate(text) {
    const value = String(text ?? "").trim();
    for (const pattern of DATE_PATTERNS) {
      const match = pattern.exec(value);
      if (!match) continue;
      const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
      return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    return null;
  }

  export function parseCsvNumber(text) {
    const value = String(text ?? "").trim().replace(/,/g, "");
    if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) return null;
    return Number(value);
  }

  export function inferColumnType(values) {
    const filled = values.map((value) => String(value ?? "").trim()).filter(Boolean);
    if (!filled.length) return "text";
    if (filled.every((value) => parseCsvNumber(value) !== null)) return "number";
    if (filled.every((value) => parseCsvDate(value) !== null)) return "date";
    if (filled.every((value) => [...TRUE_WORDS, ...FALSE_WORDS].includes(value.toLowerCase()))) return "checkbox";
    const distinct = new Set(filled);
    if (distinct.size <= 20 && distinct.size < filled.length) return "select";
    return "text";
  }
  ```

- 另外两个纯函数（自己实现）：
  - `buildCsvDatabase(workspace, { fileName, header, rows, columnTypes, folderId, now, idFactory })` → `{ workspace, pageId, importedCount, unrecognizedCount }`：新建一个整页数据库（数据源标题和页面标题 = 文件名去掉 `.csv`），第 1 列是名称（标题）属性，其余列按 `columnTypes` 建属性（单选的选项按值第一次出现的顺序新建，颜色按 2.5 节色板循环）；每行一条记录和记录页面；页面放进 `folderId`；无法识别的值（数字、日期列里解析失败的）留空并计入 `unrecognizedCount`。
  - `importCsvIntoSource(workspace, { sourceId, header, rows, mapping, now, idFactory })` → `{ workspace, importedCount, unrecognizedCount }`：`mapping[列序号]` 是属性 ID 或 `null`（忽略）；值用 2.5 节的 `textToValue` 转换（单选/多选会新建缺少的选项）；`unique_id` 按 2.2 节取号。
- 限制：文件不超过 10 MB、不超过 50,000 行（不含表头）、不超过 200 列。由 `csv.js` 的纯函数 `assertCsvLimits({ byteLength, rowCount, columnCount })` 检查，超过任何一项就 `throw new Error("文件太大：<哪一项超了，例如“最多 200 列，这个文件有 201 列”>")`；对话框读完文件、`parseCsv` 之后马上调用它，抛错时显示错误信息、不导入。
- **对话框**（`role="dialog"`、`aria-label="导入 CSV"`）：
  1. 选择文件 `<input type="file" accept=".csv,text/csv" aria-label="选择 CSV 文件">`；编码 `aria-label="文件编码"`（自动 / UTF-8 / GBK，默认自动，选“自动”时显示识别结果“已识别为 GBK”）；勾选框“第一行是表头”（`aria-label="第一行是表头"`，默认勾选；不勾选时列名为“列 1”“列 2”…）。
  2. 预览前 20 行。新建模式：每列一个类型下拉框 `aria-label="列类型 <列名>"`（第一列固定为“名称”，其余默认 `inferColumnType` 的结果）；导入到现有数据库：每列一个下拉框 `aria-label="对应属性 <列名>"`（选项：忽略 + 数据源里可写的属性；默认选同名属性，没有同名就忽略）。
  3. 按钮 `导入 N 条记录`；完成后显示 `已导入 N 条记录`，有无法识别的值时加上 `，M 个值无法识别，已留空`（`role="status"`）。
- **入口**：数据库视图工具条加按钮 `aria-label="导入 CSV"`（导入到当前数据源）；工作区菜单加一项“导入 CSV…”（新建数据库，放进当前选中的文件夹，没有就放第一个顶层文件夹）。

### 2.11 公式编辑器（`src/components/FormulaEditor.jsx`）

在 `PropertyConfigDialog` 里替换现在的公式 `textarea` 部分：

- 输入框仍是 `<textarea aria-label="公式表达式">`。
- “属性”一栏：每个属性一个按钮，点击在光标处插入 `prop("<属性名>")`（不再插入 `{{ID}}`；旧公式里的 `{{ID}}` 照样能用）。
- “函数”一栏：按 `FORMULA_HELP` 的 `group` 分组，每个函数一个按钮（显示 `signature`，`title` 为 `description`），点击在光标处插入 `<name>(`。
- 预览：`role="status"`，内容“预览（<第一条记录标题>）：<结果文字>”；有错误时“错误：<message>”。用数据源里第一条不在回收站的记录计算；没有记录时显示“预览：没有记录”。输入时实时更新。

### 2.12 墨白样式（规定）

- **参照画面**：表格 `design/mobai/shots/database-light.png`、`database-dark.png`（原型 `design/mobai/prototype/index.html#view=database&mode=light`，夜间把 `light` 换成 `dark`），看板 `board-*`（`#view=board`），记录预览 `peek-*`（`#view=peek`）；列表、画廊、日历、时间线、图表、表单、仪表盘、地图 8 种视图是 `design/mobai/product-shots-views/view-<视图>-light.png`、`-dark.png`（2.13 节）。WP-20 的 `theme/database.css` 已经把表格画成 Notion 的网格表格（表头前面是属性类型图标）、看板每列一层淡灰底、卡片白底带阴影，8 种视图的样式也写好了；本 WP 只补新加的东西。原型**只看不改**。
- **样式文件**：新文件 `src/ui/themes/mobai/database-editing.css`，在 `src/ui/themes/mobai/index.css` 末尾追加一行 `@import "./database-editing.css";`（只能追加，前面的行不动）。规则照原型 `b.css` 的 “database” 一段和 `b-more.css` 的 “record peek”“form controls”“dialogs, scrims, menus” 几段改写：每个选择器前加 `:root[data-style="mobai"] `，变量按 12 第 0 节的对应表换名，只用 `--mb-*` 变量；旧 CSS 里不写颜色（K13）。
- **选项标签**（原型 `.tag`）：`.db-option-tag[data-color="<颜色>"]` 底色 `var(--mb-tag-<颜色>)`、文字 `var(--mb-tag-<颜色>-text)`（9 种：gray、brown、orange、yellow、green、blue、purple、pink、red）；`default`、没有颜色和不认识的颜色用 `--mb-tag-default` / `--mb-tag-default-text`；人员、关联、文件的标签也用 `default`。高 20 px（`line-height: 20px`）、左右 6 px、圆角 3 px、表格里 14 px，单行，太长时省略号；几个标签之间隔 6 px。看板和画廊卡片里（`.db-board-card`、`.db-gallery-card` 里面）字号 12 px。
- **状态胶囊**（12 第 6 节，原型 `.status`）：`.db-status-tag[data-color="<颜色>"]` 高 20 px、圆角 10 px、左边 7 px 右边 8 px 内边距、表格里 14 px，底色 `--mb-tag-<颜色>`、文字 `--mb-tag-<颜色>-text`；前面的 `i` 是 8 px 的圆点，颜色 `--mb-u-<颜色>`，和文字隔 6 px。`data-color` 怎么取见 2.6 节。
- **弹出编辑器**（`.db-option-panel`、`.db-date-panel`）：12 第 6 节“菜单 / 弹出层”的样子（`--mb-raised` 底、`--mb-pop` 阴影、圆角 10 px、内边距 4 px）；顶部的搜索框是 12 第 6 节的输入框；选项行高 30 px、圆角 6 px、左右 8 px，悬停或高亮时 `--mb-hover` 底，行里就是上面的选项标签或状态胶囊；状态的分组小标题是菜单分组标题的样子（12 px 500 `--mb-muted`）；“创建「…」”一行用 `--mb-muted` 字和加号图标。月历：标题 14 px 600 `--mb-ink`；“上个月”“下个月”是 24×24 的图标按钮（`--mb-muted`，悬停 `--mb-hover` 底）；星期一行 12 px `--mb-faint`、居中；每天是 30×30 的按钮、圆角 6 px、14 px，悬停 `--mb-hover` 底；不在本月的日子用 `--mb-faint`；今天的数字是 `--mb-today` 红色、600；选中的日子（`aria-pressed="true"`）`--mb-accent` 底、白字；范围中间的日子 `--mb-accent-soft` 底；开关用 12 第 6 节的开关（30×18）；“清除”是文字按钮。
- **表头菜单、统计菜单、行菜单**：用产品现有的 `ui-popover ui-menu`（WP-20 已写好）；列宽拖动条平时看不见，悬停或聚焦时显示一条 2 px 的浅蓝竖线（`rgba(var(--mb-accent-rgb), 0.5)`，Notion 也是这样），拖动时变成 `--mb-accent`；拖动列时的插入线 2 px `--mb-accent`。
- **底部统计**（原型 `.calc`）：显示名 12 px `--mb-faint`，数字 13 px 500 `--mb-ink`、`tabular-nums`；没设置时的“计算”平时 `opacity: 0`，鼠标移到底部这一行或按钮获得焦点时 `opacity: 1`、`--mb-faint` 色（12 第 1 节原则 3，不用 `display: none`）。
- **选择列与批量操作条**：行复选框照 2.6 节的复选框；平时 `opacity: 0`，鼠标移到这一行、复选框获得焦点或有任何选中时 `opacity: 1`（2.7 节）。“已选择 N 条”工具条在表格上方：高 32 px、左右 8 px、`--mb-raised` 底、`--mb-pop` 阴影、圆角 6 px；“已选择 N 条”是 14 px 500 `--mb-accent` 字；“移到回收站”“取消选择”是文字按钮（12 第 6 节）。
- **中心预览**（原型 `.peek`）：外壳沿用产品的 `.modal-backdrop` 遮罩和 `.ui-dialog`，类名加 `record-peek`；宽见 2.8 节；顶部一行 44 px：左边路径（14 px `--mb-muted`），右边“打开完整页面”（文字按钮）和关闭按钮（28×28 图标按钮）；内容区上下 40 px、左右 72 px 内边距；标题输入框 34 px 700、`--mb-ink`、没有框，下面空 18 px；`.db-record-properties` 里每个 `.db-record-property` 是两栏（左边 160 px 的标签，14 px `--mb-muted`；右边是值），每行至少 34 px 高、圆角 6 px、悬停 `--mb-hover-soft` 底；属性区下面空 14 px，再一条 1 px `--mb-line` 细线。
- **CSV 导入对话框、公式编辑器**：外壳同上；预览表格是网格表格（12 第 8 节，和数据库表格一样）；列类型、对应属性的下拉框照 12 第 6 节；公式编辑器的表达式输入框是 12 第 6 节的输入框、`13.6px/1.6 var(--mb-mono)`；属性和函数按钮是小号次按钮（高 26 px、圆角 6 px、13 px），函数签名用等宽字；预览（`role="status"`）是一行 `--mb-paper-2` 底、圆角 6 px，出错时文字用危险色。

### 2.13 画廊封面和日历（改 `src/data/coverGallery.js`、`src/components/DatabaseBasicViews.jsx`）

WP-20 装上主题以后，8 种视图的样式都对了，但有 3 个问题要改代码（总设计师 2026-11-06 在项目副本上找到并试过下面的改法；`design/mobai/product-shots-views/` 就是改完以后的样子）：

| 现在的样子 | 原因 | 改法 |
| --- | --- | --- |
| 画廊卡片的封面是空的 | 画廊把 `page.cover` 当成图片地址字符串，而页面封面现在是 `{ kind: "gallery", value: "<封面 ID>", position }` 或 `{ kind: "upload", value: "<data: 地址>", position }` 这样的对象 | 下面第 1 条 |
| 日历没有“周一 … 周日”这一行，也看不出哪天是今天 | 代码里没有画 | 第 2、3 条 |
| 日历月视图的标题是 `2026-11` | 代码写的是 `anchor.slice(0,7)` | 第 4 条 |

1. **画廊封面**：`src/data/coverGallery.js` 末尾加（照抄）：

   ```js
   // 页面封面（字符串地址，或 { kind, value, position } 对象）→ 画廊卡片用的图片地址和位置（WP-15 第 2.13 节）
   export function galleryCoverImage(cover) {
     if (!cover) return null;
     if (typeof cover === "string") return { url: cover, position: 50 };
     const normalized = normalizeCoverChoice(cover);
     if (normalized?.kind === "upload" && normalized.value) return { url: normalized.value, position: normalized.position ?? 50 };
     if (normalized?.kind === "gallery") {
       const entry = coverGalleryItem(normalized.value);
       if (entry) return { url: entry.src, position: normalized.position ?? entry.defaultPosition ?? 50 };
     }
     return null;
   }
   ```

   `DatabaseBasicViews.jsx` 第 3 行 `import { normalizeViewConfig } from "../domain/viewRegistry.js";` 后面加一行 `import { galleryCoverImage } from "../data/coverGallery.js";`。画廊封面那一行（以 `  return <div className="db-gallery-preview db-gallery-cover" style={page?.cover ?` 开头）整行换成下面两行（照抄）。没有封面时只显示页面图标，原来的“🗂️”占位去掉（Notion 的画廊卡片没有封面时那一块是空的）：

   ```jsx
     const image = galleryCoverImage(page?.cover);
     return <div className="db-gallery-preview db-gallery-cover" style={image ? { backgroundImage: `url("${image.url.replace(/"/g, "%22")}")`, backgroundSize: config.imageFit, backgroundRepeat:"no-repeat", backgroundPosition:`center ${image.position}%` } : undefined}>{!image && (page?.icon || "")}</div>;
   ```

2. **星期一行**：`DatabaseBasicViews.jsx` 的 import 下面加两个常量（照抄）：

   ```js
   const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
   const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
   ```

   `DatabaseCalendar` 里 `` <div className={`db-calendar-grid mode-${config.mode}`} role="grid" aria-label="数据库日历"> `` 这一行的**前面**加一行（照抄；星期一行在 `role="grid"` 外面，现有场景数的 42 个格子不变）：

   ```jsx
       <div className="db-calendar-weekdays" aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <span key={index}>{WEEKDAY_NAMES[(config.startOfWeek + index) % 7]}</span>)}</div>
   ```

3. **今天**：同一个函数里 `` return <section className={`db-calendar-cell ${outside ? "is-outside" : ""}`} role="gridcell" tabIndex={0} aria-label={day} data-date={day} key={day} `` 这一行换成下面两行（照抄；后面接着的 `onDragOver=…` 等不动）。`day` 是日历格子的日期，`localDay()` 是电脑本地时间的今天，两个都是 `YYYY-MM-DD`；WP-20 的 `database.css` 已经把 `.is-today` 的日期数字画成红底白字的圆：

   ```jsx
         const isToday = day === localDay();
         return <section className={`db-calendar-cell ${outside ? "is-outside" : ""}${isToday ? " is-today" : ""}`} aria-current={isToday ? "date" : undefined} role="gridcell" tabIndex={0} aria-label={day} data-date={day} key={day}
   ```

4. **月标题**：日历工具条里的 `anchor.slice(0,7)` 换成 `` `${Number(anchor.slice(0,4))}年${Number(anchor.slice(5,7))}月` ``（周视图的 `${days[0]} — ${days[6]}` 不改）。

上面几处要改的原文，总设计师 2026-11-06 在项目现在的源码里逐字核对过。如果到了 WP-15 时找不到原文（前面的 WP 改过这些行），按意思改，并在报告第 5 节写清楚改了哪几行。

## 3. 范围

### 不做

- 本地自动化、按钮属性、冻结列、条件颜色、公式里的列表字面量和 `let`、侧边预览。
- 时间脉络视图的改动（WP-09 已完成；只允许第 0 节写明的那一处传参）；看板、画廊等其他视图的虚拟滚动。
- 恢复已删除的属性（快照可以恢复）。

## 4. 执行步骤

### 步骤 0：开工准备【停止点】

按执行手册 3.1 节开工（分支 `wp/15-database`），生成报告骨架，跑基线：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-15/step0-npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-15/step0-browser.log npm run test:parity:browser
```

在报告第 1 节回答理解题：

1. 一个 ID 属性前缀是 `TASK`，已有 3 条记录，删除第 3 条后新建一条，新记录显示什么？
2. `prop("金额") * 2` 和 `{{amount}} * 2` 有什么区别？属性改名后哪个还能用？
3. 把一个单选属性改成文本，再改回单选，选项颜色还在吗？为什么？
4. 点击表格里记录的标题，默认打开什么？怎样改成打开完整页面？

提交 `WP-15: step 0 understanding`，运行 `node docs/blueprint/tools/wp-check.mjs WP-15 --until 0`，退出码 0 → **停止**。

### 步骤 1：属性类型与数字格式

按 2.1、2.2 节实现（`numberFormat.js`、新类型、显示名、`formatDateLabel`、`assignUniqueIds`）。新建 `tests/number-format.test.mjs`：

- `number formats match the known answers`（2.1 节表格 14 行）
- `formatted numbers appear in property values`：数字属性带 `numberFormat: { format: "cny" }` 时 `formatPropertyValue` 返回 `¥1,234.50`；不带时返回 `1234.5`。
- `date labels use chinese dates`：`formatDateLabel` 的 3 个例子（2.1 节）。

新建 `tests/unique-id.test.mjs`：

- `unique ids number existing records by creation time`：3 条记录 `createdAt` 分别为 T+2、T+1、T+1（后两条 ID 为 `b`、`a`）→ 编号依次：T+1 的 `a` 为 1、`b` 为 2、T+2 的为 3，`nextNumber === 4`。
- `unique ids display the prefix`：前缀 `TASK`、值 7 → `TASK-7`；无前缀 → `7`。
- `created by and last edited by show me`：`resolvePropertyValue` 返回 `"我"`。

提交 `WP-15: property types and number formats`。

### 步骤 2：公式引擎

按 2.3 节改造 `engine.js`、`database.js` 的调用，新建 `help.js`。新建 `tests/formula-functions.test.mjs`：

- `new formula functions match the known answers`：2.3 节函数表“例”一列的全部用例（用 `evaluateFormula(公式, lookup, { now, resolveName })`）。
- `formula errors are reported in chinese with positions`：2.3 节的 13 个错误用例，逐个比较 `error.code` 和 `error.message`。
- `keyword functions do not break keyword operators`：`lookup = (id) => ({ a: 2, b: false, c: true })[id]`；`true and false` → `false`；`not true` → `false`；`not (true)` → `false`；`empty` → `null`；`{{a}} > 1 and ({{b}} or {{c}})` → `true`；`true and (false or true)` → `true`；`and(true, false)` → `false`；`or(false, true)` → `true`；`{{c}} and and({{c}}, true)` → `true`；`empty("")` → `true`。
- `prop references resolve by name and report dependencies`：`formulaDependencies('prop("金额") + {{name}} + prop("没有")', { resolveName })` 为 `["amount", "name"]`。
- `formula help covers every function`（2.3 节第 7 条）。
- `formula results ignore the computer time zone`：`hour("2026-09-19T10:45")` → `10`；`formatDate("2026-09-19T10:45", "HH:mm")` → `"10:45"`。

提交 `WP-15: formula functions`。

### 步骤 3：底部统计

按 2.4 节实现 `databaseStats.js` 和 `normalizeViewConfig` 的 `table` 分支。新建 `tests/database-stats.test.mjs`：

- `column statistics match the known answers`（2.4 节的数据和期望值）
- `statistics follow the filtered rows`（只保留前 2 条时 `sum` 为 30）
- `available calculations depend on the property type`：复选框只有 `none`、`count_all`、`checked`、`unchecked`、`percent_checked`、`percent_unchecked`；日期有 `earliest`、`latest`、`date_range` 没有 `sum`；文本没有 `sum`。
- `table view config keeps only valid values`：宽度 50 → 80、900 → 800、`"x"` 丢掉；未知统计方式丢掉。

提交 `WP-15: column statistics`。

### 步骤 4：更改类型与删除属性

按 2.5 节实现。新建 `tests/property-changes.test.mjs`（用满配夹具的 `ds-inline`/`ds-full`，必要时在测试里给数据源加属性）：

- `select and multi select convert without losing colors`：单选 → 多选 → 单选，选项 ID 和颜色不变，值正确。
- `text converts to number checkbox date and select`：文本值 `"12"`、`"是"`、`"2026/9/3"`、`"甲"` 分别转成数字 12、复选框 `true`、日期 `2026-09-03`、单选（新建选项“甲”，颜色 `default`）。
- `unconvertible values become empty`：文本 `"abc"` 转数字为 `null`，记录 `updatedAt` 等于传入的 `now`。
- `deleting a property cleans items views and relations`：删除 `ds-inline` 的 `rel-to-full` → 记录里没有这个值；视图的 `visiblePropertyIds`、`sorts`、筛选里都没有它；`relations` 里没有 `propertyId === "rel-to-full"` 的项。
- `the title property cannot be converted or deleted`：两个函数都抛错 `名称属性不能更改类型或删除`。

提交 `WP-15: property type changes`。

### 步骤 5：CSV 纯函数

按 2.10 节实现 `csv.js`（含 `buildCsvDatabase`、`importCsvIntoSource`）。新建 `tests/csv-import.test.mjs`：

- `csv parsing handles quotes newlines and bom`：`parseCsv('名称,备注\r\n"A, inc","说 ""你好""\n第二行"\n"",空\n')` 深度等于 `[["名称","备注"],["A, inc","说 \"你好\"\n第二行"],["","空"]]`；`parseCsv("\uFEFFa,b\nc,d")` → `[["a","b"],["c","d"]]`；`parseCsv("a,b,\n1,,3\n")` → `[["a","b",""],["1","","3"]]`。
- `gbk bytes are detected and decoded`：`decodeCsvBytes(new Uint8Array([0xC3,0xFB,0xB3,0xC6,0x2C,0xBD,0xF0,0xB6,0xEE,0x0D,0x0A,0xC6,0xBB,0xB9,0xFB,0x2C,0x33,0x0D,0x0A]))` → `{ text: "名称,金额\r\n苹果,3\r\n", encoding: "gbk" }`。
- `column types are inferred`：`["1","2.5","","-3","1,200"]` → `number`；`["2026-09-01","2026/9/2","2026年9月3日"]` → `date`；`["2026-02-30"]` → `text`；`["是","否","是"]` → `checkbox`；`["进行中","完成","进行中","完成"]` → `select`；`["甲","乙","丙"]` → `text`；`[""," "]` → `text`。
- `a new database is built from csv`：表头 `["名称","金额","状态"]`、3 行 → 新数据源有 3 个属性（名称、数字、单选），3 条记录和 3 个记录页面，单选选项按出现顺序；`checkWorkspaceIntegrity` 没有 error。
- `csv rows import into an existing database`：导入 `ds-full`，映射“名称”→`title`、“评分”→`score`、“备注”→`null` → 新增 2 条，`score` 是数字；无法识别的数字计入 `unrecognizedCount`。
- `limits are enforced`：`assertCsvLimits` 对 `{ byteLength: 100, rowCount: 1, columnCount: 201 }`、`{ byteLength: 100, rowCount: 50001, columnCount: 2 }`、`{ byteLength: 10 * 1024 * 1024 + 1, rowCount: 1, columnCount: 2 }` 都抛错，信息以 `文件太大` 开头；`{ byteLength: 10 * 1024 * 1024, rowCount: 50000, columnCount: 200 }` 不抛错。

提交 `WP-15: csv parsing and import`。

### 步骤 6：性能与视图内搜索

按 2.9 节前两条和 2.8 节的 `searchViewItems` 实现。新建 `tests/database-performance.test.mjs`：

- `projecting ten thousand records stays fast`：`bigWorkspace({ pages: 0, records: 10000 })`，视图筛选 `status equals doing`、按 `amount` 降序 → 连续运行 3 次取中位数，小于 300 ms；`console.log("WP15_PROJECT_MS=" + 中位数)`。
- `projection results are unchanged`：同一个夹具，改造前后的排序结果一致（把改造前的实现复制一份到测试里作为参照，只在这个测试里用）。
- `view search matches titles text and option names`：在满配夹具 `ds-inline` 上搜“任务一”得到 1 条；搜“进行中”（状态选项名）得到 i-2；空查询返回原数组。

提交 `WP-15: projection performance and view search`。

### 步骤 7：纯函数检查点【停止点】

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-15/step7-npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-15/step7-build.log npm run build
node docs/blueprint/tools/run-logged.mjs .qa/WP-15/step7-browser.log npm run test:parity:browser
```

全部通过后，报告第 0 节步骤 1–7 标为“完成”，第 3 节写出 `WP15_PROJECT_MS`，提交 `WP-15: domain checkpoint`，运行 `node docs/blueprint/tools/wp-check.mjs WP-15 --until 7`，退出码 0 → **停止**。

### 步骤 8：单元格编辑器

按 2.6 节实现 `OptionPicker.jsx`、`DatePicker.jsx` 并改造 `PropertyEditor.jsx`（样式按 2.12 节）。按规定修改一处现有测试（执行手册 4.5 节第 1、2 条，报告第 4 节写明）：

- `tests/browser/phase1-database.mjs`：在 `await alpha().getByLabel("日期 · Alpha 项目 开始", { exact: true }).fill("2026-09-20");` 这一行**之前**加一行 `await alpha().locator('[data-property-id="date"] summary').click();`。其他不改。

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-15/step8-browser.log npm run test:parity:browser
```

通过后提交 `WP-15: notion style cell editors`。

### 步骤 9：表格

把 `DatabaseTable` 移到新文件 `src/components/DatabaseTable.jsx`，按 2.7 节实现列宽、列顺序、表头菜单、底部统计、换行、键盘导航（样式按 2.12 节）；App 的 `databaseRuntime` 增加 `changePropertyType(sourceId, propertyId, nextType)`、`deleteDatabaseProperty(sourceId, propertyId)`（都在一个 `setWorkspace` 更新函数里调用 2.5 节的纯函数）。`npm run build` 通过后提交 `WP-15: table columns header menu and footer`。

### 步骤 10：行操作与中心预览

按 2.7 节“行”和 2.8 节的“打开方式”“中心预览”实现（样式按 2.12 节）；App 的 `databaseRuntime` 增加 `trashDatabaseItems`、`duplicateDatabaseItem`、`updatePageContent`，`createSubPage` 增加第二个参数。

中心预览会改变“点记录标题后看到什么”，按规定修改现有测试（执行手册 4.5 节第 1 条，只改操作方式，报告第 4 节逐条写明）：

- `tests/browser/phase3-workspace.mjs` 的 `openAlpha`：在 `await db.getByRole("button", { name:"Alpha 项目", exact:true }).click();` 之后加一行 `await page.getByRole("button", { name: "打开完整页面", exact: true }).click();`。
- 其他场景（包括 `wp09-roadmap` 第 3 项、`wp10-templates`、`wp12-navigation`、`wp13-inbox`）如果点击记录后断言的是完整页面里才有的元素，用同样的方法在点击后加一行“打开完整页面”。逐个列在报告第 4 节。`phase1-database` 的“Record page exposes shared typed properties…”不需要改（预览里也有“记录属性”）。

新建 `tests/record-duplicate.test.mjs`：

- `duplicating a record copies values content and relations`：复制 `i-1` → 新记录的值与 `i-1` 相同（关联 `rel-to-full` 也包含 `i-3`），`i-3` 的 `rel-back` 同时包含 `i-1` 和新记录；新页面正文文字相同但区块 ID 都不同。
- `duplicated records get a new unique id`：给 `ds-inline` 加 ID 属性后复制 → 新记录的号码是 `nextNumber` 原来的值，`nextNumber` 加 1。

运行浏览器场景全部通过后提交 `WP-15: row actions and center peek`。

### 步骤 11：视图内搜索与虚拟滚动

按 2.8 节“视图内搜索”和 2.9 节“虚拟滚动”实现界面。提交 `WP-15: view search and virtual rows`。

再按 2.13 节改画廊封面和日历。新建 `tests/gallery-cover.test.mjs`：

- `gallery covers resolve to image addresses`（从 `../src/data/coverGallery.js` 导入 `galleryCoverImage`）：`null` → `null`；`"data:image/png;base64,AAAA"` → `{ url: "data:image/png;base64,AAAA", position: 50 }`；`{ kind: "gallery", value: "hokusai-landscape", position: 30 }` → `{ url: "/covers/hokusai-landscape.jpg", position: 30 }`；`{ kind: "gallery", value: "hokusai-landscape" }` → `{ url: "/covers/hokusai-landscape.jpg", position: 50 }`；`{ kind: "preset", value: "indigo" }` → `{ url: "/covers/hokusai-landscape.jpg", position: 50 }`；`{ kind: "upload", value: "data:image/png;base64,BBBB", position: 20 }` → `{ url: "data:image/png;base64,BBBB", position: 20 }`；`{ kind: "gallery", value: "no-such-cover" }` → `null`。

跑 `npm test` 和 `npm run test:parity:browser`（`phase2-work-surfaces` 的日历检查必须照常通过），通过后提交 `WP-15: gallery covers and calendar today`。

### 步骤 12：表格界面检查点【停止点】

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-15/step12-npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-15/step12-build.log npm run build
node docs/blueprint/tools/run-logged.mjs .qa/WP-15/step12-browser.log npm run test:parity:browser
```

全部通过后，报告第 0 节步骤 8–12 标为“完成”，第 4 节列出步骤 8、10 改过的测试，提交 `WP-15: table ui checkpoint`，运行 `node docs/blueprint/tools/wp-check.mjs WP-15 --until 12`，退出码 0 → **停止**。

### 步骤 13：CSV 导入界面

按 2.10 节实现对话框和两个入口（样式按 2.12 节）。工作区菜单里“导入 CSV…”放在“备份与恢复…”之后。

WP-12 的场景 `tests/browser/wp12-navigation.mjs` 检查 5 断言了工作区菜单的完整列表，这里按规定修改它（执行手册 4.5 节第 2 条）：期望列表在“备份与恢复…”之后加上“导入 CSV…”，其他不改，报告第 4 节写明。

运行浏览器场景全部通过后提交 `WP-15: csv import dialog`。

### 步骤 14：公式编辑器

按 2.11 节实现（样式按 2.12 节），并在 `PropertyConfigDialog` 里给数字、公式、汇总属性加“数字格式”（`aria-label="数字格式"`，选项来自 `NUMBER_FORMATS`）和“小数位数”（`aria-label="小数位数"`：默认、0、1、2、3、4）两个下拉框，给 ID 属性加“前缀”输入框（`aria-label="ID 前缀"`，不合规时提示“前缀只能包含字母、数字和短横线，最多 10 个字符”）。提交 `WP-15: formula editor and property settings`。

### 步骤 15：浏览器场景

新建 `tests/browser/wp15-database.mjs`（`browserScenario` 的第三个参数加 `viewport: { width: 1440, height: 900 }`；下面说的“截图 `x`”一律写成 WP-12 的 `await shootBothModes(page, screenshot, "x")`，白天、夜间各一张）。种子：`fullWorkspace()` 加下面的内容（写在场景文件里的函数 `databaseSeed()` 中）：

- `ds-full` 增加属性：`tags`（多选“标签”，选项 `fe` 前端/blue、`be` 后端/purple）、`priority`（单选“优先级”，选项 `p0` P0/red、`p1` P1/orange）、`budget`（数字“预算”，`config: { numberFormat: { format: "cny" } }`）、`launch`（日期“发布日期”）、`site`（URL“网址”）、`note`（文本“备注”）；
- `ds-full` 增加 3 条记录 `i-5`（项目丙，score 4，budget 1200）、`i-6`（项目丁，score 1，budget 300.5）、`i-7`（项目戊，score 2，budget 空），记录页面 `p-rec-5`…`p-rec-7` 放在 `f-z`（写法照 `10-测试夹具规格.md` 里 `item(...)` 和 `page(...)` 的格式）；`i-3` 的 tags 为 `["fe","be"]`、priority `p0`、budget 5000、launch `2026-09-10`；
- `v-full-table` 的 `visiblePropertyIds` 设为 `null`（显示全部属性）。

场景开头写 `page.on("dialog", (dialog) => dialog.accept())`（确认框一律接受）。检查项（标题照抄；都在“整页项目库”页面里进行）：

1. `Cells show values until they are opened`：表格 `tbody` 里没有 `select`、`input[type="date"]`、`input[type="datetime-local"]`；“优先级”单元格里是带颜色的标签；截图 `database`（和参照图同名）。
2. `Option picker searches selects and creates options`：点项目乙的“优先级”单元格的 `summary` → 搜索框输入 `p1` → 点选项“P1”→ `saved()` 里 i-4 的 `priority === "p1"`；再展开 → 输入“P9”→ 截图 `option-picker`（加 `{ keepVisible: ".db-option-panel" }`）→ 点“创建「P9」”→ `saved()` 里多了名为 P9 的选项，i-4 的值是它的 ID。
3. `Date picker sets a range with the calendar`：点项目甲的“发布日期”单元格的 `summary` → 打开“结束日期”开关 → 在月历上依次点 `2026-09-12` 和 `2026-09-15` 两个按钮 → `saved()` 里 i-3 的 `launch.start === "2026-09-12"`、`launch.end === "2026-09-15"`；截图 `date-picker`（加 `{ keepVisible: ".db-date-panel" }`）。
4. `Keyboard moves between cells and enters editing`：点击项目甲行“评分”单元格里的输入框 → 按 `Escape` → `document.activeElement` 是这个 `td` → `ArrowRight` → `document.activeElement` 变成右边那个 `td` → `Enter` → 焦点进入那个单元格里的编辑器（输入框获得焦点，或 `details` 展开）→ `Escape` → 焦点回到 `td`。
5. `Columns resize reorder hide and wrap per view`：先点“复制为新视图”得到视图 B，再用“选择数据库视图”切回“表格”；把“评分”表头的分隔条向右拖 120 px → `config.table.columnWidths.score` 在 290–310 之间；表头菜单“向右移动”把“评分”右移一位 → `visiblePropertyIds` 里“评分”的位置后移一位；“备注”表头菜单“隐藏”→ 表头没有“备注”；“标签”表头菜单“换行显示”→ `wrapPropertyIds` 包含 `tags`；刷新后这些都保持；最后切到视图 B，它的 `config.table` 和 `visiblePropertyIds` 与复制时相同。
6. `Header menu sorts filters changes type and deletes`：“评分”表头菜单“降序排序”→ 第一行是项目甲（5）；“备注”表头菜单“筛选…”→ 视图设置面板打开，筛选里多了一个条件；“备注”表头菜单“更改类型”→“数字”→ 属性类型变为 `number`；“网址”表头菜单“删除属性”→ 数据源里没有 `site`。最后点“清除筛选”并关闭视图设置面板。
7. `Footer statistics follow the filter`：点“预算”底部的统计按钮，选“求和”→ 显示 `求和 ¥6,500.50`（5000 + 1200 + 300.5）；打开视图设置，点“+ 条件”，`筛选属性 0` 选“评分”、`筛选操作 0` 选 `greater_than`、`筛选值 0` 填 `1` → 求和变为 `¥6,200.00`；截图 `footer-stats`；最后点“清除筛选”并关闭视图设置面板。
8. `Rows can be selected trashed duplicated and opened`：勾选项目丁、项目戊 → 工具条显示“已选择 2 条”→“移到回收站”（确认）→ 两行消失，回收站里有它们；项目丙行菜单“复制记录”→ 出现第二个“项目丙”；点“项目甲”标题 → 出现 `role="dialog"` 名为“记录预览”的对话框，里面有“记录属性”；在预览里把标题改成“项目甲改”→ 表格里同步变化；点“打开完整页面”→ 页面标题输入框是“项目甲改”；截图 `peek`（打开预览后截，加 `{ keepVisible: '[aria-label="记录预览"]' }`，和参照图同名）。
9. `View search filters rows`：点“搜索此视图”，输入“丙”→ 只剩项目丙的行（和它的副本）；清空后恢复。
10. `Formula editor previews and inserts functions`：添加公式属性 → 点属性按钮“评分”→ 表达式出现 `prop("评分")` → 输入 ` * 2` → 预览显示“预览（项目甲改）：10”；输入 `sqrt(-1)` → 预览显示“错误：不能对负数开平方”；截图 `formula-editor`。
11. `Unique ids number records and are never reused`：“属性 +”→“ID”→ 对话框里 `ID 前缀` 填 `PRJ` → 保存 → 项目甲改那一行的 ID 单元格显示 `PRJ-1`（满配夹具记录的 `createdAt` 相同，按 ID 排序，`i-3` 最小）；记下 `saved()` 里该属性的 `nextNumber` 为 n → 点“新建记录”→ 新行显示 `PRJ-<n>`，`nextNumber` 变为 n + 1。
12. `Csv import builds a database and imports rows`：打开工作区菜单（左上角按钮）→“导入 CSV…”→ `page.getByLabel("选择 CSV 文件").setInputFiles({ name: "水果.csv", mimeType: "text/csv", buffer: Buffer.from("名称,数量,状态\n苹果,3,有货\n香蕉,5,缺货\n橙子,2,有货\n", "utf8") })` → 预览里 `列类型 数量` 为数字、`列类型 状态` 为单选 → 截图 `csv-import` → 点“导入 3 条记录”→ 显示“已导入 3 条记录”→ 侧栏出现页面“水果”。再回到“整页项目库”，工具条点“导入 CSV”，选 GBK 文件（`buffer` 是步骤 5 GBK 用例的字节，文件名 `gbk.csv`）→ 显示“已识别为 GBK”→ `对应属性 名称` 为“名称”、`对应属性 金额` 为“忽略”→ 导入 → 表格里出现“苹果”。

检查 12 之后再截一张看板（只截图，不是检查项）：打开“B 笔记”，在行内数据库的视图标签栏点“看板”，截图 `board`（和参照图同名），再点回“表格”。

再新建一个场景 `tests/browser/wp15-views.mjs`，给 8 种视图截对照图（12 第 7 节；参照图 `design/mobai/product-shots-views/`）。开头照抄：

```js
import fs from "node:fs";
import { browserScenario, shootBothModes } from "./harness.mjs";
import { fullWorkspace } from "../fixtures/full-workspace.mjs";

// 教学安排：一张有 10 种视图的整页数据库（p-teach，在文件夹“A 项目”里），日期都在 2026 年 10–11 月
const sample = JSON.parse(fs.readFileSync("docs/blueprint/design/mobai/sample-database.json", "utf8"));
function viewsWorkspace() {
  const workspace = fullWorkspace();
  for (const key of ["dataSources", "databaseViews", "databaseItems", "pages"]) workspace[key].push(...structuredClone(sample[key]));
  return workspace;
}
const VIEWS = ["list", "gallery", "calendar", "timeline", "chart", "form", "dashboard", "map"];
const viewSection = 'section.database-view[data-source-id="ds-teach"]';
async function chooseView(page, key) {
  await page.getByLabel("选择数据库视图", { exact: true }).selectOption(`v-teach-${key}`);
  await page.waitForFunction(([selector, type]) => document.querySelector(selector)?.getAttribute("data-view-type") === type, [viewSection, key]);
  await page.waitForTimeout(800);
}
```

最后一行是 `}, { workspace: viewsWorkspace(), viewport: { width: 1440, height: 900 } });`。检查项（标题照抄）：

1. `The sample database opens`：`await page.clock.setFixedTime(new Date("2026-11-06T10:00:00+08:00"))`（把“今天”定在参照图的那一天；计时器照常走）→ `await page.locator(".workspace-tree-row", { hasText: "教学安排" }).first().click()`，等 1600 ms → `viewSection` 出现。
2. 检查 2–9：对 `VIEWS` 里的每一个 `key`（按顺序）各写一个检查，标题是 `` `View ${key} is captured` ``（harness 每个检查限时 30 秒，8 个视图放在一个检查里会超时）：`await chooseView(page, key)` → 把视图标题栏滚到离窗口顶端 70 px：`await page.evaluate(() => { const header = document.querySelector(".db-view-header"); const scroller = document.querySelector(".workspace-scroll"); scroller.scrollTop += header.getBoundingClientRect().top - 70; })`，等 400 ms → ``await shootBothModes(page, screenshot, `view-${key}`)``。注意：视图标签栏里的 `role="tab"` 按钮是**改当前视图的类型**，不是切换到另一个视图，这里不要点它们。
3. 检查 10 `Gallery shows covers and the calendar marks today`：`chooseView(page, "gallery")` → 第一个 `.db-gallery-cover` 的 `getComputedStyle(元素).backgroundImage` 包含 `/covers/`；`chooseView(page, "calendar")` → `.db-calendar-weekdays span` 有 7 个，第一个的文字是“周一”；`.db-calendar-cell[data-date="2026-11-06"]` 的类名包含 `is-today`、`aria-current` 是 `date`，`.db-calendar-cell.is-today` 只有这一个；`.db-calendar-toolbar strong` 的文字是“2026年11月”。

`wp15-database` 加入场景列表，单独运行：

```powershell
$env:PARITY_ONLY = "wp15-database"
node docs/blueprint/tools/run-logged.mjs .qa/WP-15/browser-wp15.log npm run test:parity:browser
Remove-Item Env:PARITY_ONLY
```

`wp15-views` 也加入场景列表，用同样的办法单独运行（`$env:PARITY_ONLY = "wp15-views"`，日志 `.qa/WP-15/browser-wp15-views.log`）。

两个场景都通过后生成对照图：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-15/compare.log node docs/blueprint/tools/compare-shots.mjs docs/blueprint/design/mobai/shots .qa --prefix wp15-database- --only database,board,peek --out .qa/WP-15/compare
node docs/blueprint/tools/run-logged.mjs .qa/WP-15/compare-views.log node docs/blueprint/tools/compare-shots.mjs docs/blueprint/design/mobai/product-shots-views .qa --prefix wp15-views- --out .qa/WP-15/compare-views
```

退出码都是 0。第一组的数据和原型的示例不同，差异占比只供参考；第二组用的是同一份“教学安排”，视图部分应该几乎一样（侧栏里的页面可以不同）。把两个 `summary.md` 都复制进报告第 3 节，并逐张写出你看到的不同之处（布局、字体、颜色、线条）。提交 `WP-15: database browser scenario`。

### 步骤 16：桌面端到端

新建 `tests/desktop/database.e2e.mjs`（临时数据目录 → `seedWorkspaceDatabase` → `launchApp({ dataRoot })` → 最后 `assertNoNetworkAndErrors`）：

- `a ten thousand record table stays fast`：工作区 = `bigWorkspace({ pages: 0, records: 10000 })`，把 `big-db-page` 的标题改成“大表格”后写入数据库；启动后按 `Ctrl+K` 搜“大表格”并回车 → 从回车到第一行记录出现的毫秒数 < 1500；`tbody tr[data-item-id]` 的数量 < 100（虚拟滚动生效）；把 `.db-table-scroll` 滚动到底 → 最后一条记录出现；用表头菜单“降序排序”`amount` → 从点击到第一行变化的毫秒数 < 500。`console.log` 输出 `WP15_TABLE_OPEN_MS=`、`WP15_SORT_MS=`。截图 `desktop-big-table`（WP-05 的 `shootWindowBothModes`，放 `.qa/WP-15/shots/`，白天、夜间各一张）。
- `csv files import on desktop`：普通满配夹具；用工作区菜单“导入 CSV…”，`setInputFiles` 选一个 GBK 文件 → 导入成功；关闭并重启应用 → 新数据库和记录仍在。

运行：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-15/build.log npm run build
node docs/blueprint/tools/run-logged.mjs .qa/WP-15/desktop-build-test.log npm run desktop:build:test
node docs/blueprint/tools/run-logged.mjs .qa/WP-15/desktop-e2e.log npm run test:e2e:desktop
```

全部通过后提交 `WP-15: database desktop tests`。

### 步骤 17：收尾【停止点】

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-15/npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-15/browser-all.log npm run test:parity:browser
```

填完报告（第 3 节写出 `WP15_PROJECT_MS`、`WP15_TABLE_OPEN_MS`、`WP15_SORT_MS`）；第 0 节全部“完成”；提交 `WP-15: complete report`；运行 `node docs/blueprint/tools/wp-check.mjs WP-15 --browser --desktop`，退出码 0 或 2 → 停止。

## 5. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-15-1 | 表格里没有原生下拉框和原生日期框；单选、多选、状态、人员、关联、文件、日期都用新的弹出编辑器，能搜索、选择、新建选项 | 场景检查 1–3；`.qa/wp15-database-database-*.png`、`option-picker`、`date-picker` 截图 |
| AC-15-2 | 单元格键盘操作（方向键、Enter、Esc） | 场景检查 4 |
| AC-15-3 | 列宽、顺序、隐藏、换行保存在视图配置里，刷新后保持，不影响同数据源的其他视图 | 场景检查 5；`tests/database-stats.test.mjs` 第 4 个用例 |
| AC-15-4 | 表头菜单的排序、筛选、更改类型、删除属性可用；更改类型的转换规则与删除属性的清理有单元测试 | 场景检查 6；`tests/property-changes.test.mjs` |
| AC-15-5 | 底部统计每种方式都有单元测试，随筛选变化 | `tests/database-stats.test.mjs`；场景检查 7 |
| AC-15-6 | 数字格式的 14 个已知答案全部通过，界面显示正确 | `tests/number-format.test.mjs`；场景检查 7 |
| AC-15-7 | 公式：函数表全部用例、13 个中文错误用例、`prop()` 与依赖分析、时区无关；现有公式测试不改动仍然通过；源码没有 `eval`/`Function` | `tests/formula-functions.test.mjs`；`tests/core-parity-phase2.test.mjs` |
| AC-15-8 | 行的批量选择与移到回收站、复制记录（含关联与 ID）、行菜单 | 场景检查 8；`tests/record-duplicate.test.mjs` |
| AC-15-9 | 中心预览：打开、编辑标题和属性、打开完整页面、关闭；“打开记录的方式”可以改成完整页面 | 场景检查 8 |
| AC-15-10 | CSV：两种导入方式、类型推断、列映射、GBK、引号和换行、大小限制 | `tests/csv-import.test.mjs`；场景检查 12；「csv files import on desktop」 |
| AC-15-11 | ID 属性自动编号、显示前缀、号码不复用；创建者/最后编辑者显示“我” | `tests/unique-id.test.mjs`；场景检查 11 |
| AC-15-12 | 视图内搜索 | 场景检查 9；`tests/database-performance.test.mjs` 第 3 个用例 |
| AC-15-13 | 1 万条记录：投影 < 300 ms，表格打开 < 1500 ms，排序 < 500 ms，虚拟滚动生效（报告写实测值） | `tests/database-performance.test.mjs`；「a ten thousand record table stays fast」 |
| AC-15-14 | 现有测试全部仍通过；改过的测试只有步骤 8、10、13 规定的那几处，逐条写在报告第 4 节 | `.qa/WP-15/npm-test.log`；`.qa/WP-15/browser-all.log`；报告第 4 节 |
| AC-15-15 | 视觉：新界面照墨白做（2.12 节），选项是彩色标签、状态是带圆点的胶囊；截图：表格、看板、选项选择器、日期选择器、底部统计、中心预览、公式编辑器、CSV 导入、桌面大表格，白天和夜间各一张；表格、看板、中心预览与参照图并排对照 | `.qa/wp15-database-*.png`；`.qa/WP-15/shots/desktop-big-table-*.png`；`.qa/WP-15/compare/summary.md`；报告第 3 节 |
| AC-15-16 | 其他视图：画廊显示页面封面，日历有星期一行、标出今天、标题是“YYYY年M月”（2.13 节）；8 种视图白天和夜间的截图与 `product-shots-views/` 并排对照 | `tests/gallery-cover.test.mjs`；`wp15-views` 检查 1–10；`.qa/wp15-views-view-*.png`；`.qa/WP-15/compare-views/summary.md`；报告第 3 节 |
| AC-15-17 | G1–G9 | `.qa/WP-15/wp-check.md` |

## 6. 卡点处理

| 情况 | 做法 |
| --- | --- |
| 改了 `PropertyEditor` 后某个现有场景找不到元素 | 先对照第 1 节表格里的标签，确认新组件保留了同样的 `aria-label` 和 `<details>`/`<summary>`；只有日期必须先展开（步骤 8 已规定）；其他情况停下报告 |
| `projectViewItems` 改造后排序测试失败 | 排序键必须和原来的比较结果完全一致（同样的 `comparablePropertyValue`、同样的稳定排序）；先跑步骤 6 的“结果不变”用例找差异 |
| 中心预览里的编辑器和外面的编辑器互相干扰（菜单出现在错误位置） | 确认预览是用 `createPortal` 渲染到 `document.body` 的，并且 `PageEditor` 用的是记录页面的 `pageId` |
| 1 万条记录时浏览器场景太慢 | 大数据量只在桌面端到端里测（浏览器的 localStorage 装不下 1 万条记录）；浏览器场景用小夹具 |
| `window.confirm` 让场景卡住 | 场景开头写 `page.on("dialog", (dialog) => dialog.accept())`；WP-17 会把确认框换成产品对话框 |
| 某个统计方式的结果和 2.4 节的期望值不同 | 以 2.4 节为准（总设计师已逐个手算），检查空值和数组的处理 |
| 选项标签、月历或弹出编辑器在夜间看不清 | 颜色要用 2.12 节的 `--mb-tag-*`、`--mb-u-*` 和 `--mb-*` 变量，不要写十六进制；样式要写在 `database-editing.css` |
| 表头前面没有属性类型图标，或图标不对 | 表头按钮要有 `data-type={property.type}`（2.7 节）；图标规则在 WP-20 的 `database.css` 末尾，不要改它 |
| `wp15-views` 的日历里没有 `is-today`，或今天是别的日子 | `page.clock.setFixedTime` 要在切换视图之前调用；比较用的是 `localDay()`（本地日期），不要用 `toISOString()`（那是 UTC 日期，北京时间早上 8 点以前会差一天） |
