from __future__ import annotations

import copy
import random
import time
from typing import Any, Optional

import httpx

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
    },
}


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
        if self.model not in WORKFLOWS:
            raise NotConfigured(f"unknown ComfyUI workflow '{self.model}'; known: {', '.join(WORKFLOWS)}")
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
    ) -> MediaResult:
        if image is not None:
            raise ProviderError(f"the ComfyUI workflow {self.model} is text-to-image only; remove the reference image")

        workflow = WORKFLOWS[self.model]
        width, height = (_multiple_of_16(v) for v in aspect_size(aspect))
        seed = seed if seed is not None else random.randint(0, 2**32 - 1)
        graph = copy.deepcopy(workflow["graph"])
        for key, value in (("prompt", prompt), ("seed", seed), ("width", width), ("height", height)):
            node, field = workflow[key]
            graph[node]["inputs"][field] = value
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

        return MediaResult(
            data=dl.content,
            ext=".png",
            mime="image/png",
            model=self.model,
            width=width,
            height=height,
            meta={"seed": seed, "comfyui_prompt_id": prompt_id},
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
        unet = WORKFLOWS[self.model]["unet"]
        if unet not in installed:
            raise ProviderError(f"reachable ({detail}), but {unet} is not installed in models/diffusion_models")
        return f"reachable; {detail}; {unet} installed"
