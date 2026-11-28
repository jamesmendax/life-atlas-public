import { useRef, useState } from "react";
import { databaseId } from "../domain/database.js";
import "../ui/themes/mobai/database-actions.css";

export function DatabaseActionButton({ item, property, onRun, disabled = false }) {
  const busy = useRef(false);
  const retryId = useRef(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const action = property?.config?.action;
  const editing = action?.type === "updateRecord";
  return <span className="db-action-cell">
    <button type="button" className="db-action-trigger" disabled={disabled || pending || !action?.targetSourceId || !onRun}
      title={action?.targetSourceId ? undefined : "请先在属性设置中配置动作"} onClick={async event => {
        event.stopPropagation();
        if (busy.current || event.detail > 1) return;
        busy.current = true;
        setPending(true);
        setMessage("");
        const operationId = retryId.current || databaseId("action");
        retryId.current = operationId;
        try {
          const result = await onRun({ action, sourceItemId: item.id, propertyId: property.id, operationId });
          retryId.current = null;
          setMessage(editing ? `已编辑 ${result?.updatedItemIds?.length ?? 1} 条记录` : "已创建记录");
        } catch (error) { setMessage(error?.message || (editing ? "编辑记录失败" : "创建记录失败")); }
        finally { busy.current = false; setPending(false); }
      }}>{pending ? "正在保存…" : property?.config?.label || property?.name || (editing ? "编辑记录" : "创建记录")}</button>
    {message && <small role="status">{message}</small>}
  </span>;
}
