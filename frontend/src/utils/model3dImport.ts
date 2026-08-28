import type { Object3D } from 'three';
import { uploadModel } from './api';

/** Above this, reading the whole file into memory client-side isn't worth it. */
const MAX_IMPORT_SIZE_BYTES = 100 * 1024 * 1024;

export type Import3dSourceFormat = 'glb' | 'obj' | 'fbx';

export interface ConvertedModel3d {
  /** Always a GLB, regardless of source format — the pipeline is GLB-only end to end. */
  blob: Blob;
  sourceFormat: Import3dSourceFormat;
  sourceName: string;
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

async function exportToGlb(object: Object3D): Promise<ArrayBuffer> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(object, { binary: true });
  if (!(result instanceof ArrayBuffer)) {
    throw new Error('GLB export failed: exporter returned JSON instead of binary data.');
  }
  return result;
}

/**
 * Convert an imported 3D file to GLB bytes in the browser.
 *
 * `.glb` passes through untouched. `.obj` imports as geometry with a default
 * material (no `.mtl` support in this first slice). `.fbx` keeps textures only
 * when they are embedded in the file, since there is no second file picker for
 * side-car assets.
 */
export async function convertToGlb(file: File): Promise<ConvertedModel3d> {
  if (file.size > MAX_IMPORT_SIZE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(`Import 3D: file is ${mb} MB — the limit is 100 MB.`);
  }

  const ext = extensionOf(file.name);

  if (ext === 'glb') {
    return { blob: file, sourceFormat: 'glb', sourceName: file.name };
  }

  if (ext === 'obj') {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
    const text = await file.text();
    const group = new OBJLoader().parse(text);
    const glb = await exportToGlb(group);
    return {
      blob: new Blob([glb], { type: 'model/gltf-binary' }),
      sourceFormat: 'obj',
      sourceName: file.name,
    };
  }

  if (ext === 'fbx') {
    const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
    const buffer = await file.arrayBuffer();
    const group = new FBXLoader().parse(buffer, '');
    const glb = await exportToGlb(group);
    return {
      blob: new Blob([glb], { type: 'model/gltf-binary' }),
      sourceFormat: 'fbx',
      sourceName: file.name,
    };
  }

  throw new Error(`Import 3D: unsupported file type ".${ext || '?'}" — choose a .glb, .obj, or .fbx file.`);
}

/**
 * Convert then upload a picked file, returning the `data` fields the Import 3D
 * node stores: an asset id the backend can resolve like any generated mesh,
 * plus provenance for the inspector to display.
 */
export async function buildImport3dData(file: File): Promise<Record<string, any>> {
  const converted = await convertToGlb(file);
  const stem = converted.sourceName.replace(/\.[^./\\]+$/, '');
  const { assetId, sizeBytes } = await uploadModel(converted.blob, `${stem}.glb`);
  return {
    modelAssetId: assetId,
    sourceName: converted.sourceName,
    sourceFormat: converted.sourceFormat,
    sizeBytes,
  };
}
