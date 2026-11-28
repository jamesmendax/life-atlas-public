import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFormula } from "../src/domain/formula/engine.js";
import { FormulaPage, FormulaPerson, plainFormulaValue } from "../src/domain/formula/values.js";

test("arithmetic functions, powers, rounding, currency text and the empty constructor", () => {
  for (const [expression, answer] of [
    ["add(3,7)", 10], ["(3).subtract(7)", -4], ["(3).multiply(4)", 12], ["divide(3,4)", .75], ["divide(0,0)", 0],
    ["-2 ^ 2", -4], ["(-2) ^ 2", 4], ["2 ^ -2", .25], ["1 + 3 * 2 ^ 3 ^ 2", 1537],
    ["let(radius,4,round(pi()*radius^2))", 50], ["round(1234,-2)", 1200], ["round(-1249,-2)", -1200],
    ["if(false,today(),empty())", null], ["empty(empty())", true], ["empty(0)", true],
    ['formatNumber(1234,"usd",0)', "$1,234"], ['(0.25).formatNumber("percent",1)', "25.0%"],
    ['[[1],[2,3]].reverse()', [[2,3],[1]]],
  ]) assert.deepEqual(evaluateFormula(expression), answer, expression);
  for (const invalid of ["divide(1,0)", "add(1)", "subtract(2,3,4)", "formatNumber(9,\"bogus\",1)", "reverse(2)", "empty(0,1)"]) {
    assert.equal(evaluateFormula(invalid).error?.code, "TYPE", invalid);
  }
});

test("link labels survive compositing, selective unstyle and ordinary text conversion", () => {
  const expression = 'join([link(style("Read","b","i"),"https://example.com/a").style("u").unstyle("i"),"more"]," / ")';
  const styled = evaluateFormula(expression, undefined, { preserveStyles: true });
  assert.deepEqual(styled.runs, [
    { text: "Read", styles: ["b", "u"], href: "https://example.com/a" },
    { text: " / ", styles: [] }, { text: "more", styles: [] },
  ]);
  assert.equal(evaluateFormula(expression), "Read / more");
  const completelyUnstyled = evaluateFormula('"Call".link("tel:1234567").style("b").unstyle()', undefined, { preserveStyles: true });
  assert.deepEqual(completelyUnstyled.runs, [{ text: "Call", styles: [], href: "tel:1234567" }]);
});

test("person and page identities stay separate from each other and from ID strings", () => {
  const person = new FormulaPerson("same", "Ada", "ada@example.invalid");
  const second = new FormulaPerson("same", "Updated name");
  const page = new FormulaPage("same", "Document", () => null, "visible-page");
  const values = { person, second, page };
  const read = expression => evaluateFormula(expression, key => values[key]);
  assert.equal(read("name({{person}})"), "Ada");
  assert.equal(read("{{person}}.email()"), "ada@example.invalid");
  assert.equal(read("email({{second}})"), null);
  assert.equal(read("{{page}}.id()"), "same");
  assert.equal(page.pageId, "visible-page");
  for (const target of ["{{page}}", '"same"']) {
    for (const expression of ["{{person}} == END", "equal({{person}},END)", "[{{person}}].includes(END)", "[{{person}}].contains(END)"]) {
      assert.equal(read(expression.replace("END", target)), false, expression);
    }
  }
  assert.equal(read("{{person}} == {{second}}"), true);
  assert.equal(read("[{{person}}].includes({{second}})"), true);
  assert.equal(read('[{{person}}, {{page}}, "same", {{second}}].unique().length()'), 3);
  const list = [[person],page];
  assert.deepEqual(plainFormulaValue(list), [["same"],"same"]);
  assert.deepEqual(plainFormulaValue(list,{pageTitles:true}), [["Ada"],"Document"]);
  assert.equal(plainFormulaValue(list,{preserveReferences:true})[0][0],person);
  assert.equal(evaluateFormula("{{person}}",key=>values[key],{preserveReferences:true}),person);
  assert.equal(read('format([{{person}},{{page}}])'),"Ada, Document");
});

test("Unix conversions carry exact instants through both occurrences of a DST fold", t => {
  const previous = process.env.TZ;
  t.after(() => { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; });
  for (const zone of ["UTC","America/New_York","Asia/Shanghai"]) {
    process.env.TZ = zone;
    for (const instant of ["2026-11-01T05:30:29.123Z","2026-11-01T06:30:29.987Z"]) {
      const now = Date.parse(instant);
      const read = input => evaluateFormula(input, undefined, {now});
      assert.equal(read("timestamp(now())"),now,zone);
      assert.equal(read("toNumber(now())"),now,zone);
      assert.equal(read("timestamp(fromTimestamp(timestamp(now())))"),Math.floor(now/60000)*60000,zone);
      assert.equal(read("timestamp(fromTimestamp(-1))"),-60000);
      const both = 'dateRange(parseDate("2026-11-01T01:30-04:00"),parseDate("2026-11-01T01:30-05:00"))';
      assert.equal(read("timestamp(dateStart("+both+"))"),Date.parse("2026-11-01T05:30Z"));
      assert.equal(read("timestamp(dateEnd("+both+"))"),Date.parse("2026-11-01T06:30Z"));
    }
  }
  const dayRange = 'parseDate("2024-01-08").dateRange(parseDate("2024-01-10"))';
  assert.deepEqual(evaluateFormula(dayRange), {start:"2024-01-08",end:"2024-01-10",includeTime:false,timeZone:null});
  assert.equal(evaluateFormula("format("+dayRange+")"), "January 8, 2024 → January 10, 2024");
  const range = {start:"2024-01-08",end:"2024-01-10T11:30",includeTime:true,timeZone:"America/New_York"};
  assert.deepEqual(evaluateFormula("dateStart({{range}})",()=>range), {start:range.start,end:null,includeTime:false,timeZone:null});
  assert.deepEqual(evaluateFormula("dateEnd({{range}})",()=>range), {start:range.end,end:null,includeTime:true,timeZone:range.timeZone});
});
