"""Compute shipping connectivity scores.

Scores based on:
- Distance to nearest major port
- Coastal vs inland penalty
- Port connectivity (major shipping hub vs small port)
"""
import json
import os
import math

import numpy as np

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "data")

# Major world ports with approximate connectivity tier (1=mega hub, 2=major, 3=regional)
MAJOR_PORTS = [
    # Asia
    {"name": "Shanghai", "lat": 31.23, "lng": 121.47, "tier": 1},
    {"name": "Singapore", "lat": 1.29, "lng": 103.85, "tier": 1},
    {"name": "Shenzhen", "lat": 22.54, "lng": 114.05, "tier": 1},
    {"name": "Busan", "lat": 35.10, "lng": 129.04, "tier": 1},
    {"name": "Hong Kong", "lat": 22.32, "lng": 114.17, "tier": 1},
    {"name": "Guangzhou", "lat": 23.13, "lng": 113.26, "tier": 1},
    {"name": "Tokyo", "lat": 35.65, "lng": 139.84, "tier": 2},
    {"name": "Dubai", "lat": 25.27, "lng": 55.30, "tier": 1},
    {"name": "Mumbai", "lat": 19.08, "lng": 72.88, "tier": 2},
    {"name": "Colombo", "lat": 6.95, "lng": 79.84, "tier": 2},
    # Europe
    {"name": "Rotterdam", "lat": 51.95, "lng": 4.14, "tier": 1},
    {"name": "Antwerp", "lat": 51.30, "lng": 4.28, "tier": 1},
    {"name": "Hamburg", "lat": 53.54, "lng": 10.00, "tier": 1},
    {"name": "Piraeus", "lat": 37.94, "lng": 23.63, "tier": 2},
    {"name": "Valencia", "lat": 39.45, "lng": -0.32, "tier": 2},
    {"name": "Felixstowe", "lat": 51.95, "lng": 1.30, "tier": 2},
    {"name": "Marseille", "lat": 43.35, "lng": 5.34, "tier": 2},
    {"name": "Gdansk", "lat": 54.40, "lng": 18.67, "tier": 3},
    # Americas
    {"name": "Los Angeles", "lat": 33.74, "lng": -118.26, "tier": 1},
    {"name": "New York", "lat": 40.67, "lng": -74.04, "tier": 1},
    {"name": "Savannah", "lat": 32.08, "lng": -81.09, "tier": 2},
    {"name": "Santos", "lat": -23.95, "lng": -46.30, "tier": 2},
    {"name": "Colon", "lat": 9.35, "lng": -79.90, "tier": 2},
    {"name": "Vancouver", "lat": 49.29, "lng": -123.11, "tier": 2},
    {"name": "Houston", "lat": 29.73, "lng": -95.02, "tier": 2},
    {"name": "Buenos Aires", "lat": -34.60, "lng": -58.37, "tier": 2},
    # Africa
    {"name": "Durban", "lat": -29.87, "lng": 31.03, "tier": 2},
    {"name": "Tangier", "lat": 35.79, "lng": -5.81, "tier": 2},
    {"name": "Mombasa", "lat": -4.04, "lng": 39.67, "tier": 3},
    {"name": "Lagos", "lat": 6.45, "lng": 3.39, "tier": 3},
    # Oceania
    {"name": "Melbourne", "lat": -37.84, "lng": 144.95, "tier": 2},
    {"name": "Sydney", "lat": -33.86, "lng": 151.21, "tier": 2},
    {"name": "Auckland", "lat": -36.84, "lng": 174.77, "tier": 3},
]


def haversine_km(lat1, lng1, lat2, lng2):
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def compute_scores(cities):
    scores = []

    for city in cities:
        # Find nearest port and best tier within range
        best_score = float("inf")
        for port in MAJOR_PORTS:
            dist = haversine_km(city["lat"], city["lng"], port["lat"], port["lng"])
            # Score = distance to port × tier factor
            # Tier 1 ports are more valuable (lower multiplier)
            tier_factor = {1: 1.0, 2: 1.5, 3: 2.5}[port["tier"]]
            port_score = dist * tier_factor
            best_score = min(best_score, port_score)

        scores.append(best_score)

    # Normalize 0-1
    min_s, max_s = min(scores), max(scores)
    range_s = max_s - min_s if max_s > min_s else 1.0

    for i, city in enumerate(cities):
        city["scores"]["shipping"] = (scores[i] - min_s) / range_s

    sorted_cities = sorted(cities, key=lambda c: c["scores"]["shipping"])
    print("Shipping - Most connected:")
    for c in sorted_cities[:5]:
        print(f"  {c['name']}, {c['country']}: {c['scores']['shipping']:.3f}")
    print("Shipping - Most isolated:")
    for c in sorted_cities[-5:]:
        print(f"  {c['name']}, {c['country']}: {c['scores']['shipping']:.3f}")

    return cities


if __name__ == "__main__":
    cities_path = os.path.join(OUTPUT_DIR, "cities.json")
    with open(cities_path) as f:
        cities = json.load(f)

    cities = compute_scores(cities)

    with open(cities_path, "w") as f:
        json.dump(cities, f, indent=2)
    print(f"\nUpdated cities.json with shipping scores")
