"""
Tests for security utilities: password hashing and JWT tokens.
These are pure unit tests — no database or HTTP calls needed.
"""

import uuid

import pytest
from fastapi import HTTPException

from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)


class TestPasswordHashing:
    def test_hash_produces_bcrypt_string(self):
        hashed = hash_password("mypassword123")
        assert hashed.startswith("$2b$")

    def test_verify_correct_password(self):
        hashed = hash_password("mypassword123")
        assert verify_password("mypassword123", hashed) is True

    def test_verify_wrong_password(self):
        hashed = hash_password("mypassword123")
        assert verify_password("wrongpassword", hashed) is False

    def test_different_hashes_for_same_password(self):
        h1 = hash_password("same")
        h2 = hash_password("same")
        assert h1 != h2  # bcrypt uses random salt


class TestJWT:
    def test_access_token_contains_correct_claims(self):
        user_id = str(uuid.uuid4())
        token = create_access_token(user_id, "editor")
        payload = decode_token(token)
        assert payload["sub"] == user_id
        assert payload["role"] == "editor"
        assert payload["type"] == "access"

    def test_refresh_token_contains_correct_claims(self):
        user_id = str(uuid.uuid4())
        token = create_refresh_token(user_id)
        payload = decode_token(token)
        assert payload["sub"] == user_id
        assert payload["type"] == "refresh"
        assert "role" not in payload

    def test_decode_invalid_token_raises(self):
        with pytest.raises(HTTPException) as exc_info:
            decode_token("not.a.valid.token")
        assert exc_info.value.status_code == 401

    def test_access_and_refresh_tokens_differ(self):
        user_id = str(uuid.uuid4())
        access = create_access_token(user_id)
        refresh = create_refresh_token(user_id)
        assert access != refresh

    def test_token_roundtrip(self):
        user_id = str(uuid.uuid4())
        token = create_access_token(user_id, "admin")
        payload = decode_token(token)
        assert payload["sub"] == user_id
        assert payload["role"] == "admin"
