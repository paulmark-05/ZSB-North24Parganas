#!/usr/bin/env python3
"""
One-time MongoDB Atlas initializer for the Zila Sainik Board portal.

Creates the collections, indexes and default documents the Node app expects
(mirrors server/models/index.js and the DEFAULTS in server/store.js), so a
brand-new Atlas database is ready before the app's first boot.

Safe to re-run: every step checks first and skips anything that already
exists, so it will never overwrite content you've already created through
the Admin CMS.

Note: the Node app (server/seed.js) already does this automatically on
every boot via Mongoose. This script is optional standalone tooling for
provisioning the database ahead of time, or from outside the Node process.

Usage:
    pip install -r scripts/requirements.txt
    python scripts/init_mongodb.py
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from pymongo import ASCENDING, MongoClient
from pymongo.errors import ConfigurationError, ServerSelectionTimeoutError
import bcrypt

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

MONGODB_URI = os.environ.get("MONGODB_URI", "").strip()
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin").strip().lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Admin@12345")

COLLECTIONS = ["users", "notices", "vendors", "ads", "singletons"]

DEFAULT_SETTINGS = {
    "orgName": "Zila Sainik Board",
    "district": "District Sainik Welfare Office",
    "logoUrl": "",
    "theme": {"navy": "#0b2545", "red": "#c8102e", "lightBlue": "#2e7fd4"},
    "marqueeSpeed": 22,
}

DEFAULT_LINKS = {
    "vms": {
        "label": "Visitor Management System",
        "description": "Register your visit, get a token and skip the queue.",
        "link": "https://example.gov.in/vms",
        "previewText": "You are being redirected to the official Visitor Management System.",
        "enabled": True,
    },
    "grievance": {
        "label": "Grievance Redressal",
        "description": "Raise a grievance and track its status online.",
        "link": "https://example.gov.in/grievance",
        "previewText": "You are being redirected to the official Grievance Redressal portal.",
        "enabled": True,
    },
}


def ensure_collection(db, name):
    if name in db.list_collection_names():
        print(f"  = collection '{name}' already exists")
    else:
        db.create_collection(name)
        print(f"  + created collection '{name}'")


def main():
    if not MONGODB_URI:
        sys.exit("MONGODB_URI is not set. Add it to .env first, then re-run this script.")

    client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=10000)
    try:
        client.admin.command("ping")
    except ServerSelectionTimeoutError as err:
        sys.exit(
            "Could not reach MongoDB Atlas.\n"
            "Check Network Access (IP allowlist) and the connection string.\n"
            f"Underlying error: {err}"
        )

    try:
        db = client.get_default_database()
    except ConfigurationError:
        db = client["zsb"]

    print(f"Connected. Using database: {db.name}\n")

    print("Collections:")
    for name in COLLECTIONS:
        ensure_collection(db, name)

    print("\nIndexes:")
    db.users.create_index([("username", ASCENDING)], unique=True)
    print("  users.username (unique)")
    db.singletons.create_index([("key", ASCENDING)], unique=True)
    print("  singletons.key (unique)")

    print("\nAdmin user:")
    if db.users.find_one({"username": ADMIN_USERNAME}):
        print(f"  = user '{ADMIN_USERNAME}' already exists — leaving it untouched")
    else:
        password_hash = bcrypt.hashpw(ADMIN_PASSWORD.encode(), bcrypt.gensalt()).decode()
        db.users.insert_one(
            {
                "username": ADMIN_USERNAME,
                "passwordHash": password_hash,
                "displayName": "Administrator",
                "role": "admin",
            }
        )
        print(f"  + created admin user '{ADMIN_USERNAME}' (password from ADMIN_PASSWORD in .env)")

    print("\nDefault settings / links:")
    for key, value in (("settings", DEFAULT_SETTINGS), ("links", DEFAULT_LINKS)):
        if db.singletons.find_one({"key": key}):
            print(f"  = singleton '{key}' already exists")
        else:
            db.singletons.insert_one({"key": key, "value": value})
            print(f"  + created singleton '{key}'")

    print("\nDone — the database is ready. Point MONGODB_URI at it and start the app.")
    client.close()


if __name__ == "__main__":
    main()
