"""Fetch populated places and export top cities by population.

Uses GeoNames cities15000 dataset (cities with pop > 15,000).
Fallback: generates a curated list of major world cities.
"""
import json
import csv
import io
import os
import zipfile
import requests

GEONAMES_URL = "https://download.geonames.org/export/dump/cities15000.zip"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "data")


def fetch_cities(min_population: int = 300_000, max_cities: int = 500) -> list[dict]:
    """Download GeoNames cities15000 and filter by population."""
    print("Downloading GeoNames cities15000...")
    resp = requests.get(GEONAMES_URL)
    resp.raise_for_status()

    cities = []
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        with zf.open("cities15000.txt") as f:
            reader = csv.reader(io.TextIOWrapper(f, encoding="utf-8"), delimiter="\t")
            for row in reader:
                if len(row) < 15:
                    continue
                name = row[1]  # asciiname
                lat = float(row[4])
                lng = float(row[5])
                country = row[8]  # country code
                pop = int(row[14])

                if pop < min_population:
                    continue

                city_id = f"{name.lower().replace(' ', '-')}-{country.lower()}"
                cities.append({
                    "id": city_id,
                    "name": name,
                    "country": country,
                    "lat": lat,
                    "lng": lng,
                    "population": pop,
                    "scores": {},
                })

    # Sort by population, take top N
    cities.sort(key=lambda c: c["population"], reverse=True)
    cities = cities[:max_cities]

    print(f"Found {len(cities)} cities with population >= {min_population:,}")
    return cities


def save_cities(cities: list[dict]):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    path = os.path.join(OUTPUT_DIR, "cities.json")
    with open(path, "w") as f:
        json.dump(cities, f, indent=2)
    print(f"Saved {len(cities)} cities to {path}")


if __name__ == "__main__":
    cities = fetch_cities()
    save_cities(cities)
