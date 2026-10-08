import { Modal } from "../../ui.jsx";

export const SHORTCUTS = [
  ["Make", [
    ["Ctrl ↵", "Generate (queues if something is running)"],
    ["R", "Remix: load its settings into the panel"],
    ["V", "Four variations with new seeds"],
    ["E", "Use as the reference image"],
    ["A", "Animate into a video"],
  ]],
  ["Look", [
    ["← →", "Previous / next result"],
    ["C", "Compare with the previous pick (Shift-click any thumbnail to choose)"],
    ["G", "Grid of the batch"],
    ["0 · 1", "Fit · actual size"],
    ["+ −", "Zoom (or scroll on the image)"],
    ["B", "Canvas background"],
  ]],
  ["Keep", [
    ["F", "Favourite"],
    ["D", "Download"],
    ["P", "Post to Instagram"],
    ["L", "Library"],
  ]],
  ["Workspace", [
    ["I", "Show or hide the inspector"],
    ["\\", "Focus mode"],
    ["Esc", "Back to single view, then leave focus"],
    ["?", "This list"],
  ]],
];

export default function Shortcuts({ onClose }) {
  return (
    <Modal title="Shortcuts" onClose={onClose}>
      <div className="shortcut-groups">
        {SHORTCUTS.map(([group, rows]) => (
          <div key={group}>
            <h3>{group}</h3>
            <dl className="shortcut-list">
              {rows.map(([keys, what]) => (
                <div key={keys}>
                  <dt><kbd>{keys}</kbd></dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Modal>
  );
}
