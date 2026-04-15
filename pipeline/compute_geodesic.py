"""Compute geodesic connectivity scores for cities using K-nearest neighbors."""
import json
import os
import struct
import math

import numpy as np
from scipy.spatial import cKDTree

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "data")
K_NEAREST = 50  # number of nearest cities to consider


def haversine_km(lat1, lng1, lat2, lng2):
    """Great-circle distance in km."""
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


def compute_scores(cities: list[dict]) -> list[dict]:
    """Compute K-nearest geodesic connectivity score for each city."""
    n = len(cities)
    k = min(K_NEAREST, n - 1)

    # Convert to radians for BallTree-like operations
    # Using cKDTree with Euclidean on unit sphere as approximation for ranking
    coords_rad = np.array(
        [[math.radians(c["lat"]), math.radians(c["lng"])] for c in cities]
    )

    # Convert to 3D cartesian for spatial indexing
    lats = coords_rad[:, 0]
    lngs = coords_rad[:, 1]
    x = np.cos(lats) * np.cos(lngs)
    y = np.cos(lats) * np.sin(lngs)
    z = np.sin(lats)
    points_3d = np.column_stack([x, y, z])

    tree = cKDTree(points_3d)

    scores = []
    for i in range(n):
        # Query k+1 neighbors (includes self)
        _, indices = tree.query(points_3d[i], k=k + 1)
        # Skip self (index 0)
        neighbor_indices = indices[1:]

        # Compute actual haversine distances to neighbors
        distances = []
        for j in neighbor_indices:
            d = haversine_km(
                cities[i]["lat"], cities[i]["lng"],
                cities[j]["lat"], cities[j]["lng"],
            )
            distances.append(d)

        distances.sort()

        # Rank-weighted mean: closer neighbors matter more
        weights = 1.0 / np.arange(1, len(distances) + 1)
        score = np.average(distances, weights=weights)
        scores.append(score)

    # Normalize to 0-1
    min_s = min(scores)
    max_s = max(scores)
    range_s = max_s - min_s if max_s > min_s else 1.0

    for i, city in enumerate(cities):
        city["scores"]["geodesic"] = (scores[i] - min_s) / range_s

    print(f"Geodesic scores: min={min_s:.0f}km, max={max_s:.0f}km")

    # Show extremes
    sorted_cities = sorted(cities, key=lambda c: c["scores"]["geodesic"])
    print("\nMost connected (lowest score):")
    for c in sorted_cities[:5]:
        print(f"  {c['name']}, {c['country']}: {c['scores']['geodesic']:.3f}")
    print("\nMost isolated (highest score):")
    for c in sorted_cities[-5:]:
        print(f"  {c['name']}, {c['country']}: {c['scores']['geodesic']:.3f}")

    return cities


def build_displacement_map(cities: list[dict], vertex_count: int = 40962) -> np.ndarray:
    """
    Build per-vertex displacement for IcosahedronGeometry(1, 64).
    Maps city scores onto mesh vertices using IDW interpolation.
    """
    # Generate icosahedron vertices (matching Three.js IcosahedronGeometry)
    # For now, generate uniform sphere points and use IDW from city scores
    # The actual vertex positions come from Three.js, but they're uniformly
    # distributed on a unit sphere, so we can approximate with fibonacci sphere

    # Fibonacci sphere for uniform distribution
    indices = np.arange(0, vertex_count, dtype=float) + 0.5
    phi = np.arccos(1 - 2 * indices / vertex_count)
    theta = np.pi * (1 + 5**0.5) * indices

    vx = np.sin(phi) * np.cos(theta)
    vy = np.sin(phi) * np.sin(theta)
    vz = np.cos(phi)

    # Convert vertices to lat/lng
    v_lats = np.degrees(np.arcsin(np.clip(vz, -1, 1)))
    v_lngs = np.degrees(np.arctan2(vy, vx))

    # City positions in 3D
    city_lats = np.array([c["lat"] for c in cities])
    city_lngs = np.array([c["lng"] for c in cities])
    city_scores = np.array([c["scores"]["geodesic"] for c in cities])

    cx = np.cos(np.radians(city_lats)) * np.cos(np.radians(city_lngs))
    cy = np.cos(np.radians(city_lats)) * np.sin(np.radians(city_lngs))
    cz = np.sin(np.radians(city_lats))
    city_points = np.column_stack([cx, cy, cz])

    city_tree = cKDTree(city_points)

    # For each vertex, IDW interpolation from nearest cities
    vertex_points = np.column_stack([vx, vy, vz])
    displacement = np.zeros(vertex_count, dtype=np.float32)

    K_INTERP = 8  # nearest cities for interpolation
    POWER = 2.0   # IDW power parameter

    distances, indices = city_tree.query(vertex_points, k=K_INTERP)

    for i in range(vertex_count):
        dists = distances[i]
        idxs = indices[i]

        # Handle exact match (distance ~0)
        if dists[0] < 1e-10:
            displacement[i] = city_scores[idxs[0]]
            continue

        # IDW weights
        weights = 1.0 / (dists ** POWER)
        total_weight = weights.sum()
        displacement[i] = (weights * city_scores[idxs]).sum() / total_weight

    return displacement


def save_displacement(displacement: np.ndarray, metric: str = "geodesic"):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    path = os.path.join(OUTPUT_DIR, f"displacement-{metric}.bin")
    displacement.astype(np.float32).tofile(path)
    print(f"Saved displacement map ({len(displacement)} vertices) to {path}")


if __name__ == "__main__":
    cities_path = os.path.join(OUTPUT_DIR, "cities.json")
    if not os.path.exists(cities_path):
        print("Run fetch_cities.py first!")
        exit(1)

    with open(cities_path) as f:
        cities = json.load(f)

    cities = compute_scores(cities)

    # Re-save cities with scores
    with open(cities_path, "w") as f:
        json.dump(cities, f, indent=2)
    print(f"\nUpdated cities.json with geodesic scores")

    # Build and save displacement map
    displacement = build_displacement_map(cities)
    save_displacement(displacement)
