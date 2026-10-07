class WhatsAppService:

    @staticmethod
    def send_message(phone_number: str, message: str):
        return {
            "phone_number": phone_number,
            "message": message,
            "status": "not_configured"
        }
