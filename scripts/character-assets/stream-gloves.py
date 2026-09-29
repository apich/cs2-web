"""Streaming glove bake: decompile each paint -> bake -> merge into arms+glove GLB.

Produces one complete `arms+glove` GLB per glove paint under
`public/assets/viewmodel/gloves/<paintId>.glb`, matching how weapon skins ship
one self-contained GLB per skin.

Generalises scripts/character-assets/pack-gloves.py: every value that script
hardcodes for sporty_green is read from the paint's own decompiled `.vmat`:
  g_vColorTint1..8                    palette
  g_fDetailRoughnessBrightness1..4    per-layer roughness
  g_fDetailScale1..4                  per-layer tiling
  TextureDetail1..4                   per-layer textile (order = mask channels)
  TexturePattern + g_fPatternTexCoord{Scale,Rotation}   logo layer
The mask/AO come with the paint decompile; the mesh is the model's viewmodel.

Only one Source2Viewer runs at a time (artifacts/s2v-export.lock).
"""
import io, json, os, pathlib, re, struct, subprocess, sys, time
import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts' / 'character-assets'))
from pack import ROOT as _, write_glb

STAGE = ROOT / 'artifacts' / 'characters-cs2' / 'gloves'
MODELS = STAGE / 'models'
DEST = ROOT / 'public' / 'assets' / 'viewmodel' / 'gloves'
ARMS = ROOT / 'artifacts' / 'viewmodel' / 'arms.glb'
GAME = os.environ.get('CS2_GAME_DIR', 'E:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive/game/csgo')
VPK = pathlib.Path(GAME) / 'pak01_dir.vpk'
CLI = ROOT / 'tools' / 'source2viewer' / 'Source2Viewer-CLI.exe'
TEMP = ROOT / 'artifacts' / 'export-temp'
LOCK = ROOT / 'artifacts' / 's2v-export.lock'
INDEX = STAGE / 'gloves-source-index.json'

# The AO filename always names the glove model. It may be prefixed
# (`glove_bloodhound_ao`) or suffixed (`sporty_glove_ao`), so match on the
# model's short name. operation10 paints are the one case where the paint prefix
# and the model differ (they wear broken fang).
def model_for(paint, ao_name):
    candidates = []
    for cand in MODELS.glob('glove_*.glb'):
        short = cand.stem.replace('glove_', '')
        if short and short in ao_name:
            candidates.append((len(short), cand.stem))
    if candidates:
        return max(candidates)[1]
    raise RuntimeError('Cannot resolve glove model for ' + paint + ' (ao=' + ao_name + ')')


def read_glb(path):
    b = path.read_bytes()
    jl = struct.unpack_from('<I', b, 12)[0]
    return json.loads(b[20:20 + jl]), b[28 + jl:28 + jl + struct.unpack_from('<I', b, 20 + jl)[0]]


def params_of(vmat_text):
    return dict(re.findall(r'"([^"\n]+)"\s+"([^"\n]*)"', vmat_text))


