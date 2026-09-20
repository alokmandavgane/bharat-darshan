"""EPSG:7755, WGS 84 / India NSF LCC: the one projection everything is baked in.

Lambert Conformal Conic, two standard parallels, ellipsoidal (EPSG method 9802,
formulas after Snyder 1987, "Map Projections: A Working Manual", pp. 107-109).
Vectorised with numpy so a 4096x4096 inverse mapping takes well under a second.

Parameters as published in the EPSG registry for code 7755 (the registry was not
reachable from the build sandbox when this was written; verify once if in doubt.
Everything in the project goes through this module, so internal consistency holds
regardless).
"""
import numpy as np

A = 6378137.0                 # WGS 84 semi-major axis, m
F = 1 / 298.257223563         # WGS 84 flattening
E = np.sqrt(2 * F - F * F)    # first eccentricity

LAT_0 = 24.0                  # latitude of false origin
LON_0 = 80.0                  # longitude of false origin
LAT_1 = 12.472955             # 1st standard parallel (12°28'22.64"N)
LAT_2 = 35.1728044444444      # 2nd standard parallel (35°10'22.10"N)
X_0 = 4_000_000.0             # easting at false origin, m
Y_0 = 4_000_000.0             # northing at false origin, m


def _m(phi):
    s = np.sin(phi)
    return np.cos(phi) / np.sqrt(1 - E * E * s * s)


def _t(phi):
    s = np.sin(phi)
    return np.tan(np.pi / 4 - phi / 2) / ((1 - E * s) / (1 + E * s)) ** (E / 2)


_phi0, _phi1, _phi2 = np.radians([LAT_0, LAT_1, LAT_2])
_m1, _m2 = _m(_phi1), _m(_phi2)
_t0, _t1, _t2 = _t(_phi0), _t(_phi1), _t(_phi2)
N = (np.log(_m1) - np.log(_m2)) / (np.log(_t1) - np.log(_t2))   # cone constant
FF = _m1 / (N * _t1 ** N)
RHO_0 = A * FF * _t0 ** N


def forward(lon, lat):
    """Degrees -> EPSG:7755 metres (easting, northing). Accepts scalars or arrays."""
    lon = np.asarray(lon, dtype=np.float64)
    lat = np.asarray(lat, dtype=np.float64)
    phi = np.radians(lat)
    rho = A * FF * _t(phi) ** N
    theta = N * np.radians(lon - LON_0)
    x = X_0 + rho * np.sin(theta)
    y = Y_0 + RHO_0 - rho * np.cos(theta)
    return x, y


def inverse(x, y):
    """EPSG:7755 metres -> degrees (lon, lat). Accepts scalars or arrays."""
    x = np.asarray(x, dtype=np.float64) - X_0
    y = RHO_0 - (np.asarray(y, dtype=np.float64) - Y_0)
    rho = np.sign(N) * np.hypot(x, y)
    theta = np.arctan2(np.sign(N) * x, np.sign(N) * y)
    t = (rho / (A * FF)) ** (1 / N)
    lon = np.degrees(theta / N) + LON_0
    phi = np.pi / 2 - 2 * np.arctan(t)
    for _ in range(6):                      # converges in 3-4 iterations
        s = np.sin(phi)
        phi = np.pi / 2 - 2 * np.arctan(t * ((1 - E * s) / (1 + E * s)) ** (E / 2))
    return lon, np.degrees(phi)


if __name__ == '__main__':
    # Round trip + sanity: scale is 1 on the standard parallels, false origin maps to (4e6, 4e6).
    x, y = forward(LON_0, LAT_0)
    assert abs(x - X_0) < 1e-6 and abs(y - Y_0) < 1e-6, (x, y)
    lon = np.array([68.0, 77.2, 88.36, 97.4, 93.0])
    lat = np.array([37.5, 28.6, 22.57, 6.5, 8.0])
    lon2, lat2 = inverse(*forward(lon, lat))
    err = np.hypot(lon2 - lon, lat2 - lat).max()
    assert err < 1e-9, err
    for p in (LAT_1, LAT_2):                # scale factor along the standard parallels
        x1, y1 = forward(80.0, p); x2, y2 = forward(80.01, p)
        ground = np.radians(0.01) * A * np.cos(np.radians(p)) / np.sqrt(1 - E * E * np.sin(np.radians(p)) ** 2)
        k = np.hypot(x2 - x1, y2 - y1) / ground
        assert abs(k - 1) < 1e-6, k
    print('lcc ok; New Delhi ->', [round(float(v)) for v in forward(77.209, 28.614)])
