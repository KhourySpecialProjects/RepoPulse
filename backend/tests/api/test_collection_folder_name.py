"""local_folder_name is concatenated into the clone path under REPO_ROOT_DIR,
so it must stay a single plain folder name."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.collections import CollectionCreate, CollectionUpdate


@pytest.mark.parametrize("name", ["cs101-fall", "repo_test", "cs101.fall", "CS101"])
def test_accepts_plain_folder_names(name: str) -> None:
    assert CollectionCreate(name="X", local_folder_name=name).local_folder_name == name


@pytest.mark.parametrize("name", ["../../etc", "..", ".", ".hidden", "a/b", "a\\b", ""])
def test_rejects_names_that_escape_the_repo_root(name: str) -> None:
    with pytest.raises(ValidationError):
        CollectionCreate(name="X", local_folder_name=name)


def test_update_rejects_traversal_too() -> None:
    with pytest.raises(ValidationError):
        CollectionUpdate(local_folder_name="../..")


def test_update_allows_omitting_the_field() -> None:
    assert CollectionUpdate(name="Renamed").local_folder_name is None
