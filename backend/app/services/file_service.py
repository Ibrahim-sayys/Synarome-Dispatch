from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.config import settings


UPLOAD_DIR = Path(settings.UPLOAD_DIR)


def ensure_upload_directory():
    UPLOAD_DIR.mkdir(
        parents=True,
        exist_ok=True
    )


def save_upload_file(upload_file: UploadFile) -> Path:
    ensure_upload_directory()

    suffix = Path(upload_file.filename or "").suffix
    safe_filename = f"{uuid4().hex}{suffix}"
    destination = UPLOAD_DIR / safe_filename

    with destination.open("wb") as output:
        while chunk := upload_file.file.read(1024 * 1024):
            output.write(chunk)

    return destination
