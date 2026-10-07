ALLOWED_MIME_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg"
}


def is_allowed_file(content_type: str) -> bool:
    return content_type in ALLOWED_MIME_TYPES
