from __future__ import annotations

import io
import random
import shutil
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from PIL import Image, ImageDraw, ImageFont

from ..config import DATA_DIR
from .base import (
    Bounds,
    DeviceDriver,
    DeviceError,
    DeviceInfo,
    ScreenState,
    TapResult,
    UiNode,
)
from .targets import resolve_or_raise

SIM_DIR = DATA_DIR / "simulator"
SIM_DIR.mkdir(parents=True, exist_ok=True)

W, H = 1080, 2160
IG_PKG = "com.instagram.android"
X_PKG = "com.twitter.android"

INK = (20, 23, 28)
MUTED = (120, 132, 148)
LINE = (224, 229, 236)
PAPER = (255, 255, 255)
ACCENT = (13, 125, 134)


def _font(size: int, bold: bool = False):
    for name in (("seguisb.ttf", "arialbd.ttf") if bold else ("segoeui.ttf", "arial.ttf")):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


@dataclass
class _Node:
    rid: str = ""
    text: str = ""
    desc: str = ""
    cls: str = "android.widget.TextView"
    clickable: bool = True
    box: tuple[int, int, int, int] = (0, 0, 0, 0)

    def to_ui(self, pkg: str) -> UiNode:
        return UiNode(
            resource_id=f"{pkg}:id/{self.rid}" if self.rid else "",
            text=self.text,
            content_desc=self.desc,
            cls=self.cls,
            package=pkg,
            clickable=self.clickable,
            bounds=Bounds(*self.box),
        )


@dataclass
class _PublishedPost:
    platform: str
    caption: str
    media: Optional[str]
    url: str
    at: float = field(default_factory=time.time)


