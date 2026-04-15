"""Compute flight connectivity scores using OpenFlights data.

Downloads airport and route data from OpenFlights.
For each city, finds the nearest airport and counts how many unique
destinations are reachable. Score = inverse of connectivity (more routes = lower score).
"""
import json
import csv
import io
import os
import math

import requests
import numpy as np

AIRPORTS_URL = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat"
ROUTES_URL = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "data")


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


def fetch_airports():
    """Download and parse OpenFlights airports.dat."""
    print("Downloading airports...")
    resp = requests.get(AIRPORTS_URL)
    resp.raise_for_status()

    airports = {}
    reader = csv.reader(io.StringIO(resp.text))
    for row in reader:
        if len(row) < 8:
            continue
        try:
            airport_id = int(row[0])
            lat = float(row[6])
            lng = float(row[7])
            iata = row[4].strip('"')
            name = row[1].strip('"')
            if iata == "\\N" or not iata:
                continue
            airports[airport_id] = {
                "id": airport_id,
                "iata": iata,
                "name": name,
                "lat": lat,
                "lng": lng,
            }
        except (ValueError, IndexError):
            continue

    print(f"  Loaded {len(airports)} airports with IATA codes")
    return airports


def fetch_routes():
    """Download and parse OpenFlights routes.dat."""
    print("Downloading routes...")
    resp = requests.get(ROUTES_URL)
    resp.raise_for_status()

    routes = []
    reader = csv.reader(io.StringIO(resp.text))
    for row in reader:
        if len(row) < 5:
            continue
        try:
            src_id = int(row[3])
            dst_id = int(row[5])
            routes.append((src_id, dst_id))
        except (ValueError, IndexError):
            continue

    print(f"  Loaded {len(routes)} routes")
    return routes


def build_connectivity(airports, routes):
    """Build destination count per airport."""
    dest_count = {}
    for src_id, dst_id in routes:
        if src_id in airports and dst_id in airports:
            if src_id not in dest_count:
                dest_count[src_id] = set()
            dest_count[src_id].add(dst_id)

    # Convert to count
    connectivity = {}
    for aid, dests in dest_count.items():
        connectivity[aid] = len(dests)

    print(f"  {len(connectivity)} airports with at least 1 route")
    if connectivity:
        max_conn = max(connectivity.values())
        max_airport = [airports[k]["iata"] for k, v in connectivity.items() if v == max_conn]
        print(f"  Most connected: {max_airport[0]} with {max_conn} destinations")

    return connectivity


def compute_flight_scores(cities, airports, connectivity):
    """For each city, find nearest airport and score based on route count."""
    # Build airport list for spatial lookup
    airport_list = list(airports.values())
    airport_lats = np.array([a["lat"] for a in airport_list])
    airport_lngs = np.array([a["lng"] for a in airport_list])
    airport_ids = [a["id"] for a in airport_list]

    # Convert to 3D for fast nearest lookup
    ax = np.cos(np.radians(airport_lats)) * np.cos(np.radians(airport_lngs))
    ay = np.cos(np.radians(airport_lats)) * np.sin(np.radians(airport_lngs))
    az = np.sin(np.radians(airport_lats))

    max_routes = max(connectivity.values()) if connectivity else 1

    scores = []
    for city in cities:
        # Find nearest airport
        cx = math.cos(math.radians(city["lat"])) * math.cos(math.radians(city["lng"]))
        cy = math.cos(math.radians(city["lat"])) * math.sin(math.radians(city["lng"]))
        cz = math.sin(math.radians(city["lat"]))

        dists = (ax - cx) ** 2 + (ay - cy) ** 2 + (az - cz) ** 2
        nearest_idx = int(np.argmin(dists))
        nearest_airport_id = airport_ids[nearest_idx]
        nearest_dist_km = haversine_km(
            city["lat"], city["lng"],
            airport_list[nearest_idx]["lat"], airport_list[nearest_idx]["lng"],
        )

        # Check all airports within radius, take the one with most routes
        route_count = 0
        for j in range(len(airport_list)):
            d2 = (ax[j] - cx) ** 2 + (ay[j] - cy) ** 2 + (az[j] - cz) ** 2
            # ~200km on unit sphere ≈ 0.001 in squared 3D distance
            if d2 < 0.004:
                rc = connectivity.get(airport_ids[j], 0)
                if rc > route_count:
                    route_count = rc

        # Score: inverse connectivity. More routes = lower score (well connected)
        # Use log scale since route counts vary hugely (1 to 300+)
        if route_count > 0:
            score = 1.0 - math.log(1 + route_count) / math.log(1 + max_routes)
        else:
            score = 1.0  # no airport nearby = fully isolated

        scores.append(score)
        city["scores"]["flight"] = score

    # Print extremes
    sorted_cities = sorted(cities, key=lambda c: c["scores"]["flight"])
    print("\nFlight - Most connected (lowest score):")
    for c in sorted_cities[:5]:
        print(f"  {c['name']}, {c['country']}: {c['scores']['flight']:.3f}")
    print("Flight - Most isolated (highest score):")
    for c in sorted_cities[-5:]:
        print(f"  {c['name']}, {c['country']}: {c['scores']['flight']:.3f}")

    return cities


if __name__ == "__main__":
    cities_path = os.path.join(OUTPUT_DIR, "cities.json")
    if not os.path.exists(cities_path):
        print("Run fetch_cities.py first!")
        exit(1)

    with open(cities_path) as f:
        cities = json.load(f)

    airports = fetch_airports()
    routes = fetch_routes()
    connectivity = build_connectivity(airports, routes)
    cities = compute_flight_scores(cities, airports, connectivity)

    with open(cities_path, "w") as f:
        json.dump(cities, f, indent=2)
    print(f"\nUpdated cities.json with flight scores")
