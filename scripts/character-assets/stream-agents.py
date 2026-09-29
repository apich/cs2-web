"""Streaming agent export: export -> pack -> delete the raw GLB.

The raw S2V GLBs are ~1.1 GB each because every texture is embedded at full
resolution. `pack.py`'s `packed_model` trims to the third-person body mesh and
downsamples textures, landing at ~5 MB. Doing both in one pass keeps the working
set small so a 61-agent run fits in a few hundred megabytes instead of ~74 GB.

Only one Source2Viewer may run at a time (artifacts/s2v-export.lock).
"""
import json, os, pathlib, subprocess, sys, time
ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/character-assets'))
import pack as P

STAGE=ROOT/'artifacts/characters-cs2'
DEST=ROOT/'public/assets/characters-cs2'
GAME=os.environ.get('CS2_GAME_DIR','E:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive/game/csgo')
VPK=pathlib.Path(GAME)/'pak01_dir.vpk'
CLI=ROOT/'tools/source2viewer/Source2Viewer-CLI.exe'
TEMP=ROOT/'artifacts/export-temp'
LOCK=ROOT/'artifacts/s2v-export.lock'
INDEX=STAGE/'full-agents-source-index.json'

specs=json.loads(INDEX.read_text(encoding='utf-8'))['agents']
os.makedirs(TEMP,exist_ok=True)

def pid_alive(pid):
    if not pid: return False
    try:
        import ctypes
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, int(pid))
        if not handle: return False
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    except Exception:
        return False

def acquire():
    for _ in range(900):
        # A lock left behind by a killed process is stale; reclaim it.
        if LOCK.exists():
            try:
                meta=json.loads(LOCK.read_text(encoding="utf-8"))
                if not pid_alive(meta.get("pid")):
                    LOCK.unlink(missing_ok=True); continue
            except Exception:
                LOCK.unlink(missing_ok=True); continue
        try:
            fd=os.open(LOCK,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
            os.write(fd,json.dumps({'pid':os.getpid(),'task':'stream-agents','startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}).encode())
            return fd
        except FileExistsError:
            time.sleep(2)
    raise RuntimeError('Timed out waiting for the export lock')

def valid_glb(path):
    if not path.exists(): return False
    b=path.read_bytes()[:12]
    return b[:4]==b'glTF' and int.from_bytes(b[8:12],'little')==path.stat().st_size

def run(resource,out,model=False):
    if out.exists() and (model and valid_glb(out) or not model):
        print('existing '+str(out.relative_to(STAGE)),flush=True); return
    out.parent.mkdir(parents=True,exist_ok=True)
    args=['-i',str(VPK),'-f',resource,'-o',str(out),'-d','--game',str(pathlib.Path(GAME)/'gameinfo.gi')]
    if model: args+=['--gltf_export_format','glb','--gltf_export_animations','--gltf_export_materials','--gltf_textures_adapt','--gltf_export_extras']
    log=open(str(out)+'.log','w')
    try:
        r=subprocess.run([str(CLI)]+args,stdout=log,stderr=log,env={**os.environ,'TEMP':str(TEMP),'TMP':str(TEMP)},timeout=360)
    finally:
        log.close()
    if r.returncode: raise RuntimeError(f'Export {resource} -> {r.returncode}')

done=skipped=0
fd=acquire()
try:
    for spec in specs:
        id_=spec['id']; team=spec['team']; source=spec['source']; stem=source.split('/')[1]
        raw_dir=STAGE/'raw'/id_
        raw_glb=raw_dir/(id_+'.glb')
        packed=DEST/'optional'/(id_+'.glb')
        preview_png=STAGE/'previews'/(id_+'.png')
        preview_webp=DEST/'previews'/(id_+'.webp')

        # Already packed and the raw source is gone: nothing to do.
        if packed.exists() and not raw_glb.exists():
            skipped+=1; continue

        # 1. Export the raw model if we do not already have it.
        if not valid_glb(raw_glb):
            run('agents/models/'+source+'.vmdl_c',raw_glb,True)

        # 2. Export the inventory preview if missing.
        if not preview_png.exists():
            run('panorama/images/econ/characters/customplayer_'+stem+'_png.vtex_c',preview_png)

        # 3. Pack into the trimmed runtime GLB.
        packed.parent.mkdir(parents=True,exist_ok=True)
        P.packed_model(team,id_,'optional/'+id_+'.glb')

        # 4. Convert the preview to webp.
        if preview_png.exists() and not preview_webp.exists():
            from PIL import Image
            preview_webp.parent.mkdir(parents=True,exist_ok=True)
            im=Image.open(preview_png).convert('RGBA'); im.thumbnail((512,512),Image.Resampling.LANCZOS)
            im.save(preview_webp,'WEBP',quality=94)

        # 5. Drop the 1.1 GB raw GLB immediately.
        raw_glb.unlink(missing_ok=True)
        (raw_dir/(id_+'.glb.log')).unlink(missing_ok=True)
        for aux in raw_dir.glob('*.png'):
            aux.unlink(missing_ok=True)
        for aux in raw_dir.glob('*_physics.glb'):
            aux.unlink(missing_ok=True)
        if raw_dir.exists() and not any(raw_dir.iterdir()):
            raw_dir.rmdir()
        done+=1
        print(f'packed {id_} ({packed.stat().st_size/1048576:.1f} MB)',flush=True)
finally:
    os.close(fd); LOCK.unlink(missing_ok=True)

print(f'done: packed {done}, already-complete {skipped}',flush=True)
