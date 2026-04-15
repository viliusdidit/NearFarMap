"""Compute internet latency connectivity scores.

Uses a model based on:
- Distance to nearest major internet exchange point (IXP)
- Submarine cable proximity
- Regional internet infrastructure tier

Data-free heuristic since WonderNetwork/RIPE Atlas require API access.
"""
import json
import os
import math

import numpy as np

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "data")

# Major Internet Exchange Points with capacity tier (1=largest, 2=major, 3=regional)
MAJOR_IXPS = [
    # Tier 1 - Massive IXPs
    {"name": "DE-CIX Frankfurt", "lat": 50.11, "lng": 8.68, "tier": 1},
    {"name": "AMS-IX Amsterdam", "lat": 52.37, "lng": 4.90, "tier": 1},
    {"name": "LINX London", "lat": 51.51, "lng": -0.13, "tier": 1},
    {"name": "Equinix Ashburn", "lat": 39.04, "lng": -77.49, "tier": 1},
    {"name": "Equinix SV", "lat": 37.39, "lng": -121.98, "tier": 1},
    {"name": "HKIX Hong Kong", "lat": 22.32, "lng": 114.17, "tier": 1},
    {"name": "JPNAP Tokyo", "lat": 35.68, "lng": 139.77, "tier": 1},
    {"name": "Singapore IX", "lat": 1.35, "lng": 103.82, "tier": 1},
    # Tier 2 - Major IXPs
    {"name": "IX.br Sao Paulo", "lat": -23.55, "lng": -46.63, "tier": 2},
    {"name": "KINX Seoul", "lat": 37.57, "lng": 126.98, "tier": 2},
    {"name": "MSK-IX Moscow", "lat": 55.76, "lng": 37.62, "tier": 2},
    {"name": "France-IX Paris", "lat": 48.86, "lng": 2.35, "tier": 2},
    {"name": "MIX Milan", "lat": 45.46, "lng": 9.19, "tier": 2},
    {"name": "NYIIX New York", "lat": 40.71, "lng": -74.01, "tier": 2},
    {"name": "Equinix Chicago", "lat": 41.88, "lng": -87.63, "tier": 2},
    {"name": "Equinix Dallas", "lat": 32.78, "lng": -96.80, "tier": 2},
    {"name": "Equinix Sydney", "lat": -33.87, "lng": 151.21, "tier": 2},
    {"name": "UAE-IX Dubai", "lat": 25.20, "lng": 55.27, "tier": 2},
    {"name": "NIXI Mumbai", "lat": 19.08, "lng": 72.88, "tier": 2},
    # Tier 3 - Regional
    {"name": "NAPAfrica JHB", "lat": -26.20, "lng": 28.05, "tier": 3},
    {"name": "IXPN Lagos", "lat": 6.52, "lng": 3.38, "tier": 3},
    {"name": "KIXP Nairobi", "lat": -1.29, "lng": 36.82, "tier": 3},
    {"name": "Equinix Melbourne", "lat": -37.81, "lng": 144.96, "tier": 3},
    {"name": "IX Auckland", "lat": -36.85, "lng": 174.77, "tier": 3},
    {"name": "CAIX Cairo", "lat": 30.04, "lng": 31.24, "tier": 3},
    {"name": "Santiago IX", "lat": -33.45, "lng": -70.67, "tier": 3},
    {"name": "Buenos Aires IX", "lat": -34.60, "lng": -58.38, "tier": 3},
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
        best_score = float("inf")
        for ixp in MAJOR_IXPS:
            dist = haversine_km(city["lat"], city["lng"], ixp["lat"], ixp["lng"])
            # Latency proxy: distance + tier penalty
            # ~5ms per 1000km base, tier adds overhead
            latency_ms = dist * 0.005 + {1: 2, 2: 8, 3: 20}[ixp["tier"]]
            best_score = min(best_score, latency_ms)

        scores.append(best_score)

    # Normalize 0-1
    min_s, max_s = min(scores), max(scores)
    range_s = max_s - min_s if max_s > min_s else 1.0

    for i, city in enumerate(cities):
        city["scores"]["latency"] = (scores[i] - min_s) / range_s

    sorted_cities = sorted(cities, key=lambda c: c["scores"]["latency"])
    print("Latency - Most connected:")
    for c in sorted_cities[:5]:
        print(f"  {c['name']}, {c['country']}: {c['scores']['latency']:.3f}")
    print("Latency - Most isolated:")
    for c in sorted_cities[-5:]:
        print(f"  {c['name']}, {c['country']}: {c['scores']['latency']:.3f}")

    return cities


if __name__ == "__main__":
    cities_path = os.path.join(OUTPUT_DIR, "cities.json")
    with open(cities_path) as f:
        cities = json.load(f)

    cities = compute_scores(cities)

    with open(cities_path, "w") as f:
        json.dump(cities, f, indent=2)
    print(f"\nUpdated cities.json with latency scores")
