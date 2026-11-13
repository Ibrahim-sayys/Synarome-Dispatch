import re


ALLOWED_MIME_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg"
}


def is_allowed_file(content_type: str) -> bool:
    return content_type in ALLOWED_MIME_TYPES


def normalize_phone_number(phone_number: str) -> str:
    if not re.fullmatch(r"[0-9]{11,15}", phone_number):
        raise ValueError("Phone number must contain 11 to 15 digits only")
    return phone_number
