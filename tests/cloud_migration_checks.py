import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cloud_migration', ROOT / 'scripts/cloud-migration.py')
m = importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ID = '11111111-1111-4111-8111-111111111111'
COMMENT = '22222222-2222-4222-8222-222222222222'
SOURCE = 'https://source.example.test'
TARGET = 'https://target.example.test'


def fixture():
    project = {'title': '輸王田', 'nodes': [{'id': 'tank', 'type': 'tank', 'x': 120, 'y': 220,
        'fuel': 'diesel', 'portModes': {'in': 'outlet', 'out': 'outlet'}, 'inAngle': 30,
        'outAngle': 150, 'scale': 30, 'code': ''}], 'edges': [], 'reference': {
        'dataUrl': 'data:image/png;base64,aGVsbG8=', 'width': 120, 'height': 100},
        'operations': [{'id': 'op1', 'name': '停止供油', 'valves': [], 'sources': [
            {'id': 'tank', 'type': 'tank', 'enabled': False, 'portModes': {'in': 'outlet', 'out': 'closed'}}]}]}
    base = {'id': ID, 'name': '舊名稱', 'revision': 1, 'createdAt': 1700000000000,
        'updatedAt': 1700000000000, 'nodeCount': 1, 'edgeCount': 0, 'operationCount': 1}
    v1 = {**base, 'project': copy.deepcopy(project)}
    v2 = {**base, 'name': "輸王田'; DROP TABLE feedback; --", 'revision': 2,
          'updatedAt': 1700000000500, 'project': copy.deepcopy(project)}
    v2['project']['nodes'][0]['outAngle'] = 230
    drawing = {**m.canonical_metadata(v2), 'versions': [v1, v2]}
    feedback = {'id': COMMENT, 'name': '同仁', 'title': '閥門調整', 'category': 'idea',
        'body': "第一行\n第二行 '); DROP TABLE drawings; --", 'createdAt': 1700000000700}
    bundle = {'format': m.FORMAT, 'source': SOURCE, 'feedback': [feedback],
        'drawings': [drawing], 'requestProvenance': 'not-exposed-by-public-api'}
    bundle['checksum'] = m.digest(bundle)
    return bundle


def api_for(bundle, change_after=None):
    calls = {'heads': 0}
    def api(base, path):
        route, _, query = path.partition('?')
        if route == '/api/drawings':
            calls['heads'] += 1
            item = m.canonical_metadata(bundle['drawings'][0])
            if change_after and calls['heads'] >= change_after: item['updatedAt'] += 1
            return {'items': [item], 'total': 1, 'nextCursor': None}
        if route == '/api/feedback':
            return {'items': copy.deepcopy(bundle['feedback']), 'total': len(bundle['feedback']), 'nextCursor': None}
        if route == '/api/drawings/' + ID:
            return copy.deepcopy(max(bundle['drawings'][0]['versions'], key=lambda item: item['revision']))
        if route == '/api/drawings/' + ID + '/revisions':
            # Exercise paginated history in a different order from backup storage.
            versions = bundle['drawings'][0]['versions']
            if 'cursor=1' in query:
                return {'items': [m.canonical_metadata(versions[0])], 'total': 2, 'nextCursor': None}
            return {'items': [m.canonical_metadata(versions[1])], 'total': 2, 'nextCursor': '1'}
        for version in bundle['drawings'][0]['versions']:
            if route == '/api/drawings/' + ID + '/revisions/' + str(version['revision']):
                return copy.deepcopy(version)
        raise AssertionError('Unexpected API route')
    return api


