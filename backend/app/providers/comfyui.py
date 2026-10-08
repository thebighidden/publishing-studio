from __future__ import annotations

import copy
import io
import random
import re
import time
from typing import Any, Optional

import httpx
from PIL import Image

from .base import ImageProvider, MediaResult, NotConfigured, ProviderError, aspect_size

# Z-Image Turbo text-to-image, exported from ComfyUI with "Save (API Format)".
# Steps, CFG and sampler are tuned for the turbo model and stay fixed; the studio
# only fills in the inputs named in WORKFLOWS below.
Z_IMAGE_TURBO: dict[str, Any] = {
    "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "z-image-turbo", "images": ["57:8", 0]}},
    "57:30": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_4b.safetensors", "type": "lumina2", "device": "default"}},
    "57:29": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
    "57:33": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["57:27", 0]}},
    "57:8": {"class_type": "VAEDecode", "inputs": {"samples": ["57:3", 0], "vae": ["57:29", 0]}},
    "57:28": {"class_type": "UNETLoader", "inputs": {"unet_name": "z_image_turbo_bf16.safetensors", "weight_dtype": "default"}},
    "57:27": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["57:30", 0]}},
    "57:13": {"class_type": "EmptySD3LatentImage", "inputs": {"width": 1024, "height": 1024, "batch_size": 1}},
    "57:11": {"class_type": "ModelSamplingAuraFlow", "inputs": {"shift": 3, "model": ["57:28", 0]}},
    "57:3": {
        "class_type": "KSampler",
        "inputs": {
            "seed": 0, "steps": 8, "cfg": 1, "sampler_name": "res_multistep", "scheduler": "simple", "denoise": 1,
            "model": ["57:11", 0], "positive": ["57:27", 0], "negative": ["57:33", 0], "latent_image": ["57:13", 0],
        },
    },
}

# The model field of a ComfyUI provider names one of these. Each maps the inputs the
# studio sets to (node id, input name) in the exported graph.
WORKFLOWS: dict[str, dict[str, Any]] = {
    "z_image_turbo": {
        "graph": Z_IMAGE_TURBO,
        "unet": "z_image_turbo_bf16.safetensors",
        "prompt": ("57:27", "text"),
        "seed": ("57:3", "seed"),
        "width": ("57:13", "width"),
        "height": ("57:13", "height"),
        "output": "9",
        # Optional inputs the studio's advanced controls may set: (node, input, default).
        "advanced": {
            "steps": ("57:3", "steps", 8),
            "guidance": ("57:3", "cfg", 1.0),
            "shift": ("57:11", "shift", 3.0),
            "sampler": ("57:3", "sampler_name", "res_multistep"),
            "scheduler": ("57:3", "scheduler", "simple"),
        },
    },
}

