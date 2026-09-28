"""Convert Awpy 2000905 map geometry + Valve NAV 36 into web data.

NAV layout reference: ValveResourceFormat/NavMesh (MIT), upstream repository.
The exported map data are Valve game assets, not covered by this script's code.

Usage:
    python scripts/map-build.py --map de_mirage \
        --ladders public/assets/maps/de_mirage/../..   # optional, see below

Outputs (all under public/assets/maps/<map>/):
    positions.f32      collision triangle soup the browser and server both read
    materials.u8       per-triangle surface material ids (penetration source)
    nav-areas.json     full nav mesh, used by bots and QA
    map-data.json      spawns / sites / labels / overview for the descriptor

--ladders <file> is optional. When given, each candidate volume must touch
walkable nav at BOTH its bottom and its top with a real height difference; the
survivors are written to map-data.json as `ladders`. See
scripts/extract-map-ladders.mjs for where they come from.
"""
import argparse, io, json, math, pathlib, struct

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCALE = 0.0254


def point(v):
    return [round(float(v[0]) * SCALE, 4), round(float(v[2]) * SCALE, 4), round(-float(v[1]) * SCALE, 4)]


def obj(v):
    return dict(zip(('x', 'y', 'z'), point(v)))


def parse_nav(raw):
    """Valve NAV v36 -> list of areas in gameplay space."""
    f = io.BytesIO(raw)
    read = lambda fmt: struct.unpack('<' + fmt, f.read(struct.calcsize('<' + fmt)))
    u = lambda: read('I')[0]

    def skip_kv3():
        f.seek((f.tell() + 7) & ~7)
        start = f.tell()
        header = f.read(120)
        assert header[:4] == b'\x053VK', header[:4]
        uncomp, _comp, blocks, blobbytes = struct.unpack_from('<4I', header, 48)
        assert uncomp and blocks == 0, (uncomp, blocks)
        f.seek(start + 120 + uncomp + blobbytes)

    magic, nav_version, _sub, _flags = read('4I')
    assert magic == 0xFEEDFACE and nav_version == 36
    skip_kv3()
    corners = [read('3f') for _ in range(u())]
    polygons = []
    for _ in range(u()):
        count = read('B')[0]
        polygons.append([corners[u()] for _ in range(count)])
        u()
    u()  # v32 unknown
    u()  # movable
    skip_kv3()
    areas = []
    for _ in range(u()):
        area_id = u()
        attributes = read('q')[0]
        hull = read('B')[0]
        poly = polygons[u()]
        read('f')
        neighbors = []
        for edge in poly:
            for _ in range(u()):
                neighbor = u()
                u()
                neighbors.append(neighbor)
        f.read(5)
        f.read(u() * 4)
        f.read(u() * 4)
        center = np.array(poly).mean(axis=0)
        areas.append({'id': area_id, 'attributes': attributes, 'hull': hull,
                      **obj(center), 'neighbors': sorted(set(neighbors)),
                      'corners': [point(v) for v in poly]})
    return areas


def walkable_near(areas, x, y, z, radius=2.5, tolerance=1.2):
    return [a for a in areas
            if math.hypot(a['x'] - x, a['z'] - z) <= radius
            and abs(a['y'] - y) <= tolerance]


