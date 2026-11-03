#!/usr/bin/env python3
"""Export, stage and verify shared data without putting private backups in Git.

No command changes the source service. `prepare` only writes a private import
directory; actual import uses the owner's authenticated Wrangler. Stop source
writes before the final export and keep them stopped through verified cutover.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid

FORMAT = 'oil-flow-cloud-backup-v1'
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)
HASH = re.compile(r'^[0-9a-f]{64}$')
META = ('id', 'name', 'revision', 'createdAt', 'updatedAt', 'nodeCount', 'edgeCount', 'operationCount')
FEEDBACK = ('id', 'name', 'title', 'category', 'body', 'createdAt')
USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
MAX_FILE_BYTES = 256 * 1024 * 1024
SNAPSHOT_CHUNK_BYTES = 32 * 1024


def snapshot_chunks(data):
    """Split UTF-8 JSON without splitting a code point or exceeding SQL limits."""
    offset = 0
    while offset < len(data):
        end = min(offset + SNAPSHOT_CHUNK_BYTES, len(data))
        while end < len(data) and end > offset and data[end] & 0xc0 == 0x80:
            end -= 1
        yield data[offset:end].decode('utf-8')
        offset = end


class MigrationError(Exception):
    pass


def fail(message):
    raise MigrationError(message)


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(value):
    # Key order is immaterial to verification; complete project values are not.
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def origin(value):
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme not in ('https', 'http') or not parsed.netloc or parsed.username
            or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in ('', '/')
            or (parsed.scheme == 'http' and parsed.hostname not in ('localhost', '127.0.0.1', '::1'))):
        fail('Service URL must be an HTTPS origin (HTTP is allowed only for local testing).')
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, '', '', ''))


def read_api(base, path):
    request = urllib.request.Request(base + path, headers={
        'Accept': 'application/json', 'User-Agent': USER_AGENT,
        'Origin': 'https://oil-flow-studio.vercel.app'})
    try:
        # urllib preserves the inherited session proxy and CA trust.
        with urllib.request.urlopen(request, timeout=45) as response:
            data = response.read(MAX_FILE_BYTES + 1)
            if len(data) > MAX_FILE_BYTES:
                fail('Service response is too large.')
            return json.loads(data)
    except (urllib.error.URLError, json.JSONDecodeError, UnicodeError) as error:
        # Do not echo a response body, private project, credential, or full URL.
        fail('Unable to read shared service; verify the origin, access and network. ' + type(error).__name__)


def collect(base, route, limit):
    result, cursors, cursor = [], set(), None
    while True:
        suffix = '?limit=' + str(limit) + ('&cursor=' + urllib.parse.quote(cursor, safe='') if cursor else '')
        page = read_api(base, route + suffix)
        if (not isinstance(page, dict) or not isinstance(page.get('items'), list)
                or type(page.get('total')) is not int or page['total'] < len(page['items'])):
            fail('Invalid service page; export aborted.')
        result.extend(page['items'])
        cursor = page.get('nextCursor')
        if not cursor:
            if len(result) != page['total']:
                fail('Service changed during pagination; stop writes and export again.')
            return result
        if not isinstance(cursor, str) or cursor in cursors or len(cursors) >= 10000:
            fail('Invalid or repeated service cursor.')
        cursors.add(cursor)


def canonical_metadata(item):
    if not isinstance(item, dict) or not all(field in item for field in META):
        fail('Incomplete drawing metadata.')
    return {field: item[field] for field in META}


def canonical_feedback(item):
    if not isinstance(item, dict) or not all(field in item for field in FEEDBACK):
        fail('Incomplete feedback record.')
    return {field: item[field] for field in FEEDBACK}


def metadata_set(items):
    return sorted((canonical_metadata(item) for item in items), key=lambda item: item['id'])


def feedback_set(items):
    return sorted((canonical_feedback(item) for item in items), key=lambda item: item['id'])


def valid_uuid(value):
    return isinstance(value, str) and UUID.fullmatch(value)


def number(value, minimum=0):
    return type(value) is int and minimum <= value <= 9007199254740991


def validate_bundle(bundle):
    if not isinstance(bundle, dict) or bundle.get('format') != FORMAT:
        fail('Not an Oil Flow cloud backup.')
    expected = bundle.get('checksum')
    if not isinstance(expected, str) or not HASH.fullmatch(expected):
        fail('Backup checksum is missing.')
    raw = {key: value for key, value in bundle.items() if key != 'checksum'}
    if digest(raw) != expected:
        fail('Backup checksum mismatch; do not import modified or incomplete data.')
    origin(bundle.get('source', ''))
    if not isinstance(bundle.get('drawings'), list) or not isinstance(bundle.get('feedback'), list):
        fail('Invalid backup records.')
    ids, names = set(), set()
    for drawing in bundle['drawings']:
        meta = canonical_metadata(drawing)
        name_key = unicodedata.normalize('NFKC', str(meta['name'])).strip().lower()
        name_key = re.sub(r'\s+', ' ', name_key)
        if (not valid_uuid(meta['id']) or meta['id'] in ids or name_key in names
                or not isinstance(meta['name'], str) or not meta['name'].strip()
                or len(meta['name']) > 80 or not number(meta['revision'], 1)):
            fail('Invalid or duplicate drawing identity.')
        ids.add(meta['id']); names.add(name_key)
        for field in META[3:]:
            if not number(meta[field]): fail('Invalid drawing counts or timestamps.')
        versions = drawing.get('versions')
        if (not isinstance(versions, list) or len(versions) != meta['revision']
                or any(not isinstance(version, dict) for version in versions)
                or sorted(v.get('revision', 0) for v in versions) != list(range(1, len(versions) + 1))):
            fail('Drawing history is incomplete or duplicated.')
        for version in versions:
            vmeta = canonical_metadata(version)
            project = version.get('project')
            if (vmeta['id'] != meta['id'] or not isinstance(project, dict)
                    or not isinstance(project.get('nodes'), list) or not isinstance(project.get('edges'), list)
                    or vmeta['nodeCount'] != len(project['nodes']) or vmeta['edgeCount'] != len(project['edges'])
                    or vmeta['operationCount'] != len(project.get('operations', []))):
                fail('Invalid history snapshot or count.')
            for field in META[2:]:
                if not number(vmeta[field], 1 if field == 'revision' else 0): fail('Invalid history metadata.')
            if not isinstance(vmeta['name'], str) or not vmeta['name'] or len(vmeta['name']) > 80:
                fail('Invalid history name.')
            if len(json_bytes(project)) > 24 * 1024 * 1024:
                fail('A history snapshot is over the supported import size.')
            provenance = version.get('provenance')
            if provenance is not None:
                if (not isinstance(provenance, dict) or not valid_uuid(provenance.get('requestId'))
                        or not HASH.fullmatch(str(provenance.get('requestHash', '')))
                        or not isinstance(provenance.get('objectKey'), str)
                        or not re.fullmatch(r'[a-zA-Z0-9_./-]{1,1024}', provenance['objectKey'])
                        or '..' in provenance['objectKey'].split('/')):
                    fail('Invalid private revision provenance.')
        latest = max(versions, key=lambda version: version['revision'])
        if canonical_metadata(latest) != meta:
            fail('Latest drawing and latest history metadata disagree.')
    feedback_ids = set()
    for item in bundle['feedback']:
        record = canonical_feedback(item)
        if (not valid_uuid(record['id']) or record['id'] in feedback_ids
                or record['category'] not in ('idea', 'bug', 'ui', 'other')
                or not number(record['createdAt'])
                or any(not isinstance(record[field], str) for field in ('name', 'title', 'body'))):
            fail('Invalid or duplicate feedback record.')
        feedback_ids.add(record['id'])
    return bundle


def export_data(source, provenance=None):
    source = origin(source)
    heads = collect(source, '/api/drawings', 100)
    comments = collect(source, '/api/feedback', 200)
    revisions = {}
    if provenance is not None:
        rows = provenance.get('drawing_revisions') if isinstance(provenance, dict) else None
        if not isinstance(rows, list): fail('Provenance needs drawing_revisions rows.')
        for row in rows:
            key = (row['drawing_id'], row['revision'])
            if key in revisions: fail('Duplicate private revision provenance.')
            revisions[key] = {'requestId': row['request_id'], 'requestHash': row['request_hash'], 'objectKey': row['object_key']}
    drawings = []
    for head in heads:
        identifier = canonical_metadata(head)['id']
        if not valid_uuid(identifier): fail('Invalid drawing ID returned by source.')
        history = collect(source, '/api/drawings/' + identifier + '/revisions', 100)
        snapshots = []
        for version in history:
            snapshot = read_api(source, '/api/drawings/' + identifier + '/revisions/' + str(version['revision']))
            if canonical_metadata(snapshot) != canonical_metadata(version):
                fail('History metadata changed during export.')
            snapshot = {**canonical_metadata(snapshot), 'project': snapshot['project']}
            if provenance is not None:
                if (identifier, version['revision']) not in revisions: fail('Missing private revision provenance.')
                snapshot['provenance'] = revisions[(identifier, version['revision'])]
            snapshots.append(snapshot)
        current = read_api(source, '/api/drawings/' + identifier)
        latest = max(snapshots, key=lambda version: version['revision']) if snapshots else None
        if not latest or canonical_metadata(current) != canonical_metadata(head) or digest(current['project']) != digest(latest['project']):
            fail('Drawing changed during export; stop writes and export again.')
        drawings.append({**canonical_metadata(head), 'versions': sorted(snapshots, key=lambda version: version['revision'])})
    if metadata_set(collect(source, '/api/drawings', 100)) != metadata_set(heads) or feedback_set(collect(source, '/api/feedback', 200)) != feedback_set(comments):
        fail('Source changed during export; stop writes and export again.')
    bundle = {'format': FORMAT, 'source': source, 'feedback': feedback_set(comments),
              'drawings': sorted(drawings, key=lambda drawing: drawing['id']),
              'requestProvenance': 'preserved' if provenance is not None else 'not-exposed-by-public-api'}
    bundle['checksum'] = digest(bundle)
    return validate_bundle(bundle)


def sql_value(value):
    if isinstance(value, str):
        return "CAST(X'" + value.encode('utf-8').hex() + "' AS TEXT)"
    if number(value): return str(value)
    fail('Unsupported SQL value in backup.')


def insert(table, columns, values):
    # Strict INSERT intentionally fails on any destination identity collision.
    return 'INSERT INTO ' + table + ' (' + ', '.join(columns) + ') VALUES (' + ', '.join(map(sql_value, values)) + ');\n'


def private_write(path, data):
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'wb') as output: output.write(data)


def prepare_import(bundle, destination, storage='r2'):
    validate_bundle(bundle)
    if storage not in ('d1', 'r2'):
        fail('Choose the target snapshot storage explicitly: d1 or r2.')
    destination = Path(destination).resolve()
    repository = Path(__file__).resolve().parents[1]
    if destination == repository or repository in destination.parents:
        fail('Private backup/import files must be outside the Git repository.')
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    objects_dir = destination / 'objects'
    if storage == 'r2': objects_dir.mkdir(mode=0o700)
    statements, objects, revision_count, chunk_count = [], [], 0, 0
    for item in bundle['feedback']:
        statements.append(insert('feedback', ['id','name','title','category','body','created_at'],
                                 [item[field] for field in FEEDBACK]))
    for drawing in bundle['drawings']:
        versions = []
        for version in sorted(drawing['versions'], key=lambda item: item['revision']):
            provenance = version.get('provenance')
            key = provenance['objectKey'] if provenance else f"migration/{bundle['checksum']}/{drawing['id']}/{version['revision']}.json"
            data = json_bytes(version['project'])
            revision_count += 1
            if storage == 'r2':
                filename = hashlib.sha256(key.encode()).hexdigest() + '.json'
                private_write(objects_dir / filename, data)
                objects.append({'key': key, 'file': 'objects/' + filename, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
            else:
                parts = list(snapshot_chunks(data))
                statements.append(insert('drawing_snapshot_objects', ['object_key','byte_length','chunk_count','created_at'],
                                         [key,len(data),len(parts),version['updatedAt']]))
                for index, part in enumerate(parts):
                    statements.append(insert('drawing_snapshot_chunks', ['object_key','chunk_index','body'], [key,index,part]))
                chunk_count += len(parts)
            request_id = provenance['requestId'] if provenance else str(uuid.uuid5(uuid.NAMESPACE_URL,
                         bundle['source'] + '/api/drawings/' + drawing['id'] + '/revisions/' + str(version['revision'])))
            request_hash = provenance['requestHash'] if provenance else digest({'migratedFrom': bundle['source'], 'snapshot': version})
            versions.append((version, key, request_id, request_hash))
        latest, latest_key, _, _ = versions[-1]
        name_key = re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', drawing['name']).strip()).lower()
        statements.append(insert('drawings', ['id','name','name_key','revision','created_at','updated_at','node_count','edge_count','operation_count','object_key'],
            [drawing['id'],drawing['name'],name_key,drawing['revision'],drawing['createdAt'],drawing['updatedAt'],drawing['nodeCount'],drawing['edgeCount'],drawing['operationCount'],latest_key]))
        for version, key, request_id, request_hash in versions:
            statements.append(insert('drawing_revisions', ['drawing_id','revision','name','created_at','updated_at','node_count','edge_count','operation_count','object_key','request_id','request_hash'],
                [drawing['id'],version['revision'],version['name'],version['createdAt'],version['updatedAt'],version['nodeCount'],version['edgeCount'],version['operationCount'],key,request_id,request_hash]))
    sql = ''.join(statements).encode()
    # D1 limits individual SQL statements to 100 KB. Keep additional headroom.
    if any(len(statement.encode('utf-8')) > 90000 for statement in statements):
        fail('An import statement exceeds the safe D1 SQL size; no import was applied.')
    private_write(destination / 'import.sql', sql)
    manifest = {'format': FORMAT, 'source': bundle['source'], 'checksum': bundle['checksum'], 'storage': storage,
                'requestProvenance': bundle['requestProvenance'],
                'counts': {'feedback': len(bundle['feedback']), 'drawings': len(bundle['drawings']), 'revisions': revision_count},
                'snapshotChunks': chunk_count,
                'sqlSha256': hashlib.sha256(sql).hexdigest(), 'maxStatementBytes': max((len(statement.encode('utf-8')) for statement in statements),default=0),
                'objects': objects}
    private_write(destination / 'import-plan.json', json_bytes(manifest))
    return manifest


def verify_target(bundle, target):
    expected = validate_bundle(bundle)
    actual = export_data(target)
    if feedback_set(actual['feedback']) != feedback_set(expected['feedback']): fail('Target feedback differs from backup.')
    expected_drawings = [{**canonical_metadata(drawing), 'versions': [
        {**canonical_metadata(version), 'project': version['project']} for version in drawing['versions']]} for drawing in expected['drawings']]
    actual_drawings = [{**canonical_metadata(drawing), 'versions': [
        {**canonical_metadata(version), 'project': version['project']} for version in drawing['versions']]} for drawing in actual['drawings']]
    if digest(actual_drawings) != digest(expected_drawings): fail('Target drawing metadata, history or complete project content differs from backup.')
    return {'feedback': len(actual['feedback']), 'drawings': len(actual['drawings']),
            'revisions': sum(len(item['versions']) for item in actual['drawings'])}


def load_file(path):
    path = Path(path)
    if path.stat().st_size > MAX_FILE_BYTES: fail('Backup file is too large.')
    return json.loads(path.read_text(encoding='utf-8'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    export = commands.add_parser('export'); export.add_argument('--source', required=True)
    export.add_argument('--output', required=True); export.add_argument('--provenance')
    prepare = commands.add_parser('prepare'); prepare.add_argument('--backup', required=True)
    prepare.add_argument('--destination', required=True)
    prepare.add_argument('--storage', choices=['d1','r2'], required=True,
                         help='Use d1 for the Workers+D1 deployment; r2 is only for an explicitly selected legacy R2 target.')
    verify = commands.add_parser('verify'); verify.add_argument('--backup', required=True)
    verify.add_argument('--target', required=True)
    args = parser.parse_args()
    if args.command == 'export':
        bundle = export_data(args.source, load_file(args.provenance) if args.provenance else None)
        output = Path(args.output).resolve(); repository = Path(__file__).resolve().parents[1]
        if output == repository or repository in output.parents: fail('Private backups must be outside the Git repository.')
        output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        private_write(output, json_bytes(bundle))
        print(json.dumps({'exported': True, 'drawings': len(bundle['drawings']), 'feedback': len(bundle['feedback']), 'checksum': bundle['checksum']}))
    elif args.command == 'prepare':
        plan = prepare_import(load_file(args.backup), args.destination, storage=args.storage)
        print(json.dumps({'prepared': True, 'storage': plan['storage'], **plan['counts'], 'checksum': plan['checksum']}))
    else:
        print(json.dumps({'verified': True, **verify_target(load_file(args.backup), args.target)}))


if __name__ == '__main__':
    try: main()
    except (MigrationError, OSError, ValueError, KeyError, TypeError) as error:
        if isinstance(error, MigrationError): print('Migration stopped: ' + str(error), file=sys.stderr)
        else: print('Migration stopped: invalid input, unavailable private file or incomplete data (' + type(error).__name__ + ').', file=sys.stderr)
        sys.exit(1)
