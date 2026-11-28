import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabaseView } from '../src/domain/database.js';

test('a fresh gallery uses page content, medium cards and no extra properties', () => {
  const view = createDatabaseView({ id: 'gallery-default-probe', sourceId: 'gallery-default-synthetic', type: 'gallery' });
  assert.equal(view.config.gallery.preview.kind, 'page-content');
  assert.equal(view.config.gallery.cardSize, 'medium');
  assert.deepEqual(view.config.gallery.visiblePropertyIds, []);
});

test('an explicitly saved gallery cover choice and position-independent settings remain intact', () => {
  const view = createDatabaseView({ id: 'gallery-saved-probe', sourceId: 'gallery-default-synthetic', type: 'gallery', config: { gallery: { preview: { kind: 'page-cover', propertyId: null }, cardSize: 'small', imageFit: 'contain', visiblePropertyIds: ['amount'] } } });
  assert.equal(view.config.gallery.preview.kind, 'page-cover');
  assert.equal(view.config.gallery.cardSize, 'small');
  assert.equal(view.config.gallery.imageFit, 'contain');
  assert.deepEqual(view.config.gallery.visiblePropertyIds, ['amount']);
});
