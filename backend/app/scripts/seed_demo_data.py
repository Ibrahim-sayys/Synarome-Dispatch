"""Add identifiable Pakistani demo customers and marketing persons, once."""

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.customer import Customer
from app.models.marketing_person import MarketingPerson


MARKETING_NAMES = [
    "Muhammad Usman (Demo)", "Ayesha Khan (Demo)", "Bilal Ahmed (Demo)",
    "Fatima Raza (Demo)", "Hassan Ali (Demo)", "Sana Iqbal (Demo)",
    "Omar Farooq (Demo)", "Hira Malik (Demo)", "Danish Akhtar (Demo)",
    "Zainab Sheikh (Demo)",
]

CUSTOMERS = [
    ("Al-Naseem Traders", "Lahore"), ("Karachi Textile House", "Karachi"),
    ("Raza Sports Goods", "Sialkot"), ("Faisal Fabrics", "Faisalabad"),
    ("Multan Cotton Works", "Multan"), ("Peshawar Dry Fruits", "Peshawar"),
    ("Quetta Auto Parts", "Quetta"), ("Rawalpindi Hardware", "Rawalpindi"),
    ("Gujranwala Ceramics", "Gujranwala"), ("Hyderabad Rice Mills", "Hyderabad"),
    ("Ali Raza", "Islamabad"), ("Hina Bukhari", "Lahore"),
    ("Hamza Qureshi", "Karachi"), ("Mariam Yousaf", "Sialkot"),
    ("Saad Mahmood", "Faisalabad"), ("Nida Tariq", "Multan"),
    ("Ahmed Brothers Wholesale", "Sukkur"), ("Sargodha Citrus Company", "Sargodha"),
    ("Bahawalpur Grain Traders", "Bahawalpur"), ("Abbottabad Pharma Supply", "Abbottabad"),
    ("Gujrat Fan Centre", "Gujrat"), ("Sheikhupura Packaging", "Sheikhupura"),
    ("Okara Dairy Traders", "Okara"), ("Rahim Yar Khan Foods", "Rahim Yar Khan"),
    ("Kasur Leather House", "Kasur"), ("Mardan Building Supply", "Mardan"),
    ("Jhelum Marble Depot", "Jhelum"), ("Nawabshah General Store", "Nawabshah"),
    ("Chiniot Furniture Works", "Chiniot"), ("Dera Ghazi Khan Logistics", "Dera Ghazi Khan"),
]


def seed_demo_data(db: Session) -> tuple[int, int]:
    marketing_created = 0
    customers_created = 0
    people = []
    try:
        for index, name in enumerate(MARKETING_NAMES, start=1):
            person = db.query(MarketingPerson).filter(MarketingPerson.full_name == name, MarketingPerson.is_deleted.is_(False)).first()
            if person is None:
                phone = f"0300000{index:04d}"
                if db.query(MarketingPerson.id).filter(MarketingPerson.phone_number == phone).first():
                    raise ValueError(f"Demo phone {phone} is already used; no demo records were added.")
                person = MarketingPerson(full_name=name, phone_number=phone, is_active=True)
                db.add(person)
                db.flush()
                marketing_created += 1
            people.append(person)

        for index, (name, city) in enumerate(CUSTOMERS, start=1):
            demo_name = f"{name} (Demo)"
            existing = db.query(Customer.id).filter(Customer.full_name == demo_name, Customer.is_deleted.is_(False)).first()
            if existing:
                continue
            db.add(Customer(
                full_name=demo_name,
                phone_number=f"0310000{index:04d}" if index % 2 == 0 else None,
                city=city,
                other_info="Demo record for testing the customer dispatch workflow.",
                marketing_person_id=people[(index - 1) % len(people)].id,
            ))
            customers_created += 1
        db.commit()
    except Exception:
        db.rollback()
        raise
    return marketing_created, customers_created


def main() -> None:
    db = SessionLocal()
    try:
        people, customers = seed_demo_data(db)
    finally:
        db.close()
    print(f"Created {people} demo marketing persons and {customers} demo customers.")


if __name__ == "__main__":
    main()
