"""Aplica nomes às comunidades, regenera o relatório e limpa os temporários."""
import json
import sys
from pathlib import Path

from graphify.build import build_from_json
from graphify.analyze import suggest_questions
from graphify.report import generate
from graphify.export import to_json

ROOT = sys.argv[1]
LABELS = {int(k): v for k, v in json.loads(Path(sys.argv[2]).read_text(encoding="utf-8")).items()}
OUT = Path(ROOT) / 'graphify-out'

extraction = json.loads((OUT / '.graphify_extract.json').read_text(encoding='utf-8'))
analysis = json.loads((OUT / '.graphify_analysis.json').read_text(encoding='utf-8'))
G = build_from_json(extraction, root=ROOT, directed=False)
communities = {int(k): v for k, v in analysis['communities'].items()}
cohesion = {int(k): v for k, v in analysis['cohesion'].items()}
questions = suggest_questions(G, communities, LABELS)
report = generate(G, communities, cohesion, LABELS, analysis['gods'], analysis['surprises'], analysis['detection'], {'input': 0, 'output': 0}, ROOT, suggested_questions=questions)
(OUT / 'GRAPH_REPORT.md').write_text(report, encoding='utf-8')
(OUT / '.graphify_labels.json').write_text(json.dumps({str(k): v for k, v in LABELS.items()}, ensure_ascii=False), encoding='utf-8')
print('graph.json' if to_json(G, communities, str(OUT / 'graph.json'), community_labels=LABELS) else 'SHRINK GUARD')
for name in ('.graphify_extract.json', '.graphify_analysis.json', '.graphify_detect.json', '.graphify_incremental.json'):
    (OUT / name).unlink(missing_ok=True)