class VirtualPhone:
    """A fake Android phone that renders real screenshots and accepts the same
    named-target taps as a physical device.

    It exists so the whole pipeline — scheduling, device booking, the posting
    recipe, evidence capture, retry and recovery — can be exercised and demoed
    without hardware. Recipes do not know which driver they are talking to.
    """

    def __init__(self, serial: str, options: Optional[dict[str, Any]] = None):
        self.serial = serial
        self.options = options or {}
        self.screen = "home"
        self.package = ""
        self.gallery: list[str] = []
        self.selected_media: Optional[str] = None
        self.compose_caption = ""
        self.published: list[_PublishedPost] = []
        self.viewing: Optional[_PublishedPost] = None
        self.keyboard_open = False
        # Exercise the recovery path: fail this many publish attempts first.
        self.fail_next = int(self.options.get("fail_first_attempts", 0) or 0)
        self._rng = random.Random(serial)

    # ------------------------------------------------------------------
    # screens: each returns the node list; render() draws the same thing
    # ------------------------------------------------------------------

    def nodes(self) -> list[_Node]:
        fn = getattr(self, f"_nodes_{self.screen}", None)
        if fn is None:
            raise DeviceError(f"simulator has no screen {self.screen!r}")
        return fn()

    def _nodes_home(self) -> list[_Node]:
        return [
            _Node(rid="ig_icon", desc="Instagram", text="Instagram", box=(120, 700, 420, 1000)),
            _Node(rid="x_icon", desc="X", text="X", box=(620, 700, 920, 1000)),
        ]

    # ---- Instagram ----

    def _nodes_ig_feed(self) -> list[_Node]:
        return [
            _Node(rid="tab_feed", desc="Home", box=(40, 1960, 220, 2100)),
            _Node(rid="tab_new_post", desc="New post", box=(450, 1960, 630, 2100)),
            _Node(rid="tab_avatar", desc="Profile", box=(860, 1960, 1040, 2100)),
        ]

    def _nodes_ig_gallery(self) -> list[_Node]:
        nodes = [
            _Node(rid="post_type_post", text="POST", box=(360, 1900, 560, 2000)),
            _Node(rid="post_type_reel", text="REEL", box=(600, 1900, 800, 2000)),
            _Node(rid="next_button_textview", text="Next", box=(840, 120, 1040, 240)),
        ]
        for i in range(9):
            r, c = divmod(i, 3)
            x0, y0 = 20 + c * 353, 1000 + r * 290
            nodes.append(
                _Node(
                    rid="gallery_grid_item",
                    desc=f"Photo thumbnail {i + 1}",
                    cls="android.widget.ImageView",
                    box=(x0, y0, x0 + 340, y0 + 280),
                )
            )
        return nodes

    def _nodes_ig_caption(self) -> list[_Node]:
        return [
            _Node(
                rid="caption_text_view",
                text=self.compose_caption or "Write a caption...",
                cls="android.widget.EditText",
                box=(260, 300, 1040, 700),
            ),
            _Node(rid="share_footer_button", text="Share", box=(40, 1900, 1040, 2030)),
        ]

    def _nodes_ig_shared(self) -> list[_Node]:
        return [
            _Node(rid="tab_feed", desc="Home", box=(40, 1960, 220, 2100)),
            _Node(rid="tab_avatar", desc="Profile", box=(860, 1960, 1040, 2100)),
            _Node(rid="shared_banner", text="Your post has been shared", clickable=False,
                  box=(60, 300, 1020, 420)),
        ]

    def _nodes_ig_profile(self) -> list[_Node]:
        nodes = [
            _Node(rid="tab_feed", desc="Home", box=(40, 1960, 220, 2100)),
            _Node(rid="tab_avatar", desc="Profile", box=(860, 1960, 1040, 2100)),
        ]
        for i, _ in enumerate(reversed(self.published[-9:])):
            r, c = divmod(i, 3)
            x0, y0 = 20 + c * 353, 760 + r * 290
            nodes.append(
                _Node(
                    rid="image_button",
                    desc="Post thumbnail",
                    cls="android.widget.ImageView",
                    box=(x0, y0, x0 + 340, y0 + 280),
                )
            )
        return nodes

    def _nodes_ig_post_detail(self) -> list[_Node]:
        post = self.viewing
        return [
            _Node(rid="media", desc="Post photo", cls="android.widget.ImageView",
                  box=(0, 260, W, 1340)),
            _Node(rid="caption", text=post.caption if post else "", clickable=False,
                  cls="android.widget.TextView", box=(40, 1380, 1040, 1800)),
            _Node(rid="tab_avatar", desc="Profile", box=(860, 1960, 1040, 2100)),
        ]

    # ---- X ----

    def _nodes_x_timeline(self) -> list[_Node]:
        return [
            _Node(rid="composer_write", desc="Post", box=(820, 1780, 1020, 1960)),
            _Node(rid="profile", desc="Profile", box=(40, 1980, 220, 2110)),
        ]

    def _nodes_x_composer(self) -> list[_Node]:
        return [
            _Node(
                rid="tweet_text",
                text=self.compose_caption or "What's happening?",
                cls="android.widget.EditText",
                box=(60, 300, 1020, 760),
            ),
            _Node(rid="gallery", desc="Add photos or video", box=(60, 1880, 220, 2010)),
            _Node(rid="button_tweet", text="Post", box=(820, 120, 1040, 240)),
        ]

    def _nodes_x_gallery(self) -> list[_Node]:
        nodes = [_Node(rid="button_add", text="Add", box=(820, 120, 1040, 240))]
        for i in range(6):
            r, c = divmod(i, 3)
            x0, y0 = 20 + c * 353, 400 + r * 290
            nodes.append(
                _Node(
                    rid="image",
                    desc=f"Photo {i + 1}",
                    cls="android.widget.ImageView",
                    box=(x0, y0, x0 + 340, y0 + 280),
                )
            )
        return nodes

    def _nodes_x_posted(self) -> list[_Node]:
        return [
            _Node(rid="composer_write", desc="Post", box=(820, 1780, 1020, 1960)),
            _Node(rid="profile", desc="Profile", box=(40, 1980, 220, 2110)),
            _Node(rid="row", desc="Your post", cls="android.view.ViewGroup",
                  box=(40, 320, 1040, 900)),
        ]

    def _nodes_x_profile(self) -> list[_Node]:
        nodes = [_Node(rid="composer_write", desc="Post", box=(820, 1780, 1020, 1960))]
        for i, post in enumerate(reversed([p for p in self.published if p.platform == "x"][-5:])):
            y0 = 620 + i * 260
            # The post text is on the timeline itself, exactly as on the real
            # app, which is what lets verification read our own words back.
            nodes.append(
                _Node(rid="row", text=post.caption[:200], desc="Post",
                      cls="android.view.ViewGroup", box=(40, y0, 1040, y0 + 240))
            )
        return nodes

    # ------------------------------------------------------------------
    # interaction
    # ------------------------------------------------------------------

    def tap_node(self, node: _Node) -> None:
        rid, screen = node.rid, self.screen

        if screen == "home":
            if rid == "ig_icon":
                self.open_app(IG_PKG)
            elif rid == "x_icon":
                self.open_app(X_PKG)
            return

        if rid in ("tab_feed",):
            self.screen = "ig_feed"
        elif rid == "tab_new_post":
            self.screen = "ig_gallery"
            self.selected_media = None
        elif rid == "gallery_grid_item":
            self.selected_media = self.gallery[-1] if self.gallery else "camera-roll-item"
        elif rid == "next_button_textview":
            if not self.selected_media:
                # Instagram will not advance without a selection; staying put is
                # the honest behaviour and the recipe must cope with it.
                return
            self.screen = "ig_caption"
        elif rid == "share_footer_button":
            self._commit_publish("instagram")
        elif rid == "tab_avatar":
            self.screen = "ig_profile"
        elif rid == "image_button":
            ig = [p for p in self.published if p.platform == "instagram"]
            if ig:
                self.viewing = ig[-1]
                self.screen = "ig_post_detail"
        elif rid == "composer_write":
            self.screen = "x_composer"
            self.compose_caption = ""
            self.selected_media = None
        elif rid == "gallery":
            self.screen = "x_gallery"
        elif rid == "image":
            self.selected_media = self.gallery[-1] if self.gallery else "camera-roll-item"
        elif rid == "button_add":
            self.screen = "x_composer"
        elif rid == "button_tweet":
            self._commit_publish("x")
        elif rid == "profile":
            self.screen = "x_profile"
        elif rid in ("caption_text_view", "tweet_text"):
            self.keyboard_open = True

    def _commit_publish(self, platform: str) -> None:
        if self.fail_next > 0:
            # Mimic the realistic failure: the tap lands, the upload stalls and
            # the app drops back to the composer with nothing posted.
            self.fail_next -= 1
            self.screen = "ig_caption" if platform == "instagram" else "x_composer"
            raise DeviceError("upload failed on device (simulated transient failure)")
        handle = self.options.get("handle", "test-account")
        post_id = uuid.uuid4().hex[:11]
        url = (
            f"https://instagram.com/p/{post_id}"
            if platform == "instagram"
            else f"https://x.com/{handle}/status/{self._rng.randint(10**18, 10**19 - 1)}"
        )
        self.published.append(
            _PublishedPost(platform, self.compose_caption, self.selected_media, url)
        )
        self.screen = "ig_shared" if platform == "instagram" else "x_posted"
        self.compose_caption = ""
        self.selected_media = None
        self.keyboard_open = False

    def open_app(self, package: str) -> None:
        self.package = package
        if package == IG_PKG:
            self.screen = "ig_feed"
        elif package == X_PKG:
            self.screen = "x_timeline"
        else:
            raise DeviceError(f"simulator has no app {package!r} installed")

    def stop_app(self, package: str) -> None:
        if self.package == package:
            self.package = ""
            self.screen = "home"

    def type_text(self, text: str) -> None:
        self.compose_caption = (self.compose_caption + text).strip()

    def back(self) -> None:
        # Android dismisses the keyboard first and only navigates on a second
        # press. A recipe closing the keyboard to reach Share depends on this.
        if self.keyboard_open:
            self.keyboard_open = False
            return
        order = {
            "ig_gallery": "ig_feed",
            "ig_caption": "ig_gallery",
            "ig_shared": "ig_feed",
            "ig_profile": "ig_feed",
            "ig_post_detail": "ig_profile",
            "x_composer": "x_timeline",
            "x_gallery": "x_composer",
            "x_posted": "x_timeline",
            "x_profile": "x_timeline",
        }
        self.screen = order.get(self.screen, "home")

    # ------------------------------------------------------------------
    # rendering
    # ------------------------------------------------------------------

    def render(self) -> bytes:
        img = Image.new("RGB", (W, H), PAPER)
        d = ImageDraw.Draw(img)
        self._draw_status_bar(d)
        title = {
            "home": "Android",
            "ig_feed": "Instagram",
            "ig_gallery": "New post",
            "ig_caption": "New post",
            "ig_shared": "Instagram",
            "ig_profile": "Profile",
            "ig_post_detail": "Post",
            "x_timeline": "X",
            "x_composer": "Compose",
            "x_gallery": "Photos",
            "x_posted": "X",
            "x_profile": "Profile",
        }.get(self.screen, self.screen)
        d.text((40, 120), title, font=_font(52, True), fill=INK)
        d.line((0, 230, W, 230), fill=LINE, width=2)

        if self.screen == "ig_caption":
            self._draw_thumb(img, (40, 300, 230, 490))
            d.multiline_text(
                (260, 320),
                _wrap(self.compose_caption or "Write a caption...", 34),
                font=_font(36),
                fill=INK if self.compose_caption else MUTED,
                spacing=12,
            )
        elif self.screen == "x_composer":
            d.multiline_text(
                (70, 320),
                _wrap(self.compose_caption or "What's happening?", 36),
                font=_font(38),
                fill=INK if self.compose_caption else MUTED,
                spacing=12,
            )
            if self.selected_media:
                self._draw_thumb(img, (70, 800, 560, 1290))
        elif self.screen == "ig_post_detail" and self.viewing:
            d.multiline_text(
                (40, 1380), _wrap(self.viewing.caption, 38), font=_font(34), fill=INK, spacing=10
            )
            d.text((40, 1820), self.viewing.url, font=_font(26), fill=MUTED)
        elif self.screen in ("ig_shared", "x_posted"):
            latest = self.published[-1] if self.published else None
            d.rectangle((60, 290, 1020, 420), fill=(224, 243, 244))
            d.text((90, 325), "Posted", font=_font(44, True), fill=ACCENT)
            if latest:
                d.multiline_text(
                    (60, 470), _wrap(latest.caption, 38), font=_font(34), fill=INK, spacing=10
                )
                d.text((60, 760), latest.url, font=_font(26), fill=MUTED)
                self._draw_thumb(img, (60, 820, 560, 1320))

        for node in self.nodes():
            self._draw_node(img, d, node)

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    def _draw_status_bar(self, d: ImageDraw.ImageDraw) -> None:
        d.rectangle((0, 0, W, 70), fill=(243, 245, 248))
        d.text((40, 18), time.strftime("%H:%M"), font=_font(32, True), fill=INK)
        d.text((W - 260, 18), "sim · 4G · 87%", font=_font(28), fill=MUTED)

    def _draw_thumb(self, img: Image.Image, box: tuple[int, int, int, int]) -> None:
        path = self.gallery[-1] if self.gallery else None
        if path and Path(path).exists() and Path(path).suffix.lower() in (".png", ".jpg", ".jpeg"):
            try:
                thumb = Image.open(path).convert("RGB")
                thumb = thumb.resize((box[2] - box[0], box[3] - box[1]))
                img.paste(thumb, (box[0], box[1]))
                return
            except OSError:
                pass
        d = ImageDraw.Draw(img)
        d.rectangle(box, fill=(232, 236, 242), outline=LINE, width=2)
        label = "video" if (path or "").endswith(".mp4") else "media"
        d.text((box[0] + 20, box[1] + 20), label, font=_font(28), fill=MUTED)

    def _draw_node(self, img: Image.Image, d: ImageDraw.ImageDraw, node: _Node) -> None:
        x0, y0, x1, y1 = node.box
        if node.cls.endswith("ImageView"):
            self._draw_thumb(img, node.box)
            return
        if node.rid in ("share_footer_button", "button_tweet", "next_button_textview", "button_add"):
            d.rounded_rectangle(node.box, radius=18, fill=ACCENT)
            _centered(d, node.box, node.text or node.desc, _font(36, True), PAPER)
            return
        if node.cls == "android.widget.EditText":
            d.rounded_rectangle(node.box, radius=14, outline=LINE, width=3)
            return
        if not node.clickable:
            return
        d.rounded_rectangle(node.box, radius=14, fill=(240, 243, 247), outline=LINE, width=2)
        _centered(d, node.box, node.desc or node.text, _font(26), MUTED)


