"""Marca no manifesto que todos os arquivos atuais já estão no grafo (usar depois de atualizar os nós do documento)."""
import json
import sys
from pathlib import Path

from graphify.detect import detect_incremental, save_manifest
from graphify.cli import _stamped_manifest_files

ROOT = sys.argv[1]
r = detect_incremental(Path(ROOT))
g = json.loads((Path(ROOT) / 'graphify-out' / 'graph.json').read_text(encoding='utf-8'))
ext = {'nodes': g['nodes'], 'edges': g.get('links') or g.get('edges')}
save_manifest(_stamped_manifest_files(r['files'], ext, Path(ROOT)), root=ROOT, scan_corpus={f for fl in r['files'].values() for f in fl})
print('manifesto atualizado')
