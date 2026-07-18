// ── 共用元件：憑證/附件上傳（由 App.jsx 原樣搬出，2026-07-18 拆檔第二刀；行為零改變）
// 全 App 同一套：可選檔＋貼截圖＋縮圖放大＋移除。工程專案/財務/夥伴中心經 props 共用。
import { useState, useRef } from "react";
import { uploadPhoto } from "../supa.js";
import { BORDER, SUB } from "./theme.jsx";

export default function ReceiptUploader({ receipts = [], onChange, size = 26 }) {
  const [busy, setBusy] = useState(false);
  const [lb, setLb] = useState(null);
  const inputRef = useRef(null);
  const add = async (fileList) => {
    const arr = Array.from(fileList || []); if (!arr.length) return;
    setBusy(true); const out = [];
    for (const f of arr) { try { const { url, path } = await uploadPhoto(f); out.push({ id: "rc" + Math.random().toString(36).slice(2, 7), url, path, name: f.name || "檔案", isImage: /^image\//.test(f.type) }); } catch (_) {} }
    setBusy(false); if (out.length) onChange([...(receipts || []), ...out]);
  };
  const onPaste = (e) => { const items = e.clipboardData?.items; if (!items) return; const fs = []; for (const it of items) { if (it.type?.startsWith("image/")) { const f = it.getAsFile(); if (f) fs.push(f); } } if (fs.length) { e.preventDefault(); add(fs); } };
  const pasteFromClipboard = async () => {
    try {
      const ctxItems = await navigator.clipboard.read();
      const fs = [];
      for (const it of ctxItems) { for (const type of it.types) { if (type.startsWith("image/")) { const blob = await it.getType(type); fs.push(new File([blob], `貼上.${type.split("/")[1] || "png"}`, { type })); } } }
      if (fs.length) await add(fs); else alert("剪貼簿沒有圖片，請先截圖（Cmd+Shift+4 等）再按貼上。");
    } catch (_) { alert("瀏覽器擋住讀取剪貼簿。請改按「＋」選檔，或在此格按 Cmd+V 貼上。"); }
  };
  return (
    <div onPaste={onPaste} style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      <input ref={inputRef} type="file" accept="*/*" multiple style={{ display: "none" }} onChange={e => { add(e.target.files); e.target.value = ""; }} />
      {(receipts || []).map(r => (
        <span key={r.id} style={{ position: "relative", display: "inline-flex" }}>
          {r.isImage
            ? <img src={r.url} alt="" onClick={() => setLb(r)} style={{ width: size, height: size, objectFit: "cover", borderRadius: 4, border: `1px solid ${BORDER}`, cursor: "zoom-in" }} />
            : <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: size * 0.6, textDecoration: "none" }} title={r.name}>📄</a>}
          <button onClick={() => { if (window.confirm("移除這張憑證？此動作無法復原。")) onChange((receipts || []).filter(x => x.id !== r.id)); }} title="移除（會先詢問）" style={{ position: "absolute", top: -6, right: -6, width: 17, height: 17, borderRadius: 9, border: "1.5px solid #fff", background: "#b3261e", color: "#fff", fontSize: 11, lineHeight: "14px", cursor: "pointer", padding: 0, boxShadow: "0 1px 2px rgba(0,0,0,.25)" }}>×</button>
        </span>
      ))}
      <button onClick={() => inputRef.current?.click()} onContextMenu={(e) => { e.preventDefault(); pasteFromClipboard(); }} title="點一下選檔上傳；要貼截圖：在這格按 Cmd+V，或在此鈕按右鍵" style={{ border: `1px dashed ${BORDER}`, background: "#fff", color: SUB, borderRadius: 5, width: size, height: size, fontSize: 13, cursor: "pointer" }}>{busy ? "…" : "＋"}</button>
      {lb && <div onClick={() => setLb(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "zoom-out" }}><img src={lb.url} alt={lb.name} style={{ maxWidth: "95%", maxHeight: "95%", objectFit: "contain", borderRadius: 8 }} /></div>}
    </div>
  );
}