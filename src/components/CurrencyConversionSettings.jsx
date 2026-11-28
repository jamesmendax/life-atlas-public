import { currencyFields } from "../domain/currencyConversion.js";

export function CurrencyConversionSettings({ source, config, onChange }) {
  const change = (key, value) => onChange({ ...config, [key]: value });
  return <fieldset>
    <legend>货币折算</legend>
    <label>本位币代码<input aria-label="本位币代码" required maxLength={3} placeholder="USD" value={config.baseCurrency || ""} onChange={event => change("baseCurrency", event.target.value.toUpperCase())} /></label>
    {currencyFields.map(({ key, label, types }) => <label key={key}>{label}<select aria-label={label} required value={config[key] || ""} onChange={event => change(key, event.target.value)}>
      <option value="">选择属性</option>
      {source.properties.filter(property => types.includes(property.type)).map(property => <option key={property.id} value={property.id}>{property.name}</option>)}
    </select></label>)}
    <p>汇率填写每 1 单位原币可兑换的本位币金额，日期填写该汇率的报价日期。本位币记录直接沿用原金额。外币逐笔折算至本位币的小数位数，缺少有效报价时暂停汇总。</p>
  </fieldset>;
}
