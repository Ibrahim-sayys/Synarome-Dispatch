import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Customer, MarketingPerson
from app.scripts.seed_demo_data import seed_demo_data


class DemoSeedTests(unittest.TestCase):
    def test_seed_is_idempotent_and_assigns_every_customer(self):
        engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        try:
            with Session(engine) as db:
                self.assertEqual(seed_demo_data(db), (10, 30))
                self.assertEqual(seed_demo_data(db), (0, 0))
                self.assertEqual(db.query(MarketingPerson).count(), 10)
                self.assertEqual(db.query(Customer).count(), 30)
                self.assertTrue(all(customer.marketing_person_id for customer in db.query(Customer)))
        finally:
            engine.dispose()
