"""Measure the commit classifier against the hand-labeled fixture.

    docker compose exec backend python -m scripts.eval_commit_classifier

Needs a real API key — this is the one place a live LLM call is intentional.
Runs the full production path, rules prefilter included, so the numbers reflect
what the classify endpoint will actually do.

Three gates, and the headline accuracy is the least informative of them:

  * overall accuracy ≥ 85%
  * per-class recall ≥ 75% on BOTH classes, over the LLM-decided subset only.
    The rules catch logistical commits almost exclusively, so the subset the
    model actually decides skews substantive; raw accuracy there is close to
    satisfiable by a constant answer, and recall is not.
  * rules precision = 100%. A rule firing on a commit labeled substantive is a
    bug in the rule, not a prompt miss — rules are cached forever and never
    reviewed.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from app.core.config import settings
from app.services.commit_classifier_service import (
    _EXAMPLES,
    CommitInput,
    build_classifier,
    build_prompt,
    classify_by_rules,
)

DEFAULT_FIXTURE = Path(__file__).resolve().parent.parent / "tests/fixtures/commit_classification_eval.jsonl"

OVERALL_GATE = 0.85
RECALL_GATE = 0.75
CLASSES = ("substantive", "logistical")


@dataclass
class Miss:
    hash: str
    message: str
    diffstat: str
    expected: str
    got: str | None
    source: str
    notes: str


@dataclass
class EvalReport:
    model: str
    total: int = 0
    correct: int = 0
    rule_hits: int = 0
    rule_correct: int = 0
    llm_total: int = 0
    unclassified: int = 0
    # actual -> predicted ("none" for an unclassified commit) -> count
    confusion: dict[str, dict[str, int]] = field(default_factory=dict)
    llm_actual: dict[str, int] = field(default_factory=dict)
    llm_hit: dict[str, int] = field(default_factory=dict)
    misses: list[Miss] = field(default_factory=list)

    @property
    def overall_accuracy(self) -> float:
        return self.correct / self.total if self.total else 0.0

    @property
    def rules_precision(self) -> float:
        return self.rule_correct / self.rule_hits if self.rule_hits else 1.0

    def recall(self, label: str) -> float:
        actual = self.llm_actual.get(label, 0)
        return self.llm_hit.get(label, 0) / actual if actual else 0.0

    @property
    def total_llm_failure(self) -> bool:
        """Every commit that reached the model came back unclassified.

        That is an infrastructure fault — a bad key, an unreachable host — not
        a measurement. Reporting it as an accuracy figure would be reporting a
        number that describes nothing.
        """
        return bool(self.llm_total) and self.unclassified == self.llm_total

    @property
    def passed(self) -> bool:
        return (
            self.overall_accuracy >= OVERALL_GATE
            and all(self.recall(c) >= RECALL_GATE for c in CLASSES)
            and self.rules_precision == 1.0
        )


def load_fixture(path: Path, limit: int | None = None) -> list[dict]:
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    unlabeled = [r["hash"] for r in rows if r.get("expected_type") not in CLASSES]
    if unlabeled:
        raise SystemExit(
            f"{len(unlabeled)} row(s) still unlabeled: {', '.join(unlabeled[:5])}. "
            "Harvested rows must be labeled by hand before they can be evaluated."
        )
    return rows[:limit] if limit else rows


def assert_no_leakage(rows: list[dict]) -> None:
    """Few-shot examples must not appear in the eval set.

    Otherwise the score measures recall of the examples rather than whether the
    rubric generalises, and it does so in the flattering direction.
    """
    def norm(text: str) -> str:
        return " ".join(text.split()).lower()

    example_messages = {norm(m) for m in re.findall(r'"([^"]+)"', _EXAMPLES)}
    overlap = sorted({r["hash"] for r in rows if norm(r["message"]) in example_messages})
    if overlap:
        raise SystemExit(
            f"Few-shot examples overlap the eval fixture: {', '.join(overlap)}. "
            "Reword one side or the accuracy number is self-congratulation."
        )


def _as_input(row: dict) -> CommitInput:
    return CommitInput(
        hash=row["hash"],
        message=row["message"],
        insertions=row["insertions"],
        deletions=row["deletions"],
        files_changed=row["files_changed"],
        file_paths=tuple(row["file_paths"]),
        file_paths_truncated=row["file_paths_truncated"],
        diffstat_available=row["diffstat_available"],
        needs_type=True,
        needs_score=False,  # this eval measures type only
    )


def _diffstat(row: dict) -> str:
    if not row["diffstat_available"]:
        return "no diffstat"
    unit = "file" if row["files_changed"] == 1 else "files"
    return f"+{row['insertions']}/-{row['deletions']} across {row['files_changed']} {unit}"


async def run_eval(
    rows: list[dict],
    provider: str,
    model: str,
    api_key: str | None,
    ollama_url: str | None,
    verbose: bool = False,
) -> EvalReport:
    assert_no_leakage(rows)

    inputs = [_as_input(r) for r in rows]
    if verbose:
        undecided = [i for i, r in zip(inputs, rows) if classify_by_rules(
            r["message"], files_changed=r["files_changed"], insertions=r["insertions"],
            deletions=r["deletions"], file_paths=r["file_paths"],
            file_paths_truncated=r["file_paths_truncated"],
            diffstat_available=r["diffstat_available"]) is None]
        print(build_prompt(undecided[:5]), file=sys.stderr)
        print("─" * 72, file=sys.stderr)

    label = f"ollama/{model}" if provider == "ollama" else model
    report = EvalReport(model=label, total=len(rows))
    report.confusion = {a: {p: 0 for p in (*CLASSES, "none")} for a in CLASSES}

    results = await build_classifier(provider, model, api_key, ollama_url).classify(inputs)

    for row, result in zip(rows, results):
        expected = row["expected_type"]
        got = result.commit_type
        report.confusion[expected][got or "none"] += 1

        if got is None:
            report.unclassified += 1

        if result.source == "rules":
            report.rule_hits += 1
            if got == expected:
                report.rule_correct += 1
        else:
            report.llm_total += 1
            report.llm_actual[expected] = report.llm_actual.get(expected, 0) + 1
            if got == expected:
                report.llm_hit[expected] = report.llm_hit.get(expected, 0) + 1

        if got == expected:
            report.correct += 1
        else:
            report.misses.append(Miss(
                hash=row["hash"], message=row["message"], diffstat=_diffstat(row),
                expected=expected, got=got, source=result.source, notes=row["notes"],
            ))

    return report


def print_report(report: EvalReport) -> None:
    def line(name: str, num: int, den: int, gate: float) -> str:
        pct = num / den if den else 0.0
        verdict = "PASS" if pct >= gate else "FAIL"
        return f"{name:<26}{num:>3}/{den:<3} {pct:>6.1%}   [gate ≥{gate:.0%}]  {verdict}"

    print(f"\nModel: {report.model}    Items: {report.total}    "
          f"Cost: {report.llm_total} LLM / {report.rule_hits} rules\n")

    print(line("Overall accuracy", report.correct, report.total, OVERALL_GATE))
    for cls in CLASSES:
        print(line(
            f"Recall, {cls}",
            report.llm_hit.get(cls, 0), report.llm_actual.get(cls, 0), RECALL_GATE,
        ) + "   (LLM-decided only)")
    print(line("Rules precision", report.rule_correct, report.rule_hits, 1.0))
    if report.unclassified:
        print(f"\n{report.unclassified} commit(s) came back unclassified — an LLM or parse "
              f"failure, counted as wrong above but fixable by rerunning.")

    print("\n                    predicted")
    print(f"{'':<16}{'subs':>7}{'logi':>7}{'none':>7}")
    for actual in CLASSES:
        row = report.confusion[actual]
        name = f"actual {actual[:4]}" if actual == CLASSES[0] else f"       {actual[:4]}"
        print(f"{name:<16}{row['substantive']:>7}{row['logistical']:>7}{row['none']:>7}")

    if report.misses:
        print(f"\nMisclassifications ({len(report.misses)})")
        for miss in report.misses:
            print(f"  ✗ {miss.hash}  expected={miss.expected} got={miss.got or 'none'}  [{miss.source}]")
            print(f"      {miss.message[:76]}")
            print(f"      {miss.diffstat}")
            if miss.notes:
                print(f"      why labeled: {miss.notes[:100]}")
    else:
        print("\nNo misclassifications.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--provider", default="anthropic")
    # Matches the AppSettings default, so the eval measures what production runs.
    parser.add_argument("--model", default=settings.DEFAULT_LLM_MODEL)
    parser.add_argument("--ollama-url", default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--verbose", action="store_true", help="dump a sample prompt to stderr")
    args = parser.parse_args()

    api_key = settings.ANTHROPIC_API_KEY
    if args.provider == "anthropic" and not api_key:
        raise SystemExit("ANTHROPIC_API_KEY is not set — this eval makes real LLM calls.")

    rows = load_fixture(args.fixture, args.limit)
    report = asyncio.run(run_eval(
        rows, args.provider, args.model, api_key, args.ollama_url, args.verbose,
    ))

    if report.total_llm_failure:
        print(
            f"\nAll {report.llm_total} LLM calls failed — see the logged error above.\n"
            f"401 means the key is rejected; 404 means the model id is not available "
            f"to this key (try --model, or list them via client.models.list()).\n"
            f"No accuracy was measured. The rules prefilter still ran:\n"
            f"  Rules precision  {report.rule_correct}/{report.rule_hits} "
            f"({report.rules_precision:.0%}) over {report.rule_hits} rule-decided commits.",
            # flush: without it this can be buffered away entirely under
            # `docker compose exec`, and a silent failure is worse than a loud one.
            file=sys.stderr, flush=True,
        )
        return 2

    print_report(report)
    return 0 if report.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