def bake(paint_id, workdir, params):
    """Bake palette + mask + textiles into <paint>-color.jpg and <paint>-orm.png."""
    n = 1024

    def fvec(key, default='0 0 0'):
        return [float(v) for v in params.get(key, default).strip('[]').split()]

    palette = np.array([[fvec(f'g_vColorTint{i}', '0 0 0')[:3] for i in range(1, 9)]], dtype=np.float32)[0]
    mask_file = next(workdir.glob('*mask*.png'))
    ao_file = next(workdir.glob('*_ao.png'))
    mask = np.asarray(Image.open(mask_file).convert('RGBA').resize((n, n)), dtype=np.float32) / 255
    surface = np.asarray(Image.open(ao_file).convert('RGBA').resize((n, n), Image.Resampling.LANCZOS), dtype=np.float32) / 255

    indices = np.minimum(7, (mask[:, :, 3] * 8).astype(int))
    color = palette[indices]

    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    u = (x + .5) / n - .5
    v = (y + .5) / n - .5
    angle = np.deg2rad(float(params.get('g_fPatternTexCoordRotation', '30')))
    pscale = float(params.get('g_fPatternTexCoordScale', '9'))
    pu = (u * np.cos(angle) - v * np.sin(angle)) * pscale
    pv = (u * np.sin(angle) + v * np.cos(angle)) * pscale

    pattern_file = params.get('TexturePattern', '')
    pattern_path = workdir / pathlib.Path(pattern_file).name if pattern_file else None
    # materials/default/default.tga and friends are placeholders that never
    # ship as content; without real pattern artwork the logo layer is skipped.
    if pattern_path and pattern_path.exists():
        pattern = np.asarray(Image.open(pattern_path).convert('RGB'), dtype=np.float32) / 255
        sample = pattern[(np.mod(pv, 1) * pattern.shape[0]).astype(int), (np.mod(pu, 1) * pattern.shape[1]).astype(int)]
        weights = np.concatenate([np.clip(1 - sample.sum(axis=2, keepdims=True), 0, 1), sample], axis=2)
        pattern_colors = palette[np.array([8, 3, 3, 3]) - 1]
        pattern_color = weights @ pattern_colors
        color = np.where((indices == 7)[:, :, None], pattern_color, color)

    layer = np.concatenate([np.clip(1 - mask[:, :, :3].sum(axis=2, keepdims=True), 0, 1), mask[:, :, :3]], axis=2)
    detail = np.zeros((n, n), dtype=np.float32)
    rough = np.zeros((n, n), dtype=np.float32)
    for i in range(4):
        rel = params.get(f'TextureDetail{i + 1}')
        if not rel:
            continue
        tex = np.asarray(Image.open(workdir / pathlib.Path(rel).name).convert('RGBA'), dtype=np.float32) / 255
        scale = float(params.get(f'g_fDetailScale{i + 1}', '2.5'))
        d = tex[(np.mod((v + .5) * scale, 1) * tex.shape[0]).astype(int), (np.mod((u + .5) * scale, 1) * tex.shape[1]).astype(int)]
        detail += layer[:, :, i] * (.91 + .12 * d[:, :, 0])
        rb = float(params.get(f'g_fDetailRoughnessBrightness{i + 1}', '.8'))
        rough += layer[:, :, i] * np.clip(rb * (.6 + d[:, :, 1] * .35), .25, .95)

    color = color * detail[:, :, None]
    ao = np.clip(surface[:, :, 1], .35, 1)
    workdir.joinpath(paint_id + '-color.jpg').write_bytes(b'')
    Image.fromarray(np.uint8(np.clip(color, 0, 1) * 255)).save(workdir / (paint_id + '-color.jpg'), quality=95, subsampling=0)
    orm = np.stack([ao, rough, np.zeros_like(ao)], axis=2)
    Image.fromarray(np.uint8(np.clip(orm, 0, 1) * 255)).save(workdir / (paint_id + '-orm.png'), optimize=True)


