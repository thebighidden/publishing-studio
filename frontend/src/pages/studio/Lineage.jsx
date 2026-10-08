import { useEffect, useState } from "react";
import { api } from "../../api.js";

function relation(asset, parent) {
  const p = asset.params || {};
  if (asset.kind === "video" && p.source_asset_id) return "animated";
  if (p.reference_asset_id) return "referenced";
  if (parent && p.prompt === (parent.params?.prompt || "")) return "variation";
  return "remix";
}

/** Where this asset came from, and what has been made from it. */
export default function Lineage({ asset, bump, onOpen }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let live = true;
    setData(null);
    api.get(`/api/creative/assets/${asset.id}/lineage`).then((d) => live && setData(d)).catch(() => live && setData({ ancestors: [], children: [] }));
    return () => { live = false; };
  }, [asset.id, bump]);

  if (!data) return <div className="lineage muted small">Loading versions…</div>;
  if (!data.ancestors.length && !data.children.length) {
    return <div className="lineage muted small">An original. Remix, vary or animate it and the versions show here.</div>;
  }

  const chain = [...data.ancestors, asset];
  return (
    <div className="lineage">
      <ol className="lineage-chain">
        {chain.map((a, i) => (
          <li key={a.id} className={a.id === asset.id ? "current" : ""}>
            <button onClick={() => a.id !== asset.id && onOpen(a)} disabled={a.id === asset.id} title={a.params?.prompt || a.prompt}>
              {a.kind === "video" ? <video src={a.url} muted preload="metadata" /> : <img src={a.url} alt="" />}
            </button>
            <span className="small muted">{i === 0 ? "original" : relation(a, chain[i - 1])}</span>
          </li>
        ))}
      </ol>
      {data.children.length > 0 && (
        <>
          <span className="studio-label" style={{ marginTop: 10 }}>Made from this · {data.children.length}</span>
          <div className="lineage-children">
            {data.children.map((c) => (
              <button key={c.id} onClick={() => onOpen(c)} title={`${relation(c, asset)}: ${c.params?.prompt || c.prompt}`}>
                {c.kind === "video" ? <video src={c.url} muted preload="metadata" /> : <img src={c.url} alt="" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