def _centered(d, box, text, font, fill):
    if not text:
        return
    x0, y0, x1, y1 = box
    try:
        l, t, r, b = d.textbbox((0, 0), text, font=font)
    except Exception:
        return
    d.text((x0 + (x1 - x0 - (r - l)) / 2, y0 + (y1 - y0 - (b - t)) / 2), text, font=font, fill=fill)


def _wrap(text: str, width: int) -> str:
    import textwrap

    return "\n".join(textwrap.wrap(text, width=width)[:10]) or text


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------

_PHONES: dict[str, VirtualPhone] = {}


def get_phone(serial: str, options: Optional[dict[str, Any]] = None) -> VirtualPhone:
    phone = _PHONES.get(serial)
    if phone is None:
        phone = VirtualPhone(serial, options)
        _PHONES[serial] = phone
    elif options:
        # `fail_next` is deliberately not reset here: it is a budget for the
        # phone's lifetime, so the retry that follows a seeded failure succeeds.
        phone.options.update(options)
    return phone


class SimulatorDriver(DeviceDriver):
    kind = "simulator"

    def __init__(self, serial: str, options: Optional[dict[str, Any]] = None):
        self.serial = serial or "sim-1"
        self.phone = get_phone(self.serial, options)

    def info(self) -> DeviceInfo:
        return DeviceInfo(
            serial=self.serial,
            model="Virtual Pixel (simulator)",
            android="14",
            width=W,
            height=H,
            online=True,
            driver="simulator",
        )

    def screenshot(self) -> bytes:
        return self.phone.render()

    def screen_state(self) -> ScreenState:
        pkg = self.phone.package or "android"
        return ScreenState(
            package=pkg,
            activity=self.phone.screen,
            nodes=[n.to_ui(pkg) for n in self.phone.nodes()],
        )

    def tap(self, target: str) -> TapResult:
        state = self.screen_state()
        ui = resolve_or_raise(target, state.nodes)
        x, y = ui.bounds.random_point()
        box = (ui.bounds.left, ui.bounds.top, ui.bounds.right, ui.bounds.bottom)
        match = next((n for n in self.phone.nodes() if n.box == box), None)
        time.sleep(0.12)
        if match:
            self.phone.tap_node(match)
        return TapResult(target=target, x=x, y=y, matched=ui.resource_id or ui.text, bounds=ui.bounds)

    def type_text(self, text: str) -> str:
        time.sleep(0.1)
        self.phone.type_text(text)
        return text

    def key(self, keycode: str) -> None:
        if keycode.upper() in ("KEYCODE_BACK", "BACK", "4"):
            self.phone.back()

    def swipe(self, direction: str, distance: float = 0.6) -> None:
        time.sleep(0.08)

    def push_media(self, local_path: str) -> str:
        src = Path(local_path)
        if not src.exists():
            raise DeviceError(f"media not found: {local_path}")
        dest = SIM_DIR / f"{self.serial}_{uuid.uuid4().hex[:8]}{src.suffix}"
        shutil.copyfile(src, dest)
        self.phone.gallery.append(str(dest))
        return str(dest)

    def app_start(self, package: str) -> None:
        time.sleep(0.2)
        self.phone.open_app(package)

    def app_stop(self, package: str) -> None:
        self.phone.stop_app(package)

    def current_package(self) -> str:
        return self.phone.package

    def published_urls(self) -> list[str]:
        return [p.url for p in self.phone.published]