def pack(paint_id, model_name, workdir, params, out_path):
    arms, ab = read_glb(ARMS)
    gloves, gb = read_glb(MODELS / (model_name + '.glb'))
    out = {k: __import__('copy').deepcopy(arms[k]) for k in ['asset', 'scenes', 'nodes']}
    out.update({'meshes': [], 'skins': [], 'accessors': [], 'bufferViews': [], 'materials': [], 'textures': [], 'images': []})

    # meshes[1] / skins[1] are the viewmodel pair for every glove model.
    source_mesh = __import__('copy').deepcopy(gloves['meshes'][1])
    source_skin = __import__('copy').deepcopy(gloves['skins'][1])
    name_map = {n['name']: i for i, n in enumerate(arms['nodes'])}
    aliases = {}
    for i, old_node in enumerate(source_skin['joints']):
        name = gloves['nodes'][old_node]['name']
        target = name
        if target not in name_map and '_TWIST' in target:
            parent_name = target.split('_TWIST')[0]
            if parent_name not in name_map:
                raise RuntimeError('Missing twist parent ' + parent_name)
            name_map[target] = len(out['nodes'])
            node = __import__('copy').deepcopy(gloves['nodes'][old_node])
            node.pop('children', None)
            out['nodes'].append(node)
            out['nodes'][name_map[parent_name]].setdefault('children', []).append(name_map[target])
            aliases[name] = parent_name
        if target not in name_map:
            raise RuntimeError('Missing compatible arm joint ' + name)
        source_skin['joints'][i] = name_map[target]

    ids = {source_skin['inverseBindMatrices']}
    for p in source_mesh['primitives']:
        ids.update(p['attributes'].values())
        ids.add(p['indices'])
    blob = bytearray()
    accessor_map, view_map = {}, {}
    for i in sorted(ids):
        a = __import__('copy').deepcopy(gloves['accessors'][i])
        vi = a['bufferView']
        v = gloves['bufferViews'][vi]
        if vi not in view_map:
            blob.extend(b'\0' * (-len(blob) % 4))
            view_map[vi] = len(out['bufferViews'])
            out['bufferViews'].append({**v, 'buffer': 0, 'byteOffset': len(blob)})
            offset = v.get('byteOffset', 0)
            blob.extend(gb[offset:offset + v['byteLength']])
        a['bufferView'] = view_map[vi]
        accessor_map[i] = len(out['accessors'])
        out['accessors'].append(a)
    for p in source_mesh['primitives']:
        p['attributes'] = {k: accessor_map[v] for k, v in p['attributes'].items()}
        p['indices'] = accessor_map[p['indices']]
    source_skin['inverseBindMatrices'] = accessor_map[source_skin['inverseBindMatrices']]
    out['skins'] = [source_skin]
    out['meshes'] = [source_mesh]
    mesh_node = next(node for node in out['nodes'] if 'mesh' in node)
    mesh_node.update({'name': paint_id, 'mesh': 0, 'skin': 0})

    image_cache = {}
    NEUTRAL = None

    def texture(path, color=False, limit=1024):
        """Bake one image. Bare-arm textures live beside the model GLB, and a few
        materials reference placeholders that were never exported; those fall back
        to a neutral plate rather than failing the whole glove."""
        nonlocal NEUTRAL
        if path is not None and not path.exists():
            alt = MODELS / path.name
            if alt.exists():
                path = alt
        key = str(path) if path and path.exists() else 'neutral'
        if key in image_cache:
            return image_cache[key]
        if path and path.exists():
            pixels = Image.open(path).convert('RGB')
        else:
            if NEUTRAL is None:
                NEUTRAL = Image.new('RGB', (4, 4), (128, 128, 128))
            pixels = NEUTRAL.copy()
        pixels.thumbnail((limit, limit), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        pixels.save(buf, format='JPEG' if color else 'PNG', **({'quality': 95, 'subsampling': 0} if color else {'optimize': True}))
        data = buf.getvalue()
        blob.extend(b'\0' * (-len(blob) % 4))
        image_index = len(out['images'])
        name = path.name if path and path.exists() else 'neutral.png'
        out['images'].append({'name': name, 'bufferView': len(out['bufferViews']), 'mimeType': 'image/jpeg' if color else 'image/png'})
        out['bufferViews'].append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data)})
        blob.extend(data)
        index = len(out['textures'])
        out['textures'].append({'source': image_index})
        image_cache[key] = index
        return index

    paint_color = texture(workdir / (paint_id + '-color.jpg'), True)
    normal_file = next(workdir.glob('*normal*.png'), None)
    paint_normal = texture(normal_file) if normal_file else None
    paint_orm = texture(workdir / (paint_id + '-orm.png'))

    # Left/right glove materials share the baked paint; the bare-arm material is
    # copied from the model, located by name because its index differs per model.
    bare = next((m for m in gloves['materials'] if 'bare_arm' in (m.get('name') or '')), None)
    if bare is None:
        raise RuntimeError('No bare_arm material in ' + model_name)
    for side in ['left', 'right']:
        mat = {'name': f'{paint_id} ({side})', 'pbrMetallicRoughness': {
            'baseColorTexture': {'index': paint_color},
            'metallicRoughnessTexture': {'index': paint_orm}, 'metallicFactor': 0, 'roughnessFactor': 1},
            'occlusionTexture': {'index': paint_orm},
            'extras': {'wear': .06, 'normalizedWear': 0, 'exterior': 'Factory New', 'sourceMaterial': f'gloves/paints/{paint_id}.vmat'}}
        if paint_normal is not None:
            mat['normalTexture'] = {'index': paint_normal}
        out['materials'].append(mat)

    m = __import__('copy').deepcopy(bare)
    m.pop('extras', None)
    for parent, key, color in [(m['pbrMetallicRoughness'], 'baseColorTexture', True), (m['pbrMetallicRoughness'], 'metallicRoughnessTexture', False), (m, 'normalTexture', False), (m, 'occlusionTexture', False)]:
        if key in parent:
            image = gloves['images'][gloves['textures'][parent[key]['index']]['source']]
            parent[key]['index'] = texture(workdir / pathlib.Path(image['uri']).name, color)
    out['materials'].append(m)

    out['extras'] = {'gloves': paint_id, 'paintkit': params.get('g_vColorTint1', '')[:0] or None,
                     'exterior': 'Factory New', 'wear': .06, 'normalizedWear': 0,
                     'sourceMaterial': f'gloves/paints/{paint_id}.vmat',
                     'sourceModel': f'agents/models/shared/arms/{model_name}/{model_name}.vmdl_c:viewmodel',
                     'skeleton': 'Original weapon_arms skeleton with authored wpn/hand/finger animation joints',
                     'additionalTwistBones': aliases,
                     'rendering': 'PBR bake using original mesh, 8-color palette, textile masks, logo pattern, normal and AO. No additional damage or grunge.'}
    write_glb(out_path, out, blob)
    return len(blob), aliases


