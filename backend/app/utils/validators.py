ALLOWED_MIME_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg"
}


def is_allowed_file(content_type: str) -> bool:
    return content_type in ALLOWED_MIME_TYPES


def normalize_phone_number(phone_number: str) -> str:
    cleaned = "".join(char for char in phone_number.strip() if char.isdigit() or char == "+")

    if cleaned.count("+") > 1 or ("+" in cleaned and not cleaned.startswith("+")):
        raise ValueError("Phone number can only include + at the start")

    digits = cleaned[1:] if cleaned.startswith("+") else cleaned
    if not digits.isdigit() or not 10 <= len(digits) <= 15:
        raise ValueError("Phone number must contain 10 to 15 digits")

    return cleaned
