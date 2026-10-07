from __future__ import annotations

from sqlmodel import select

from .db import session_scope
from .models import (
    Account,
    Autonomy,
    DriverKind,
    Phone,
    Platform,
    ProviderAdapter,
    ProviderConfig,
    ProviderKind,
)


def seed_if_empty() -> None:
    """A first run should be usable immediately: two simulated phones, two test
    accounts and offline providers. Nothing here touches the network."""
    with session_scope() as s:
        if s.exec(select(ProviderConfig)).first() is None:
            for kind in (ProviderKind.text, ProviderKind.image, ProviderKind.video):
                s.add(
                    ProviderConfig(
                        name=f"Simulated {kind.value}",
                        kind=kind,
                        adapter=ProviderAdapter.simulated,
                        enabled=True,
                        is_default=True,
                    )
                )

        if s.exec(select(Phone)).first() is not None:
            return

        ig_phone = Phone(
            name="Sim phone A",
            driver=DriverKind.simulator,
            serial="sim-a",
            model_name="Virtual Pixel (simulator)",
            android_version="14",
            screen_w=1080,
            screen_h=2160,
            online=True,
            options={"handle": "studio.test"},
        )
        x_phone = Phone(
            name="Sim phone B",
            driver=DriverKind.simulator,
            serial="sim-b",
            model_name="Virtual Pixel (simulator)",
            android_version="14",
            screen_w=1080,
            screen_h=2160,
            online=True,
            # Fails its first publish so the retry and recovery path is visible
            # without having to break anything by hand.
            options={"handle": "studio_test", "fail_first_attempts": 1},
        )
        s.add(ig_phone)
        s.add(x_phone)
        s.flush()

        s.add(
            Account(
                platform=Platform.instagram,
                handle="studio.test",
                phone_id=ig_phone.id,
                autonomy=Autonomy.manual,
                logged_in=True,
                editorial_profile={
                    "tone": "warm, concrete, a little dry",
                    "topics": "product updates, the people who build it",
                    "style": "short sentences, no exclamation marks, no emoji",
                },
                liked_examples=[
                    "We replaced the coffee machine. The old one survived four years and "
                    "roughly nine thousand cups.",
                ],
            )
        )
        s.add(
            Account(
                platform=Platform.x,
                handle="studio_test",
                phone_id=x_phone.id,
                autonomy=Autonomy.manual,
                logged_in=True,
                editorial_profile={
                    "tone": "terse, factual",
                    "topics": "shipping notes, engineering detail",
                    "style": "one idea per post, under 280 characters",
                },
            )
        )