def acquire():
    for _ in range(900):
        if LOCK.exists():
            try:
                meta = json.loads(LOCK.read_text(encoding='utf-8'))
                if not meta.get('pid'):
                    LOCK.unlink(missing_ok=True)
                    continue
                os.kill(meta['pid'], 0)
            except Exception:
                LOCK.unlink(missing_ok=True)
                continue
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, json.dumps({'pid': os.getpid(), 'task': 'stream-gloves', 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}).encode())
            return fd
        except FileExistsError:
            time.sleep(2)
    raise RuntimeError('Timed out waiting for the export lock')


def decompile(paint, workdir):
    workdir.mkdir(parents=True, exist_ok=True)
    out = workdir / (paint + '.vmat')
    log = open(str(workdir / 'decompile.log'), 'w')
    try:
        r = subprocess.run([str(CLI), '-i', str(VPK), '-f', f'gloves/paints/{paint}.vmat_c', '-o', str(out), '-d'], stdout=log, stderr=log, env={**os.environ, 'TEMP': str(TEMP), 'TMP': str(TEMP)}, timeout=180)
    finally:
        log.close()
    if r.returncode or not out.exists():
        raise RuntimeError('Decompile failed for ' + paint)


def main():
    paints = json.loads(INDEX.read_text(encoding='utf-8'))['paints']
    ids = [pathlib.Path(p).stem for p in paints]
    # _shared_paint_generic is a template, not a wearable finish.
    ids = [i for i in ids if not i.startswith('_')]
    os.makedirs(TEMP, exist_ok=True)
    DEST.mkdir(parents=True, exist_ok=True)
    done = skipped = failed = 0
    failures = []
    fd = acquire()
    try:
        for paint in ids:
            out_path = DEST / (paint + '.glb')
            if out_path.exists():
                skipped += 1
                continue
            workdir = STAGE / 'work' / paint
            try:
                decompile(paint, workdir)
                vmat_text = (workdir / (paint + '.vmat')).read_text(encoding='utf-8', errors='replace')
                params = params_of(vmat_text)
                bake(paint, workdir, params)
                ao_name = next(workdir.glob('*_ao.png')).name
                model_name = model_for(paint, ao_name)
                nbytes, aliases = pack(paint, model_name, workdir, params, out_path)
                done += 1
                print(f'packed {paint} ({nbytes / 1048576:.2f} MB, {model_name})', flush=True)
            except Exception as e:
                failed += 1
                failures.append((paint, str(e)[:120]))
                print(f'FAIL {paint}: {e}', flush=True)
            finally:
                for f in workdir.glob('*'):
                    f.unlink(missing_ok=True)
                if workdir.exists():
                    workdir.rmdir()
    finally:
        os.close(fd)
        LOCK.unlink(missing_ok=True)

    print(f'\ndone: packed {done}, already {skipped}, failed {failed}', flush=True)
    for p, why in failures:
        print(f'  {p}: {why}', flush=True)


if __name__ == '__main__':
    main()
