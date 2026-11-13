from fastapi import APIRouter

from app.api.v1.endpoints import auth, contacts, customer_dispatch, customers, dispatch, users, whatsapp


api_router = APIRouter()

api_router.include_router(
    auth.router,
    prefix="/auth",
    tags=["Authentication"]
)

api_router.include_router(
    users.router,
    prefix="/users",
    tags=["Users"]
)

api_router.include_router(
    contacts.router,
    prefix="/contacts",
    tags=["Contacts"]
)

api_router.include_router(customers.router, prefix="/customers", tags=["Customers"])

api_router.include_router(
    dispatch.router,
    prefix="/dispatch",
    tags=["Dispatch"]
)

api_router.include_router(whatsapp.router, prefix="/whatsapp", tags=["WhatsApp Testing"])
api_router.include_router(customer_dispatch.router, prefix="/customer-dispatch", tags=["Customer Dispatch"])
