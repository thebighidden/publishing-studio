from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from enum import Enum

from pydantic_core import PydanticUndefined
from sqlalchemy import event, inspect, text
from sqlmodel import Session, SQLModel, create_engine

from .config import DB_PATH

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False, "timeout": 30},
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _record):
    cur = dbapi_conn.cursor()
    # WAL so the scheduler thread writing run steps never blocks API reads.
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA busy_timeout=30000")
    cur.close()


def init_db() -> None:
    from . import models  # noqa: F401  (registers tables)

    SQLModel.metadata.create_all(engine)
    _add_missing_columns()


def _add_missing_columns() -> None:
    """create_all makes new tables but never new columns on existing ones. Add
    any column a model has gained since this database was created, filled with
    the model's default, so an existing studio keeps its data."""
    defaults = {
        mapper.class_.__tablename__: mapper.class_.model_fields
        for mapper in SQLModel._sa_registry.mappers
        if hasattr(mapper.class_, "model_fields")
    }
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing:
                    continue
                ddl_type = column.type.compile(dialect=engine.dialect)
                conn.exec_driver_sql(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {ddl_type}')
                value = _default_value(defaults.get(table.name, {}).get(column.name))
                if value is not None:
                    conn.execute(
                        text(f'UPDATE "{table.name}" SET "{column.name}" = :v WHERE "{column.name}" IS NULL'),
                        {"v": value},
                    )


def _default_value(field) -> object:
    if field is None:
        return None
    if field.default_factory is not None:
        value = field.default_factory()
    elif field.default is PydanticUndefined:
        return None
    else:
        value = field.default
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    if isinstance(value, Enum):
        return value.name
    return value


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


@contextmanager
def session_scope() -> Iterator[Session]:
    """For background workers, which have no request to hang a dependency on."""
    session = Session(engine)
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
