import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user
from app.api.v1.endpoints.auth import login
from app.api.v1.endpoints.contacts import delete_contact, list_contacts, update_contact
from app.api.v1.endpoints.users import delete_user, list_users
from app.api.v1.endpoints.whatsapp import _selected_contact_ids
from app.core.security import create_access_token, hash_password
from app.database import Base
from app.models.dispatch import Dispatch
from app.models.dispatch_recipient import DispatchRecipient
from app.models.marketing_person import MarketingPerson
from app.models.user import User, UserRole
from app.schemas.auth import LoginRequest
from app.schemas.marketing_person import MarketingPersonUpdate


class DeletionTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.addCleanup(engine.dispose)
        self.db = Session(engine)
        self.addCleanup(self.db.close)
        self.admin = User(username="admin", password_hash=hash_password("password123"), role=UserRole.SUPER_ADMIN)
        self.manager = User(username="manager", password_hash=hash_password("password123"), role=UserRole.MANAGER)
        self.staff = User(username="staff", password_hash=hash_password("password123"), role=UserRole.USER)
        self.db.add_all([self.admin, self.manager, self.staff])
        self.db.commit()

    def test_deleted_user_loses_access_but_history_keeps_sender(self):
        record = Dispatch(sender_id=self.staff.id, message_text="Earlier dispatch")
        self.db.add(record)
        self.db.commit()
        old_token = create_access_token("staff", "user", self.staff.session_version)

        result = delete_user(self.staff.id, self.manager, self.db)

        self.assertEqual(result["message"], "User deleted.")
        self.assertFalse(self.staff.is_active)
        self.assertNotIn(self.staff.id, [user.id for user in list_users(self.admin, self.db)])
        self.assertEqual(self.db.get(Dispatch, record.id).sender.username, "staff")
        with self.assertRaises(HTTPException) as login_error:
            login(LoginRequest(username="staff", password="password123"), self.db)
        self.assertEqual(login_error.exception.status_code, 401)
        with self.assertRaises(HTTPException) as token_error:
            get_current_user(old_token, self.db)
        self.assertEqual(token_error.exception.status_code, 401)

    def test_user_delete_respects_roles_and_self_protection(self):
        for user_id, actor, expected_status in [
            (self.admin.id, self.admin, 400),
            (self.admin.id, self.manager, 403),
            (self.manager.id, self.staff, 403),
        ]:
            with self.subTest(user_id=user_id, actor=actor.username):
                with self.assertRaises(HTTPException) as raised:
                    delete_user(user_id, actor, self.db)
                self.assertEqual(raised.exception.status_code, expected_status)

    def test_deleted_contact_disappears_from_selection_but_history_remains(self):
        contact = MarketingPerson(full_name="Ibrahim", phone_number="15550000001", is_active=True)
        self.db.add(contact)
        self.db.flush()
        record = Dispatch(sender_id=self.admin.id, message_text="Earlier message")
        self.db.add(record)
        self.db.flush()
        self.db.add(DispatchRecipient(dispatch_id=record.id, person_id=contact.id, delivery_status="sent"))
        self.db.commit()

        delete_contact(contact.id, self.admin, self.db)

        self.assertTrue(contact.is_deleted)
        self.assertFalse(contact.is_active)
        self.assertEqual(list_contacts(self.admin, self.db, None, True), [])
        self.assertEqual(self.db.query(DispatchRecipient).one().person.full_name, "Ibrahim")
        with self.assertRaises(HTTPException) as update_error:
            update_contact(contact.id, MarketingPersonUpdate(full_name="New name"), self.admin, self.db)
        self.assertEqual(update_error.exception.status_code, 404)
        with self.assertRaises(HTTPException) as select_error:
            _selected_contact_ids(self.db, [contact.id])
        self.assertEqual(select_error.exception.status_code, 422)
