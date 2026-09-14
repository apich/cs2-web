import assert from 'node:assert/strict';
import test from 'node:test';
import { computeViewmodelFov } from '../client/viewmodel.js';
import { cs2FovToVertical } from '../shared/cs2-settings.js';

test('viewmodel base FOV on standard 16:9 PC monitor matches CS2 68 4:3 reference', () => {
  const fov169 = computeViewmodelFov(16 / 9, 0);
  const expectedVert = cs2FovToVertical(68);

  assert.ok(Math.abs(fov169 - expectedVert) < 1e-4, `Expected ${expectedVert}°, got ${fov169}°`);
  assert.ok(fov169 > 53.6 && fov169 < 53.7);

  // Compute resulting horizontal FOV on 16:9: must be ~83.9°
  const horizFov = 2 * Math.atan(Math.tan(fov169 * Math.PI / 360) * (16 / 9)) * 180 / Math.PI;
  assert.ok(Math.abs(horizFov - 83.9) < 0.2);
});

test('viewmodel FOV on wide mobile screen (20:9, aspect 2.16) locks horizontal field of view to 16:9 standard', () => {
  const mobileAspect = 2.16;
  const fovMobile = computeViewmodelFov(mobileAspect, 0);

  // Vertical FOV must dynamically tighten to ~45.2°
  assert.ok(fovMobile < 50.0 && fovMobile > 44.0, `Mobile vFOV was ${fovMobile}°`);

  // Resulting horizontal FOV on mobile screen MUST match 16:9 horizontal FOV (~83.9°)
  const horizFovMobile = 2 * Math.atan(Math.tan(fovMobile * Math.PI / 360) * mobileAspect) * 180 / Math.PI;
  assert.ok(Math.abs(horizFovMobile - 83.9) < 0.2, `Mobile horiz FOV was ${horizFovMobile}°, expected ~83.9°`);
});

test('viewmodel FOV on 21:9 ultrawide PC monitor (aspect 2.33) locks horizontal field of view', () => {
  const ultrawideAspect = 21 / 9;
  const fovUltrawide = computeViewmodelFov(ultrawideAspect, 0);

  const horizFovUltrawide = 2 * Math.atan(Math.tan(fovUltrawide * Math.PI / 360) * ultrawideAspect) * 180 / Math.PI;
  assert.ok(Math.abs(horizFovUltrawide - 83.9) < 0.2, `Ultrawide horiz FOV was ${horizFovUltrawide}°, expected ~83.9°`);
});

test('viewmodel FOV smoothly interpolates during optic aim blend', () => {
  const fovHip = computeViewmodelFov(16 / 9, 0);
  const fovMid = computeViewmodelFov(16 / 9, 0.5);
  const fovAim = computeViewmodelFov(16 / 9, 1.0);

  const expectedAim = cs2FovToVertical(45);
  assert.ok(Math.abs(fovAim - expectedAim) < 1e-4);
  assert.ok(fovMid < fovHip && fovMid > fovAim);
  assert.ok(Math.abs(fovMid - (fovHip + fovAim) / 2) < 1e-4);
});
