from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..db import get_session
from ..models import ComfyWorkflow, ProviderAdapter, ProviderConfig, ProviderKind
from ..providers import comfyui

router = APIRouter(prefix="/api/comfy-workflows", tags=["comfyui workflows"])


def _users(session: Session, name: str) -> list[ProviderConfig]:
    return session.exec(
        select(ProviderConfig).where(ProviderConfig.adapter == ProviderAdapter.comfyui, ProviderConfig.model == name)
    ).all()


def _out(session: Session, row: ComfyWorkflow) -> dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "title": row.title,
        "notes": row.notes,
        "builtin": False,
        "node_count": len(row.graph or {}),
        "mapping": row.mapping,
        "graph": row.graph,
        "used_by": [p.name for p in _users(session, row.name)],
        "created_at": row.created_at,
    }


def _check(graph: Any, mapping: Optional[dict[str, Any]] = None) -> tuple[dict, Optional[dict]]:
    try:
        graph = comfyui.check_graph(graph)
        return graph, comfyui.check_mapping(graph, mapping) if mapping is not None else None
    except comfyui.WorkflowError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("")
def list_workflows(session: Session = Depends(get_session)) -> list[dict[str, Any]]:
    builtin = [
        {
            "id": f"builtin:{name}",
            "name": name,
            "title": "Z-Image Turbo (text to image)" if name == "z_image_turbo" else name,
            "notes": "Built in. Needs z_image_turbo_bf16, qwen_3_4b and ae on the server.",
            "builtin": True,
            "node_count": len(w["graph"]),
            "used_by": [p.name for p in _users(session, name)],
        }
        for name, w in comfyui.WORKFLOWS.items()
    ]
    rows = session.exec(select(ComfyWorkflow).order_by(ComfyWorkflow.created_at)).all()
    return builtin + [_out(session, r) for r in rows]


class AnalyzeIn(BaseModel):
    graph: dict[str, Any]


@router.post("/analyze")
def analyze(body: AnalyzeIn) -> dict[str, Any]:
    """The nodes and settable inputs of an exported workflow, with a suggested mapping."""
    graph, _ = _check(body.graph)
    return {"nodes": comfyui.describe_nodes(graph), "suggested": comfyui.suggest_mapping(graph)}


class WorkflowIn(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    notes: str = Field(default="", max_length=1000)
    graph: dict[str, Any]
    mapping: dict[str, Any]


@router.post("", status_code=201)
def create_workflow(body: WorkflowIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    graph, mapping = _check(body.graph, body.mapping)
    name = comfyui.slug(body.title)
    taken = set(comfyui.workflow_names())
    base, n = name, 2
    while name in taken:
        name = f"{base}_{n}"
        n += 1
    row = ComfyWorkflow(name=name, title=body.title.strip(), notes=body.notes.strip(), graph=graph, mapping=mapping)
    session.add(row)
    session.commit()
    session.refresh(row)
    return _out(session, row)


class WorkflowUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=80)
    notes: Optional[str] = Field(default=None, max_length=1000)
    mapping: Optional[dict[str, Any]] = None


@router.patch("/{workflow_id}")
def update_workflow(workflow_id: str, body: WorkflowUpdate, session: Session = Depends(get_session)) -> dict[str, Any]:
    row = session.get(ComfyWorkflow, workflow_id)
    if row is None:
        raise HTTPException(404, "workflow not found (built-in workflows cannot be edited)")
    if body.mapping is not None:
        _, row.mapping = _check(row.graph, body.mapping)
    if body.title is not None:
        row.title = body.title.strip()  # the name stays: providers refer to it
    if body.notes is not None:
        row.notes = body.notes.strip()
    session.add(row)
    session.commit()
    session.refresh(row)
    return _out(session, row)


@router.delete("/{workflow_id}", status_code=204, response_model=None)
def delete_workflow(workflow_id: str, session: Session = Depends(get_session)) -> None:
    row = session.get(ComfyWorkflow, workflow_id)
    if row is None:
        raise HTTPException(404, "workflow not found")
    users = _users(session, row.name)
    if users:
        raise HTTPException(409, f"used by {', '.join(p.name for p in users)}; remove that model in AI providers first")
    session.delete(row)
    session.commit()


class UseIn(BaseModel):
    base_url: Optional[str] = None


@router.post("/{workflow_id}/use", status_code=201)
def use_in_studio(workflow_id: str, body: UseIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    """Add the workflow to the studio's model list, on the same ComfyUI server as the others."""
    if workflow_id.startswith("builtin:"):
        name, title = workflow_id.split(":", 1)[1], "Z-Image Turbo"
    else:
        row = session.get(ComfyWorkflow, workflow_id)
        if row is None:
            raise HTTPException(404, "workflow not found")
        name, title = row.name, row.title
    base_url = (body.base_url or "").strip()
    if not base_url:
        existing = session.exec(select(ProviderConfig).where(ProviderConfig.adapter == ProviderAdapter.comfyui)).first()
        if existing is None or not existing.base_url:
            raise HTTPException(400, "no ComfyUI server known yet; give its address, e.g. http://host:8188")
        base_url = existing.base_url
    cfg = ProviderConfig(name=f"ComfyUI · {title}", kind=ProviderKind.image, adapter=ProviderAdapter.comfyui, base_url=base_url, model=name)
    session.add(cfg)
    session.commit()
    session.refresh(cfg)
    return {"provider_id": cfg.id, "name": cfg.name, "model": name, "base_url": base_url}
