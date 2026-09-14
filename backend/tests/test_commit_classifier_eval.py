"""The accuracy gate for the commit classifier prompt.

Deselected by default (pytest.ini sets `-m "not llm"`) because it makes real
API calls. Run it deliberately:

    docker compose exec backend pytest -m llm -v

The leakage check below is *not* marked llm — it is pure string comparison, and
it guards the thing that would quietly invalidate every number this file
produces, so it runs on every ordinary test run.
"""
from __future__ import annotations

import pytest

from app.core.config import settings
from scripts.eval_commit_classifier import (
    DEFAULT_FIXTURE,
    OVERALL_GATE,
    RECALL_GATE,
    assert_no_leakage,
    load_fixture,
    print_report,
    run_eval,
)


def test_few_shot_examples_are_disjoint_from_the_eval_set() -> None:
    """Examples drawn from the fixture would measure recall of the examples."""
    assert_no_leakage(load_fixture(DEFAULT_FIXTURE))


def test_every_fixture_row_is_labeled() -> None:
    """load_fixture refuses unlabeled rows; this pins that the file is ready."""
    rows = load_fixture(DEFAULT_FIXTURE)
    assert len(rows) >= 50
    assert all(row["notes"] for row in rows), "every row needs a why"


@pytest.mark.llm
async def test_classifier_meets_accuracy_gates() -> None:
    if not settings.ANTHROPIC_API_KEY:
        pytest.skip("ANTHROPIC_API_KEY not set")

    rows = load_fixture(DEFAULT_FIXTURE)
    report = await run_eval(
        rows,
        provider="anthropic",
        model=settings.DEFAULT_LLM_MODEL,
        api_key=settings.ANTHROPIC_API_KEY,
        ollama_url=None,
    )
    assert not report.total_llm_failure, (
        "every LLM call failed — check the API key; this is not a prompt result"
    )
    print_report(report)

    assert report.rules_precision == 1.0, "a rule fired on a substantive commit"
    assert report.overall_accuracy >= OVERALL_GATE
    for label in ("substantive", "logistical"):
        assert report.recall(label) >= RECALL_GATE, f"{label} recall below gate"
