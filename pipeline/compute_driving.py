"""Compute driving connectivity scores.

Since OSRM requires a running server, we use a heuristic approach:
- Cities on the same landmass get scores based on road distance proxy
  (geodesic distance × road factor for the region)
- Cities on islands or separated by ocean get high isolation scores
- Continental connectivity bonus: more neighboring cities on same landmass = lower score

Uses continent/subregion info to determine landmass connectivity.
"""
import json
import os
import math

import numpy as np
from scipy.spatial import cKDTree

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "data")
K_NEAREST = 30

# Rough continent groupings for "same landmass" check
# Cities in the same group can potentially drive to each other
LANDMASS_GROUPS = {
    # Eurasia + Africa (connected via road)
    "eurasia_africa": {
        "AD", "AE", "AF", "AL", "AM", "AO", "AT", "AZ", "BA", "BD", "BE", "BF",
        "BG", "BH", "BI", "BJ", "BN", "BT", "BW", "BY", "CD", "CF", "CG", "CH",
        "CI", "CM", "CN", "CZ", "DE", "DJ", "DK", "DZ", "EE", "EG", "ER", "ES",
        "ET", "FI", "FR", "GA", "GB", "GE", "GH", "GM", "GN", "GQ", "GR", "GW",
        "HK", "HR", "HU", "ID", "IE", "IL", "IN", "IQ", "IR", "IS", "IT", "JO",
        "KE", "KG", "KH", "KR", "KW", "KZ", "LA", "LB", "LK", "LR", "LS", "LT",
        "LU", "LV", "LY", "MA", "MD", "ME", "MK", "ML", "MM", "MN", "MO", "MR",
        "MW", "MY", "MZ", "NA", "NE", "NG", "NL", "NO", "NP", "OM", "PK", "PL",
        "PS", "PT", "QA", "RO", "RS", "RU", "RW", "SA", "SD", "SE", "SG", "SI",
        "SK", "SL", "SN", "SO", "SS", "SY", "SZ", "TD", "TG", "TH", "TJ", "TM",
        "TN", "TR", "TW", "TZ", "UA", "UG", "UZ", "VN", "YE", "ZA", "ZM", "ZW",
    },
    # Americas
    "americas": {
        "AR", "BO", "BR", "CA", "CL", "CO", "CR", "CU", "DO", "EC", "GT", "GY",
        "HN", "HT", "JM", "MX", "NI", "PA", "PE", "PR", "PY", "SV", "SR", "TT",
        "US", "UY", "VE",
    },
    # Oceania (islands, generally not driveable between)
    "australia": {"AU"},
    "new_zealand": {"NZ"},
    "japan": {"JP"},
    "philippines": {"PH"},
    "madagascar": {"MG"},
    "cuba": {"CU"},
}

def get_landmass(country_code):
    for group_name, codes in LANDMASS_GROUPS.items():
        if country_code in codes:
            return group_name
    return f"island_{country_code}"


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
    n = len(cities)
    k = min(K_NEAREST, n - 1)

    # Assign landmass to each city
    landmasses = [get_landmass(c["country"]) for c in cities]

    # Build spatial index
    coords_rad = np.array(
        [[math.radians(c["lat"]), math.radians(c["lng"])] for c in cities]
    )
    lats, lngs = coords_rad[:, 0], coords_rad[:, 1]
    x = np.cos(lats) * np.cos(lngs)
    y = np.cos(lats) * np.sin(lngs)
    z = np.sin(lats)
    points_3d = np.column_stack([x, y, z])
    tree = cKDTree(points_3d)

    scores = []
    for i in range(n):
        _, indices = tree.query(points_3d[i], k=k + 1)
        neighbors = indices[1:]

        # Count driveable neighbors (same landmass) and their distances
        drive_distances = []
        for j in neighbors:
            if landmasses[i] == landmasses[j]:
                d = haversine_km(
                    cities[i]["lat"], cities[i]["lng"],
                    cities[j]["lat"], cities[j]["lng"],
                )
                # Road distance ≈ 1.3× geodesic (road detour factor)
                drive_distances.append(d * 1.3)

        if len(drive_distances) == 0:
            # Island city with no driveable neighbors
            scores.append(20000.0)  # very isolated
        else:
            # Rank-weighted mean of driving distances
            drive_distances.sort()
            weights = 1.0 / np.arange(1, len(drive_distances) + 1)
            scores.append(float(np.average(drive_distances[:k], weights=weights[:len(drive_distances[:k])])))

    # Normalize 0-1
    min_s, max_s = min(scores), max(scores)
    range_s = max_s - min_s if max_s > min_s else 1.0

    for i, city in enumerate(cities):
        city["scores"]["driving"] = (scores[i] - min_s) / range_s

    sorted_cities = sorted(cities, key=lambda c: c["scores"]["driving"])
    print("Driving - Most connected:")
    for c in sorted_cities[:5]:
        print(f"  {c['name']}, {c['country']}: {c['scores']['driving']:.3f}")
    print("Driving - Most isolated:")
    for c in sorted_cities[-5:]:
        print(f"  {c['name']}, {c['country']}: {c['scores']['driving']:.3f}")

    return cities


if __name__ == "__main__":
    cities_path = os.path.join(OUTPUT_DIR, "cities.json")
    with open(cities_path) as f:
        cities = json.load(f)

    cities = compute_scores(cities)

    with open(cities_path, "w") as f:
        json.dump(cities, f, indent=2)
    print(f"\nUpdated cities.json with driving scores")
