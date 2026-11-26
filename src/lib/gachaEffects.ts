import * as THREE from 'three';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * 상품이 중앙 빨간 Bar(z = ±0.455)와 외곽 파란 Bar(z = ±1.02) 사이에
 * 위쪽(-Z)이든 아래쪽(+Z)이든 걸쳐 있는지 8개 꼭짓점의 월드 Z 투영으로 정밀 판정
 */
export function isPrizeSpanningRedAndBlueBar(
  pos: { x: number; y: number; z: number },
  quat: { x: number; y: number; z: number; w: number },
  dims: { w: number; h: number; d: number },
  dropYThreshold = -0.28,
  redBarHalfZ = 0.455
): boolean {
  if (pos.y <= dropYThreshold || pos.y > 1.58) return false;
  if (Math.abs(pos.z) < 0.24) return false;

  _q.set(quat.x, quat.y, quat.z, quat.w);
  const hw = dims.w / 2;
  const hh = dims.h / 2;
  const hd = dims.d / 2;

  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        _v.set(sx * hw, sy * hh, sz * hd).applyQuaternion(_q);
        const wz = pos.z + _v.z;
        if (wz < minZ) minZ = wz;
        if (wz > maxZ) maxZ = wz;
      }
    }
  }

  const onFrontRedBlue =
    pos.z >= 0.24 && minZ <= redBarHalfZ + 0.16 && maxZ >= 1.02 - 0.18 && minZ > -redBarHalfZ + 0.04;

  const onBackRedBlue =
    pos.z <= -0.24 && maxZ >= -redBarHalfZ - 0.16 && minZ <= -1.02 + 0.18 && maxZ < redBarHalfZ - 0.04;

  return onFrontRedBlue || onBackRedBlue;
}
