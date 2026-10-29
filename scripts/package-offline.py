"""Build a dependency-free, single-file editor and its downloadable ZIP."""
from pathlib import Path
import re
import zipfile

root = Path(__file__).resolve().parents[1]
html = (root / 'dist/index.html').read_text()
styles = []
for name in ['style.css', 'dark.css', 'fuels.css', 'image-import.css', 'project-library.css', 'operations.css']:
    styles.append(re.sub(r'@import[^;]+;', '', (root / 'dist' / name).read_text()))
html = re.sub(r'<link rel="stylesheet" href="[^\"]+">', '', html)
html = html.replace('</head>', '<style>' + '\n'.join(styles) + '</style></head>')
modules = []
for filename, export in [('flow.js', 'computeFlow'), ('pipe-runs.js', 'commitPipeRun'), ('pipes.js', 'pipePath'), ('pipe-order.js', 'normalizePipeLayer,pipeDrawOrder,reorderPipes'), ('symbols.js', 'referenceSymbol'), ('image-draft.js', 'analyzeImage,readImage'), ('reference-layout.js', 'normalizeReference,transformReference'), ('project-store.js', 'createProjectStore'), ('operations.js', 'normalizeOperations,captureOperation,applyOperation,operationMatches,topologySignature'), ('project-library.js', 'setupProjectLibrary'), ('operation-panel.js', 'setupOperationPanel')]:
    source = re.sub(r'^import[^\n]+\n', '', (root / 'dist' / filename).read_text(), flags=re.M).replace('export ', '')
    modules.append('const {' + export + '} = (()=>{\n' + source + '\nreturn {' + export + '};\n})();')
app = re.sub(r'^import[^\n]+\n', '', (root / 'dist/app.js').read_text(), flags=re.M)
html = re.sub(r'<script type="module" src="app.js[^\"]*"></script>', lambda _: '<script type="module">' + '\n'.join(modules) + '\n' + app + '</script>', html)
html = re.sub(r'<a class="offline-download"[^>]*>[^<]*</a>', '', html)
portable = root / 'portable'
portable.mkdir(exist_ok=True)
output = portable / '油路工坊.html'
output.write_text(html)
with zipfile.ZipFile(root / 'dist/oil-flow-studio.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.write(output, output.name)
    archive.write(root / 'README.md', '使用說明.md')
print('Offline HTML and ZIP updated.')
