import { useRef, useState } from "react";

/**
 * A reference image for the next generation: uploaded, pasted, dropped or picked
 * from the library. For images it is the subject to keep; for video it is the
 * start frame.
 */
export default function ReferenceSlot({ form, set, model, onPickFromLibrary, onPickEndFrame }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const ref = form.reference;
  const video = form.kind === "video";
  const url = ref?.asset?.url || ref?.url;

  const takeFile = (file) => {
    if (file && file.type.startsWith("image/")) set({ reference: { file, url: URL.createObjectURL(file), name: file.name } });
  };

  return (
    <div className="studio-section">
      <span className="studio-label">{video ? "Start frame" : "Reference"}</span>
      {ref ? (
        <div className="ref-filled">
          <img src={url} alt="" />
          <div className="ref-copy">
            <b>{ref.asset ? "From the library" : ref.name || "Uploaded image"}</b>
            <span className="muted small">
              {video
                ? ref.asset ? "The video starts from this exact frame." : form.prepareFrame ? "Restaged by the image model, then animated." : "Animated as uploaded."
                : form.preserveSubject ? "The subject stays identical; the scene changes." : "Used as loose inspiration."}
            </span>
          </div>
          <button className="ghost small" onClick={() => set({ reference: null, endFrame: null, parentId: "" })} aria-label="Remove the reference">×</button>
        </div>
      ) : (
        <div
          className={`ref-drop ${over ? "over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={() => setOver(false)}
        >
          <span className="muted small">Drop or paste an image</span>
          <span className="ref-drop-actions">
            <button className="small" onClick={() => input.current?.click()}>Upload</button>
            <button className="ghost small" onClick={onPickFromLibrary}>From library</button>
          </span>
          <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { takeFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
      )}

      {ref && !video && (
        <label className="inline-field ref-option">
          <input type="checkbox" checked={form.preserveSubject} onChange={(e) => set({ preserveSubject: e.target.checked })} />
          Keep the subject identical (shape, label, colours)
        </label>
      )}
      {ref && video && !ref.asset && (
        <label className="inline-field ref-option">
          <input type="checkbox" checked={form.prepareFrame} onChange={(e) => set({ prepareFrame: e.target.checked })} />
          Restage it as an opening frame first
        </label>
      )}
      {ref && video && model?.end_frame && (
        form.endFrame ? (
          <div className="ref-filled ref-end">
            <img src={form.endFrame.asset.url} alt="" />
            <div className="ref-copy">
              <b>End frame</b>
              <span className="muted small">The shot moves from the start frame to this one.</span>
            </div>
            <button className="ghost small" onClick={() => set({ endFrame: null })} aria-label="Remove the end frame">×</button>
          </div>
        ) : (
          <button className="ghost small ref-add-end" onClick={onPickEndFrame}>+ End frame from library</button>
        )
      )}
      {ref && !video && model && !model.reference_input && !model.simulated && (
        <p className="studio-hint warn">{model.name} doesn't take reference images, so this one will be ignored. Pick a model marked “Reference”.</p>
      )}
    </div>
  );
}
