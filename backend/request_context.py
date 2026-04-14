"""Per-request context for workflow runs (owner + resolved Gemini key)."""

from contextvars import ContextVar
from dataclasses import dataclass


@dataclass
class RunContext:
    owner_uid: str | None = None
    gemini_user_key: str | None = None


_run_ctx: ContextVar[RunContext | None] = ContextVar('run_ctx', default=None)


def get_run_context() -> RunContext | None:
    return _run_ctx.get()


def set_run_context(ctx: RunContext):
    return _run_ctx.set(ctx)


def reset_run_context(token) -> None:
    _run_ctx.reset(token)
