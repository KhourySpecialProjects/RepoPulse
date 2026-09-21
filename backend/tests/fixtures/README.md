# commit_classification_eval.jsonl

The labeled set the commit classifier's prompt is measured against. 62 rows,
one JSON object per line.

## Provenance

| Source | Rows | Notes |
|---|---|---|
| `repopulse` | 50 | Every commit in this repo's history (`git log --all`), harvested by `scripts/harvest_eval_commits.py`. Real messages, real diffstats, real paths. |
| `hand-authored` | 12 | Edge cases the repo's history does not contain. |

There are no rows from student repositories: `seed-repos/` held no git history
when the fixture was built. That is the fixture's main weakness — every real row
comes from one team's commit idiom. Add student-repo rows when clones exist.

Twelve of the fifty real commits are merges, which every rule catches
immediately. That is why the eval reports an LLM-only figure separately;
rule-covered rows would otherwise inflate the headline number.

## The hand-authored rows

Six cover the ambiguous middle (a large docs-only change, a worthless message
over real work, a one-line bug fix, project paperwork, a behaviour-asserting
test, a bare dependency bump).

The other six exist to fix a class imbalance. The rules prefilter catches
logistical commits almost exclusively, so removing rule-covered rows left the
LLM deciding 32 substantive against 8 logistical — a split where answering
"substantive" every time scores 80%, which was the proposed gate. Rows
`edge007`–`edge012` are logistical commits that deliberately evade every rule
(`.png` assets, a version bump touching a `.py`, CI config with no `ci:` prefix,
typo fixes in source, `.env.example`, commented-out code removal). The LLM
subset is now 32/14, and the gate is stated per class rather than as raw
accuracy — see PLAN-M2.md §11.

**These rows must stay disjoint from the few-shot examples in
`_EXAMPLES` (`app/services/commit_classifier_service.py`).** Examples drawn from
the eval set measure recall of the examples, not the rubric. Two shapes were
deliberately avoided here because the prompt already teaches them: a formatter
run across the frontend, and a dependency bump that adapts call sites.
`eval_commit_classifier.py` asserts the disjointness.

## Labeling protocol

Labels come from message, diffstat, and paths only — the same evidence the model
gets. Do not open the diff to decide.

`notes` is mandatory on any row a reasonable person could label either way, and
records *why* the label is what it is. Ten rows carry a `REVIEW:` prefix,
marking calls that could defensibly go the other way; those are the rows to
argue with first when the prompt disagrees with the fixture.

Consistency decisions worth knowing:

- **UI work splits on interaction, not on line count.** Rearranging or removing
  existing UI is tidying and therefore logistical (`3c8e220`, decluttering a top
  bar). Adding or changing an interaction is substantive (`30ccb28`, wrapping a
  long commit list in a scroll container; `85b902f`, introducing SidebarContext).
  A visual bug fix is a fix (`a4a338f`). Pure formatting stays logistical.
- **Repairing a broken test suite is substantive** (`60ff9a7`), even though it
  touches conftest, CI and database setup rather than assertions. Tests that
  assert product behaviour are substantive too (`edge005`).
- **Reverts are logistical.** They change behaviour by undoing it, but advance
  nothing toward completion.
- **Small diffs are judged on effect, not size.** A two-line navigation change
  and a one-line deleted assignment are both substantive.

## Regenerating

`scripts/harvest_eval_commits.py` re-harvests the raw rows, always with
`expected_type: null`. It never guesses a label — a fixture labeled by
heuristics measures the heuristics, and one labeled by a model measures
agreement with that model. Re-harvesting discards the labels in this file, so
merge by hash rather than overwriting.
