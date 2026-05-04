"""Logout URL construction must not assume optional env vars (production logout 500s)."""

import pytest


def test_build_logout_url_returns_none_without_issuer(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OIDC_ISSUER_URL", raising=False)
    from core.auth import build_logout_url

    assert build_logout_url() is None


def test_safe_post_logout_redirect_uri_always_absolute_callback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FRONTEND_URL", raising=False)
    monkeypatch.delenv("FRONTEND_ORIGIN", raising=False)
    from core.auth import safe_post_logout_redirect_uri

    uri = safe_post_logout_redirect_uri()
    assert uri.endswith("/logout-callback")
    assert uri.startswith("http")
