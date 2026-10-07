from pathlib import Path

from app.config import settings


UPLOAD_DIR = Path(settings.UPLOAD_DIR)


def ensure_upload_directory():
    UPLOAD_DIR.mkdir(
        parents=True,
        exist_ok=True
    )