SAMPLERS = ["res_multistep", "euler", "euler_ancestral", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_sde", "uni_pc", "ddim", "lcm"]
SCHEDULERS = ["simple", "normal", "karras", "exponential", "sgm_uniform", "beta"]


def resolve_workflow(name: str) -> Optional[dict[str, Any]]:
    """A built-in workflow, or one saved in Settings → ComfyUI workflows."""
    name = name or "z_image_turbo"
    if name in WORKFLOWS:
        return WORKFLOWS[name]
    from sqlmodel import select

    from ..db import session_scope
    from ..models import ComfyWorkflow

    with session_scope() as s:
        row = s.exec(select(ComfyWorkflow).where(ComfyWorkflow.name == name)).first()
        if row is None:
            return None
        m = row.mapping or {}
        workflow: dict[str, Any] = {
            "graph": row.graph,
            "prompt": tuple(m["prompt"]),
            "seed": tuple(m["seed"]),
            "output": m["output"],
            "advanced": {k: tuple(v) for k, v in (m.get("advanced") or {}).items()},
        }
        if m.get("width") and m.get("height"):
            workflow["width"], workflow["height"] = tuple(m["width"]), tuple(m["height"])
        return workflow


def workflow_names() -> list[str]:
    from sqlmodel import select

    from ..db import session_scope
    from ..models import ComfyWorkflow

    with session_scope() as s:
        saved = [row.name for row in s.exec(select(ComfyWorkflow).order_by(ComfyWorkflow.created_at)).all()]
    return [*WORKFLOWS, *saved]


def advanced_controls(model: str) -> dict[str, Any]:
    """What the studio's advanced panel may offer for this workflow, with defaults."""
    workflow = resolve_workflow(model) or {}
    return {key: default for key, (_node, _field, default) in workflow.get("advanced", {}).items()}


def controls_size(model: str) -> bool:
    workflow = resolve_workflow(model) or {}
    return "width" in workflow and "height" in workflow


def _multiple_of_16(value: int) -> int:
    # The latent is 1/8 of the image and patchified in 2x2, so sizes must divide by 16.
    return max(16, round(value / 16) * 16)


def _rejection(resp: httpx.Response) -> str:
    try:
        body = resp.json()
    except ValueError:
        return f"ComfyUI rejected the workflow: {resp.text[:300]}"
    parts = [(body.get("error") or {}).get("message", "ComfyUI rejected the workflow")]
    for node_id, info in (body.get("node_errors") or {}).items():
        for err in info.get("errors", []):
            parts.append(f"node {node_id} ({info.get('class_type')}): {err.get('message')} {err.get('details', '')}".strip())
    return "; ".join(parts)


def _execution_error(entry: dict) -> str:
    for kind, data in entry.get("status", {}).get("messages", []):
        if kind == "execution_error":
            return f"node {data.get('node_id')} ({data.get('node_type')}): {str(data.get('exception_message', '')).strip()}"
    return "execution error"


class ComfyUIImage(ImageProvider):
    """A ComfyUI server running an exported workflow: queue it, poll its history, download the output."""

    def __init__(self, base_url: str, model: str = "", options: Optional[dict[str, Any]] = None):
        if not base_url:
            raise NotConfigured("set the ComfyUI server URL, e.g. http://host:8188")
        self.model = model or "z_image_turbo"
        self.workflow = resolve_workflow(self.model)
        if self.workflow is None:
            raise NotConfigured(f"unknown ComfyUI workflow '{self.model}'; known: {', '.join(workflow_names())}")
        self.base_url = base_url.rstrip("/")
        self.options = options or {}
        self.timeout_s = float(self.options.get("timeout_s") or 300)

    def generate(
        self,
        prompt: str,
        *,
        aspect: str = "1:1",
        seed: int | None = None,
        image: bytes | None = None,
        image_mime: str = "image/png",
        params: dict | None = None,
    ) -> MediaResult:
        if image is not None:
            raise ProviderError(f"the ComfyUI workflow {self.model} is text-to-image only; remove the reference image")

        workflow = self.workflow
        params = params or {}
        if params.get("width") and params.get("height"):
            width, height = _multiple_of_16(int(params["width"])), _multiple_of_16(int(params["height"]))
        else:
            width, height = (_multiple_of_16(v) for v in aspect_size(aspect))
        seed = seed if seed is not None else random.randint(0, 2**32 - 1)
        graph = copy.deepcopy(workflow["graph"])
        for key, value in (("prompt", prompt), ("seed", seed), ("width", width), ("height", height)):
            if key not in workflow:
                continue  # a saved workflow may leave its size to the graph
            node, field = workflow[key]
            graph[node]["inputs"][field] = value
        if "width" not in workflow:
            width = height = None
        for key, (node, field, _default) in workflow.get("advanced", {}).items():
            if params.get(key) not in (None, ""):
                graph[node]["inputs"][field] = params[key]
        graph[workflow["output"]]["inputs"]["filename_prefix"] = "publishing-studio/img"

        try:
            with httpx.Client(base_url=self.base_url, timeout=60.0) as c:
                resp = c.post("/prompt", json={"prompt": graph, "client_id": "publishing-studio"})
                if resp.status_code == 400:
                    raise ProviderError(_rejection(resp), status=400)
                if resp.status_code >= 400:
                    raise ProviderError(
                        f"ComfyUI /prompt failed ({resp.status_code}): {resp.text[:300]}",
                        retryable=resp.status_code >= 500,
                        status=resp.status_code,
                    )
                prompt_id = resp.json()["prompt_id"]

                # ComfyUI adds the history entry only once the prompt has finished, successfully or not.
                deadline = time.monotonic() + self.timeout_s
                while (entry := c.get(f"/history/{prompt_id}").json().get(prompt_id)) is None:
                    if time.monotonic() > deadline:
                        c.post("/queue", json={"delete": [prompt_id]})
                        raise ProviderError(f"ComfyUI did not finish within {int(self.timeout_s)}s", retryable=True)
                    time.sleep(1.0)

                if entry.get("status", {}).get("status_str") == "error":
                    raise ProviderError(f"ComfyUI failed at {_execution_error(entry)}")
                files = [
                    item
                    for value in entry.get("outputs", {}).get(workflow["output"], {}).values()
                    if isinstance(value, list)
                    for item in value
                    if isinstance(item, dict) and "filename" in item
                ]
                if not files:
                    raise ProviderError("ComfyUI finished without an output image")
                file = files[0]
                dl = c.get(
                    "/view",
                    params={"filename": file["filename"], "subfolder": file.get("subfolder", ""), "type": file.get("type", "output")},
                )
                if dl.status_code >= 400:
                    raise ProviderError(f"could not download the image from ComfyUI ({dl.status_code})", retryable=True)
        except httpx.HTTPError as exc:
            raise ProviderError(f"ComfyUI at {self.base_url} is unreachable: {exc}", retryable=True) from exc

        try:
            with Image.open(io.BytesIO(dl.content)) as img:
                width, height = img.size  # the truth, whatever the graph decided
        except (OSError, ValueError):
            pass
        return MediaResult(
            data=dl.content,
            ext=".png",
            mime="image/png",
            model=self.model,
            width=width,
            height=height,
            meta={
                "seed": seed,
                "comfyui_prompt_id": prompt_id,
                "settings": {key: graph[node]["inputs"][field] for key, (node, field, _d) in workflow.get("advanced", {}).items()},
            },
        )

    def check(self) -> str:
        try:
            with httpx.Client(base_url=self.base_url, timeout=15.0) as c:
                stats = c.get("/system_stats")
                stats.raise_for_status()
                info = c.get("/object_info/UNETLoader")
        except httpx.HTTPError as exc:
            raise ProviderError(f"ComfyUI at {self.base_url} is unreachable: {exc}", retryable=True) from exc

        system = stats.json().get("system", {})
        devices = stats.json().get("devices") or [{}]
        detail = f"ComfyUI {system.get('comfyui_version', '?')} on {devices[0].get('name', 'unknown device')}"
        try:
            installed = info.json()["UNETLoader"]["input"]["required"]["unet_name"][0]
        except (KeyError, IndexError, TypeError, ValueError):
            return f"reachable; {detail}"
        unet = self.workflow.get("unet")
        if not unet:
            return f"reachable; {detail}"
        if unet not in installed:
            raise ProviderError(f"reachable ({detail}), but {unet} is not installed in models/diffusion_models")
        return f"reachable; {detail}; {unet} installed"


# ---------------- workflows saved in Settings ----------------

ADVANCED_FIELDS = {
    # studio control -> input names that usually carry it, in order of preference
    "steps": ("steps",),
    "guidance": ("cfg", "guidance"),
    "shift": ("shift",),
    "sampler": ("sampler_name",),
    "scheduler": ("scheduler",),
}
_SAMPLER_NODES = ("KSampler", "KSamplerAdvanced", "SamplerCustom")


class WorkflowError(ValueError):
    pass


def check_graph(graph: Any) -> dict[str, Any]:
    if not isinstance(graph, dict) or not graph:
        raise WorkflowError("that is not a ComfyUI workflow")
    if "nodes" in graph and "links" in graph:
        raise WorkflowError('this is the editor format; in ComfyUI use "Save (API Format)" (enable dev mode in settings) and upload that file')
    for node_id, node in graph.items():
        if not isinstance(node, dict) or "class_type" not in node or not isinstance(node.get("inputs"), dict):
            raise WorkflowError(f"node {node_id!r} is not in API format (needs class_type and inputs)")
    return graph


def describe_nodes(graph: dict[str, Any]) -> list[dict[str, Any]]:
    """Every node with the inputs the studio could set: plain values, not links to other nodes."""
    out = []
    for node_id, node in graph.items():
        fields = {k: v for k, v in node["inputs"].items() if not isinstance(v, list)}
        out.append({
            "id": node_id,
            "class_type": node["class_type"],
            "title": (node.get("_meta") or {}).get("title") or node["class_type"],
            "fields": fields,
        })
    return sorted(out, key=lambda n: (len(n["id"]), n["id"]))


def suggest_mapping(graph: dict[str, Any]) -> dict[str, Any]:
    """Best guesses: the sampler's seed and settings, the text node feeding its positive
    input, the empty latent's size, and the save node."""
    mapping: dict[str, Any] = {"advanced": {}}
    sampler_id = next((nid for nid, n in graph.items() if n["class_type"] in _SAMPLER_NODES), None)
    if sampler_id:
        inputs = graph[sampler_id]["inputs"]
        for seed_field in ("seed", "noise_seed"):
            if seed_field in inputs and not isinstance(inputs[seed_field], list):
                mapping["seed"] = [sampler_id, seed_field]
                break
        positive = inputs.get("positive")
        if isinstance(positive, list) and positive and positive[0] in graph:
            text_node = graph[positive[0]]
            if "text" in text_node["inputs"] and not isinstance(text_node["inputs"]["text"], list):
                mapping["prompt"] = [positive[0], "text"]
    if "prompt" not in mapping:
        text_id = next((nid for nid, n in graph.items() if isinstance(n["inputs"].get("text"), str)), None)
        if text_id:
            mapping["prompt"] = [text_id, "text"]
    latent_id = next((nid for nid, n in graph.items() if "Latent" in n["class_type"] and "width" in n["inputs"] and "height" in n["inputs"]), None)
    if latent_id:
        mapping["width"], mapping["height"] = [latent_id, "width"], [latent_id, "height"]
    output_id = next((nid for nid, n in graph.items() if n["class_type"] in ("SaveImage", "Image Save")), None)
    output_id = output_id or next((nid for nid, n in graph.items() if "Save" in n["class_type"]), None)
    if output_id:
        mapping["output"] = output_id
    for control, names in ADVANCED_FIELDS.items():
        for nid, node in graph.items():
            hit = next((f for f in names if f in node["inputs"] and not isinstance(node["inputs"][f], list)), None)
            if hit and (control != "shift" or "ModelSampling" in node["class_type"]):
                mapping["advanced"][control] = [nid, hit, node["inputs"][hit]]
                break
    return mapping


def check_mapping(graph: dict[str, Any], mapping: dict[str, Any]) -> dict[str, Any]:
    """The mapping must point at real, settable inputs. Returns a clean copy."""
    def field(key: str, ref: Any) -> list[str]:
        if not (isinstance(ref, (list, tuple)) and len(ref) >= 2):
            raise WorkflowError(f"choose the input that holds the {key}")
        node_id, name = str(ref[0]), str(ref[1])
        if node_id not in graph or name not in graph[node_id]["inputs"]:
            raise WorkflowError(f"the {key} input {node_id}.{name} is not in this workflow")
        if isinstance(graph[node_id]["inputs"][name], list):
            raise WorkflowError(f"{node_id}.{name} is wired to another node, so the studio cannot set it")
        return [node_id, name]

    clean: dict[str, Any] = {"prompt": field("prompt", mapping.get("prompt")), "seed": field("seed", mapping.get("seed"))}
    if mapping.get("width") or mapping.get("height"):
        clean["width"], clean["height"] = field("width", mapping.get("width")), field("height", mapping.get("height"))
    output = str(mapping.get("output") or "")
    if output not in graph:
        raise WorkflowError("choose the node that saves the image")
    if "filename_prefix" not in graph[output]["inputs"]:
        raise WorkflowError(f"node {output} ({graph[output]['class_type']}) does not save images; pick a Save Image node")
    clean["output"] = output
    clean["advanced"] = {}
    for control, ref in (mapping.get("advanced") or {}).items():
        if control not in ADVANCED_FIELDS:
            raise WorkflowError(f"unknown control {control!r}")
        node_id, name = field(control, ref)
        clean["advanced"][control] = [node_id, name, graph[node_id]["inputs"][name]]
    return clean


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:40] or "workflow"