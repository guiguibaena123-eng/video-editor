"""Atualização incremental do grafo do Video Editor (só código muda: sem LLM)."""
import json
import shutil
import sys
from pathlib import Path

from graphify.detect import detect_incremental, save_manifest
from graphify.extract import collect_files, extract
from graphify.build import build_merge, build_from_json
from graphify.cluster import cluster, score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions, graph_diff
from graphify.report import generate
from graphify.export import to_json
from graphify.cli import _stamped_manifest_files
from networkx.readwrite import json_graph

ROOT = sys.argv[1]
OUT = Path(ROOT) / 'graphify-out'


def main():
    r = detect_incremental(Path(ROOT))
    new_files = r.get('new_files', {})
    deleted = list(r.get('deleted_files', []))
    changed = [f for fl in new_files.values() for f in fl]
    print(f'changed={len(changed)} deleted={len(deleted)}')
    for f in changed:
        print('  ~', f.replace(ROOT, ''))
    if not changed and not deleted:
        print('Nada mudou.')
        return
    non_code = [f for t, fl in new_files.items() if t != 'code' for f in fl]
    if non_code:
        print('ATENÇÃO: arquivos não-código mudaram (precisam de extração semântica):', non_code)
        # --code-only: atualiza só o código agora; os documentos ficam para a extração semântica.
        if '--code-only' not in sys.argv:
            raise SystemExit(2)
        for t in list(new_files):
            if t != 'code':
                new_files[t] = []

    code = []
    for f in new_files.get('code', []):
        code.extend(collect_files(Path(f)) if Path(f).is_dir() else [Path(f)])
    new_extraction = extract(code, cache_root=Path(ROOT)) if code else {'nodes': [], 'edges': [], 'hyperedges': []}
    new_extraction.setdefault('input_tokens', 0)
    new_extraction.setdefault('output_tokens', 0)

    old = json.loads((OUT / 'graph.json').read_text(encoding='utf-8'))
    G = build_merge([new_extraction], graph_path=str(OUT / 'graph.json'), prune_sources=deleted or None, root=ROOT, directed=False)
    merged = {
        'nodes': [{'id': n, **d} for n, d in G.nodes(data=True)],
        'edges': [{**{k: v for k, v in d.items() if k not in ('_src', '_tgt', 'source', 'target')}, 'source': d.get('_src', u), 'target': d.get('_tgt', v)} for u, v, d in G.edges(data=True)],
        'hyperedges': list(G.graph.get('hyperedges', [])),
        'input_tokens': 0,
        'output_tokens': 0,
    }
    (OUT / '.graphify_extract.json').write_text(json.dumps(merged, ensure_ascii=False), encoding='utf-8')

    mf = _stamped_manifest_files(r['files'], new_extraction, Path(ROOT))
    save_manifest(mf, root=ROOT, scan_corpus={f for fl in r['files'].values() for f in fl})

    G2 = build_from_json(merged, root=ROOT, directed=False)
    communities = cluster(G2)
    cohesion = score_all(G2, communities)
    gods = god_nodes(G2)
    surprises = surprising_connections(G2, communities)
    labels = {cid: f'Community {cid}' for cid in communities}
    questions = suggest_questions(G2, communities, labels)
    detection = {'files': r['files'], 'total_files': sum(len(v) for v in r['files'].values()), 'total_words': r.get('total_words', 0), 'skipped_sensitive': []}
    if not to_json(G2, communities, str(OUT / 'graph.json')):
        print('shrink guard: grafo novo menor que o anterior')
        raise SystemExit(1)
    (OUT / 'GRAPH_REPORT.md').write_text(generate(G2, communities, cohesion, labels, gods, surprises, detection, {'input': 0, 'output': 0}, ROOT, suggested_questions=questions), encoding='utf-8')
    (OUT / '.graphify_analysis.json').write_text(json.dumps({'communities': {str(k): v for k, v in communities.items()}, 'cohesion': {str(k): v for k, v in cohesion.items()}, 'gods': gods, 'surprises': surprises, 'detection': detection}, ensure_ascii=False), encoding='utf-8')

    diff = graph_diff(json_graph.node_link_graph(old, edges='links'), G2)
    print(diff['summary'])
    if diff['new_nodes']:
        print('Novos nós:', ', '.join(n['label'] for n in diff['new_nodes'][:12]))
    print(f'Graph: {G2.number_of_nodes()} nodes, {G2.number_of_edges()} edges, {len(communities)} communities')
    for cid, members in sorted(communities.items(), key=lambda kv: -len(kv[1])):
        files = sorted({Path(str(G2.nodes[m].get('source_file', ''))).name for m in members})
        print(f'[{cid}] n={len(members)} coh={cohesion[cid]:.2f} {files[:7]} :: {[G2.nodes[m].get("label", m) for m in members][:8]}')


if __name__ == '__main__':
    main()
