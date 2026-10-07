from fastapi import APIRouter

router = APIRouter()


@router.post("/send")
def send_dispatch():
    return {
        "message": "Dispatch send endpoint"
    }


@router.get("/history")
def dispatch_history():
    return {
        "message": "Dispatch history endpoint"
    }