def prune_ladders(candidates, areas, verbose=True):
    """Keep only volumes that form a real route through the nav graph.

    A prop whose node name merely contains "ladder" will sit in empty space: no
    paired nav at both ends, or no height change between them. Shipping those
    would give players volumes they cannot actually use.
    """
    kept, dropped = [], []
    for ladder in candidates:
        at_bottom = walkable_near(areas, ladder['x'], ladder['bottom'], ladder['z'])
        at_top = walkable_near(areas, ladder['x'], ladder['top'], ladder['z'])
        delta = None
        if at_bottom and at_top:
            delta = max(a['y'] for a in at_top) - min(a['y'] for a in at_bottom)
        reason = None
        if not (at_bottom and at_top):
            reason = f'no walkable nav at both ends (bottom={len(at_bottom)}, top={len(at_top)})'
        elif delta is None or abs(delta) < 1.0:
            reason = f'ends at the same height (delta={delta})'
        elif min(ladder.get('halfWidth', 0), ladder.get('halfDepth', 0)) > 0.9:
            reason = 'footprint too wide to be a player route'
        (kept if reason is None else dropped).append(ladder if reason is None else (ladder, reason))
        if verbose:
            state = 'keep' if reason is None else f'drop ({reason})'
            print(f"  ladder {ladder['id']}: {state} "
                  f"x={ladder['x']} z={ladder['z']} bottom={ladder['bottom']} top={ladder['top']}", flush=True)
    return [l for l in kept], dropped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--map', dest='map_id', default='de_dust2')
    parser.add_argument('--source', default=None, help='Directory holding <map>.mesh/.nav')
    parser.add_argument('--ladders', default=None, help='Candidate ladder volumes from extract-map-ladders.mjs')
    parser.add_argument('--site-radius', type=float, default=6.1)
    args = parser.parse_args()

    map_id = args.map_id
    out = ROOT / 'public' / 'assets' / 'maps' / map_id
    source = pathlib.Path(args.source) if args.source else out
    out.mkdir(parents=True, exist_ok=True)

    # --- collision triangle soup -------------------------------------------
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    data = (source / f'{map_id}.mesh').read_bytes()
    magic, version, nv, nt = struct.unpack_from('<4sIII', data)
    assert magic == b'AWMH' and version == 1
    vertices = np.frombuffer(data, dtype='<f4', offset=16, count=nv * 3).reshape(-1, 3)
    indices = np.frombuffer(data, dtype='<u4', offset=16 + nv * 12, count=nt * 3).reshape(-1, 3)
    world = vertices[:, [0, 2, 1]].astype(np.float64) * SCALE
    world[:, 2] *= -1
    triangles = world[indices]
    norm = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    valid = np.linalg.norm(norm, axis=1) > .00001
    triangles = triangles[valid]
    positions = np.round(triangles, 4).reshape(-1).tolist()
    (out / 'positions.f32').write_bytes(np.array(positions, dtype='<f4').tobytes())

    centers = triangles.mean(axis=1)
    norm = norm[valid]
    normals = norm / np.linalg.norm(norm, axis=1)[:, None]
    materials = np.ones(len(triangles), dtype=np.uint8)
    materials[normals[:, 1] > .68] = 0
    materials[normals[:, 1] < -.65] = 5
    edgea = np.concatenate([indices[:, 0], indices[:, 1], indices[:, 2]])
    edgeb = np.concatenate([indices[:, 1], indices[:, 2], indices[:, 0]])
    count, labels = connected_components(coo_matrix((np.ones(len(edgea)), (edgea, edgeb)), shape=(nv, nv)), directed=False)
    islands = labels[indices[:, 0]][valid]
    for c in range(count):
        verts = world[labels == c]
        extent = np.ptp(verts, axis=0)
        if len(verts) > 8 and .55 < extent[1] < 3.9 and max(extent[0], extent[2]) < 6 and min(extent[0], extent[2]) > .15:
            materials[islands == c] = 3
            if len(verts) > 85 and 1 < extent[1] < 2 and min(extent[0], extent[2]) > 2.2 and max(extent[0], extent[2]) > 4:
                materials[islands == c] = 4
    (out / 'materials.u8').write_bytes(materials.tobytes())

    # --- nav ---------------------------------------------------------------
    areas = parse_nav((source / f'{map_id}.nav').read_bytes())
    (out / 'nav-areas.json').write_text(json.dumps(areas, separators=(',', ':')))
    print('nav hulls', {h: sum(a['hull'] == h for a in areas) for h in set(a['hull'] for a in areas)}, flush=True)

    def polyarea(a):
        q = a['corners']
        return abs(sum(q[i][0] * q[(i + 1) % len(q)][2] - q[(i + 1) % len(q)][0] * q[i][2] for i in range(len(q)))) / 2

    bounds = {
        'min': {k: min(a[k] for a in areas) for k in ('x', 'y', 'z')},
        'max': {k: max(a[k] for a in areas) for k in ('x', 'y', 'z')},
    }
    bounds['minX'], bounds['maxX'] = bounds['min']['x'], bounds['max']['x']
    bounds['minY'], bounds['maxY'] = bounds['min']['y'], bounds['max']['y']
    bounds['minZ'], bounds['maxZ'] = bounds['min']['z'], bounds['max']['z']

    mapdata = {
        'name': map_id, 'id': map_id, 'metersPerSourceUnit': SCALE,
        'bounds': bounds, 'nav': [{k: a[k] for k in ('id', 'x', 'y', 'z', 'neighbors')} for a in areas],
    }
    (out / 'map-data.json').write_text(json.dumps(mapdata, separators=(',', ':')), encoding='utf8')
    print(json.dumps({'map': map_id, 'triangles': len(triangles), 'navAreas': len(areas),
                      'bounds': bounds, 'out': str(out)}, ensure_ascii=False), flush=True)

    if args.ladders:
        candidates = json.loads(pathlib.Path(args.ladders).read_text())['ladders']
        print(f'pruning {len(candidates)} ladder candidate(s) against {len(areas)} nav areas:', flush=True)
        kept, dropped = prune_ladders(candidates, areas)
        print(f'ladders: kept {len(kept)}, dropped {len(dropped)}', flush=True)
        (out / 'ladders.json').write_text(json.dumps({'ladders': kept}, indent=2), encoding='utf8')


if __name__ == '__main__':
    main()
