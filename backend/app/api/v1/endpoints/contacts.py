from fastapi import APIRouter

router = APIRouter()


@router.get("/")
def list_contacts():
    return {
        "message": "Contacts endpoint"
    }


@router.post("/")
def create_contact():
    return {
        "message": "Create contact endpoint"
    }
