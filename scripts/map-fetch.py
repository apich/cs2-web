"""Fetch one map's members from the versioned Awpy source archives.

Game assets belong to Valve. This script uses standard ZIP byte ranges;
it neither downloads the game nor modifies installed game files.

Usage: python scripts/map-fetch.py --map de_mirage
"""
import argparse, io, json, pathlib, urllib.request, zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = 'https://github.com/pnxenopoulos/awpy-data/releases/download/2000905/'


class RemoteZip(io.RawIOBase):
    def __init__(self, url):
        with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=20) as response:
            self.url = response.url
            self.length = int(response.headers['Content-Length'])
        self.pos = 0
    def seekable(self): return True
    def tell(self): return self.pos
    def seek(self, n, whence=0):
        self.pos = n if whence == 0 else self.pos+n if whence == 1 else self.length+n
        return self.pos
    def read(self, n=-1):
        if n < 0: n = self.length-self.pos
        n = min(n, self.length-self.pos)
        if n <= 0: return b''
        request = urllib.request.Request(self.url, headers={'Range': f'bytes={self.pos}-{self.pos+n-1}'})
        with urllib.request.urlopen(request, timeout=40) as response:
            if response.status != 206: raise RuntimeError(f'Range unsupported: {response.status}')
            data = response.read()
        if len(data) != n: raise RuntimeError(f'Unexpected range {len(data)} != {n}')
        self.pos += n
        return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--map', dest='map_id', default='de_dust2', help='Map name, e.g. de_mirage')
    parser.add_argument('--out', default=None, help='Output directory (default public/assets/maps/<map>)')
    args = parser.parse_args()
    map_id = args.map_id

    out = pathlib.Path(args.out) if args.out else ROOT / 'public' / 'assets' / 'maps' / map_id
    out.mkdir(parents=True, exist_ok=True)

    for archive, suffix in [('geometry.zip', '.mesh'), ('navs.zip', '.nav')]:
        remote = RemoteZip(BASE+archive)
        with zipfile.ZipFile(remote) as z:
            member = next(n for n in z.namelist() if pathlib.PurePosixPath(n).name == map_id+suffix)
            info = z.getinfo(member)
            print(json.dumps({'archive': archive, 'member': member, 'size': info.file_size,
                              'compressed': info.compress_size}), flush=True)
            data = z.read(member)
            (out / (map_id+suffix)).write_bytes(data)
            print(f'Wrote {len(data)} bytes to {out / (map_id+suffix)}', flush=True)

    with urllib.request.urlopen(BASE+'manifest.json', timeout=20) as response:
        (out / 'source-manifest.json').write_bytes(response.read())
    print(json.dumps({'map': map_id, 'out': str(out)}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
