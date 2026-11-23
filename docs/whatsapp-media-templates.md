# WhatsApp attachment templates

Customer dispatches use the approved image template for JPG/PNG files and the approved document template for PDF files. The templates must each have a matching image or document media header and one body text variable for the saved recipient name. Text-only messages still use the existing free-form text flow. Word and Excel files are not supported.

## Setup

Set these values in the backend `.env` (replace the example values with the exact name and language shown in Meta's WhatsApp Manager):

```dotenv
WHATSAPP_IMAGE_TEMPLATE_NAME=replace_with_image_template_name
WHATSAPP_IMAGE_TEMPLATE_LANGUAGE=replace_with_language_code
WHATSAPP_IMAGE_TEMPLATE_NAME_PARAMETER=
WHATSAPP_DOCUMENT_TEMPLATE_NAME=replace_with_document_template_name
WHATSAPP_DOCUMENT_TEMPLATE_LANGUAGE=replace_with_language_code
WHATSAPP_DOCUMENT_TEMPLATE_NAME_PARAMETER=
```

Leave `NAME_PARAMETER` empty if the template body uses the positional variable `{{1}}`. If Meta identifies the variable by name, enter the exact name without braces, such as `name`. The name and language of an approved Meta template must match exactly. Templates requiring extra variables, other headers, or dynamic button parameters need additional implementation.

Recreate the backend container after changing `.env` so Docker passes the new values: `docker compose up -d --force-recreate backend`. Never commit your real credentials. The example values are placeholders and attachment sends are blocked until names and language codes are configured.

## Sending

Choose an image or PDF; the app chooses the matching template and sends each recipient's saved name as its body variable. It does not read the recipient's WhatsApp profile name. Attachment templates do not include arbitrary typed text, so clear text before attaching a file or send it separately. Free-form text is subject to WhatsApp's messaging rules and service window. Each recipient receives a separate template message and its result is recorded in dispatch history.

Manual retry uses the same template flow. An older failed attachment with a saved caption cannot be retried using this name-only template, because doing so would silently lose its original text; send it again as a new dispatch if appropriate.

Test both approved templates with an authorized recipient and confirm delivery before relying on them. Acceptance by Meta does not guarantee delivery, and template approval, category, eligibility, and charges remain subject to Meta's policies.