class MigrationChecks(unittest.TestCase):
    def test_public_export_preserves_all_versions_and_comments_and_handles_pagination(self):
        expected = fixture()
        with patch.object(m, 'read_api', side_effect=api_for(expected)):
            exported = m.export_data(SOURCE)
        self.assertEqual(exported['drawings'], expected['drawings'])
        self.assertEqual(exported['feedback'], expected['feedback'])
        self.assertEqual(exported['checksum'], expected['checksum'])

    def test_prepare_actual_sqlite_and_r2_files_preserve_every_visible_value(self):
        bundle = fixture()
        with tempfile.TemporaryDirectory() as parent:
            destination = Path(parent) / 'private-import'
            plan = m.prepare_import(bundle, destination)
            self.assertEqual(plan['counts'], {'drawings': 1, 'feedback': 1, 'revisions': 2})
            sql = (destination / 'import.sql').read_text()
            self.assertNotIn('DROP TABLE', sql, 'unsafe user text must be encoded as literal bytes')
            db = sqlite3.connect(':memory:');db.row_factory = sqlite3.Row
            for schema in ['feedback-schema.sql', 'drawings-schema.sql']:
                db.executescript((ROOT / 'server' / schema).read_text())
            db.executescript(sql)
            head = dict(db.execute('SELECT * FROM drawings').fetchone())
            self.assertEqual(head['id'], ID);self.assertEqual(head['revision'], 2)
            self.assertEqual(head['name'], bundle['drawings'][0]['name'])
            self.assertEqual(head['updated_at'], 1700000000500)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM drawing_revisions').fetchone()[0], 2)
            self.assertEqual(db.execute('SELECT body FROM feedback').fetchone()[0], bundle['feedback'][0]['body'])
            objects = {item['key']: item for item in plan['objects']}
            rows = db.execute('SELECT * FROM drawing_revisions ORDER BY revision').fetchall()
            for row in rows:
                obj = objects[row['object_key']];data = (destination / obj['file']).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), obj['sha256'])
                self.assertEqual(json.loads(data), bundle['drawings'][0]['versions'][row['revision'] - 1]['project'])
            self.assertEqual(head['object_key'], rows[-1]['object_key'])
            with self.assertRaises(sqlite3.IntegrityError): db.executescript(sql)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM drawings').fetchone()[0], 1,
                             'repeat import must not replace existing IDs')
            db.close()
            self.assertEqual((destination / 'import.sql').stat().st_mode & 0o777, 0o600)

    def test_exact_private_provenance_is_preserved(self):
        bundle = fixture()
        rows = [{'drawing_id': ID, 'revision': version['revision'], 'request_id': str(version['revision']) * 8 + '-1111-4111-8111-111111111111',
                 'request_hash': str(version['revision']) * 64, 'object_key': 'drawings/original/' + str(version['revision']) + '.json'}
                for version in bundle['drawings'][0]['versions']]
        with patch.object(m, 'read_api', side_effect=api_for(bundle)):
            exported = m.export_data(SOURCE, {'drawing_revisions': rows})
        self.assertEqual(exported['requestProvenance'], 'preserved')
        with tempfile.TemporaryDirectory() as parent:
            destination = Path(parent) / 'import'
            plan = m.prepare_import(exported, destination)
            self.assertEqual([obj['key'] for obj in plan['objects']], [row['object_key'] for row in rows])
            db = sqlite3.connect(':memory:')
            for schema in ['feedback-schema.sql','drawings-schema.sql']: db.executescript((ROOT/'server'/schema).read_text())
            db.executescript((destination/'import.sql').read_text())
            self.assertEqual(db.execute('SELECT request_id, request_hash FROM drawing_revisions ORDER BY revision').fetchall(),
                             [(row['request_id'],row['request_hash']) for row in rows]);db.close()

    def test_changed_source_incomplete_history_and_altered_backup_are_rejected(self):
        bundle = fixture()
        with patch.object(m, 'read_api', side_effect=api_for(bundle, change_after=2)):
            with self.assertRaisesRegex(m.MigrationError, 'changed'): m.export_data(SOURCE)
        damaged = copy.deepcopy(bundle);damaged['drawings'][0]['versions'].pop(0)
        damaged['checksum'] = m.digest({key:value for key,value in damaged.items() if key!='checksum'})
        with self.assertRaisesRegex(m.MigrationError, 'incomplete'): m.validate_bundle(damaged)
        edited = copy.deepcopy(bundle);edited['drawings'][0]['versions'][0]['project']['nodes'][0]['outAngle'] = 100
        with self.assertRaisesRegex(m.MigrationError, 'checksum'): m.validate_bundle(edited)
        excessive = copy.deepcopy(bundle);excessive['drawings'][0]['revision'] = 9007199254740991
        excessive['checksum'] = m.digest({key:value for key,value in excessive.items() if key!='checksum'})
        with self.assertRaisesRegex(m.MigrationError, 'incomplete'): m.validate_bundle(excessive)

    def test_verify_checks_old_versions_not_just_current_heads(self):
        bundle = fixture()
        with patch.object(m, 'read_api', side_effect=api_for(bundle)):
            self.assertEqual(m.verify_target(bundle, TARGET), {'drawings':1, 'feedback':1, 'revisions':2})
        bad = copy.deepcopy(bundle);bad['drawings'][0]['versions'][0]['project']['reference']['dataUrl'] = 'data:image/png;base64,YmFk'
        with patch.object(m, 'read_api', side_effect=api_for(bad)):
            with self.assertRaisesRegex(m.MigrationError, 'differs'): m.verify_target(bundle, TARGET)

    def test_private_output_must_stay_outside_repository_and_existing_directory_is_not_overwritten(self):
        with self.assertRaisesRegex(m.MigrationError, 'outside'): m.prepare_import(fixture(), ROOT/'private-backup-test')
        with tempfile.TemporaryDirectory() as existing:
            with self.assertRaises(FileExistsError): m.prepare_import(fixture(), existing)
        for url in ['https://user:secret@example.test', 'https://example.test/path', 'http://example.test']:
            with self.assertRaises(m.MigrationError): m.origin(url)


if __name__ == '__main__': unittest.main()
