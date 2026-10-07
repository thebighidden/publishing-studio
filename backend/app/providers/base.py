from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional


class ProviderError(RuntimeError):
    """A provider call failed in a way the operator can act on."""

    def __init__(self, message: str, *, retryable: bool = False, status: int | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.status = status


class NotConfigured(ProviderError):
    pass


@dataclass
class TextResult:
    text: str
    model: str = ""
    cost: float = 0.0
    tokens_in: int = 0
    tokens_out: int = 0


@dataclass
class MediaResult:
    data: bytes
    ext: str  # ".png" / ".mp4"
    mime: str
    model: str = ""
    cost: float = 0.0
    width: Optional[int] = None
    height: Optional[int] = None
    duration_s: Optional[float] = None
    meta: dict[str, Any] = field(default_factory=dict)


ASPECTS: dict[str, tuple[int, int]] = {
    "1:1": (1024, 1024),
    "4:5": (1024, 1280),
    "9:16": (1024, 1820),
    "16:9": (1820, 1024),
}


def aspect_size(aspect: str) -> tuple[int, int]:
    return ASPECTS.get(aspect, ASPECTS["1:1"])


class TextProvider(ABC):
    name = "text"

    @abstractmethod
    def complete(
        self,
        prompt: str,
        *,
        system: str = "",
        json_object: bool = False,
        max_tokens: int = 1200,
        temperature: float = 0.7,
    ) -> TextResult: ...

    @abstractmethod
    def check(self) -> str:
        """Round-trip the real endpoint. Returns a human-readable detail."""


class ImageProvider(ABC):
    name = "image"

    @abstractmethod
    def generate(self, prompt: str, *, aspect: str = "1:1", seed: int | None = None) -> MediaResult: ...

    @abstractmethod
    def check(self) -> str: ...


class VideoProvider(ABC):
    name = "video"

    @abstractmethod
    def generate(
        self,
        prompt: str,
        *,
        aspect: str = "9:16",
        duration_s: float = 5.0,
        image: bytes | None = None,
    ) -> MediaResult: ...

    @abstractmethod
    def check(self) -> str: ...
