
type PlyFormat = 'ascii' | 'binary_little_endian' | 'binary_big_endian';
type ScalarType =
  | 'char'
  | 'uchar'
  | 'int8'
  | 'uint8'
  | 'short'
  | 'ushort'
  | 'int16'
  | 'uint16'
  | 'int'
  | 'uint'
  | 'int32'
  | 'uint32'
  | 'float'
  | 'float32'
  | 'double'
  | 'float64';
type CameraPreset = 'orbit' | 'flythrough' | 'dolly';

interface GaussianSplatViewportProps {
  plyUrl?: string;
  filename?: string;
  interactive?: boolean;
}

interface PlyProperty {
  name: string;
  type: ScalarType;
  offset: number;
  byteSize: number;
}

export interface ParsedGaussianCloud {
  positions: Float32Array;
  colors: Float32Array;
  opacities: Float32Array;
  scales: Float32Array;
  rotations: Float32Array;
  sourceCount: number;
  renderedCount: number;
  floorY: number;
}

const TYPE_SIZES: Record<ScalarType, number> = {
  char: 1,
  uchar: 1,
  int8: 1,
  uint8: 1,
  short: 2,
  ushort: 2,
  int16: 2,
  uint16: 2,
  int: 4,
  uint: 4,
  int32: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

const SH_C0 = 0.28209479177387814;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-clamp(value, -30, 30)));
}

function formatCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function readScalar(view: DataView, offset: number, type: ScalarType, littleEndian: boolean) {
  switch (type) {
    case 'char':
    case 'int8':
      return view.getInt8(offset);
    case 'uchar':
    case 'uint8':
      return view.getUint8(offset);
    case 'short':
    case 'int16':
      return view.getInt16(offset, littleEndian);
    case 'ushort':
    case 'uint16':
      return view.getUint16(offset, littleEndian);
    case 'int':
    case 'int32':
      return view.getInt32(offset, littleEndian);
    case 'uint':
    case 'uint32':
      return view.getUint32(offset, littleEndian);
    case 'float':
    case 'float32':
      return view.getFloat32(offset, littleEndian);
    case 'double':
    case 'float64':
      return view.getFloat64(offset, littleEndian);
  }
}

function parseHeader(buffer: ArrayBuffer) {
  const probe = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 2 * 1024 * 1024));
  const text = new TextDecoder('ascii').decode(probe);
  const marker = 'end_header';
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) throw new Error('The Gaussian PLY header is missing end_header.');
  let dataOffset = markerIndex + marker.length;
  while (dataOffset < text.length && (text[dataOffset] === '\r' || text[dataOffset] === '\n')) dataOffset += 1;

  const lines = text.slice(0, markerIndex).split(/\r?\n/);
  let format: PlyFormat | null = null;
  let vertexCount = 0;
  let inVertexElement = false;
  let stride = 0;
  const properties: PlyProperty[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'format') format = parts[1] as PlyFormat;
    if (parts[0] === 'element') {
      inVertexElement = parts[1] === 'vertex';
      if (inVertexElement) vertexCount = Number(parts[2]);
      continue;
    }
    if (inVertexElement && parts[0] === 'property') {
      if (parts[1] === 'list') throw new Error('List properties inside the vertex element are not supported.');
      const type = parts[1] as ScalarType;
      const byteSize = TYPE_SIZES[type];
      if (!byteSize) throw new Error(`Unsupported PLY scalar type: ${parts[1]}`);
      properties.push({ name: parts[2], type, offset: stride, byteSize });
      stride += byteSize;
    }
  }

  if (!format || !['ascii', 'binary_little_endian', 'binary_big_endian'].includes(format)) {
    throw new Error('The Gaussian PLY format is unsupported.');
  }
  if (!vertexCount || !properties.length) throw new Error('The Gaussian PLY does not contain a valid vertex element.');
  return { format, vertexCount, properties, stride, dataOffset };
}

export function parseGaussianPly(buffer: ArrayBuffer, maxSplats: number): ParsedGaussianCloud {
  const { format, vertexCount, properties, stride, dataOffset } = parseHeader(buffer);
  const propertyIndex = new Map(properties.map((property, index) => [property.name, index]));
  const required = ['x', 'y', 'z'];
  if (required.some((name) => propertyIndex.get(name) === undefined)) throw new Error('The Gaussian PLY is missing x/y/z positions.');

  const targetCount = Math.min(vertexCount, maxSplats);
  const samplingRate = vertexCount / targetCount;
  const rawPositions = new Float32Array(targetCount * 3);
  const rawColors = new Float32Array(targetCount * 3);
  const rawOpacities = new Float32Array(targetCount);
  const rawScales = new Float32Array(targetCount * 3);
  const rawRotations = new Float32Array(targetCount * 4);

  const xIndex = propertyIndex.get('x') as number;
  const yIndex = propertyIndex.get('y') as number;
  const zIndex = propertyIndex.get('z') as number;
  const redIndex = propertyIndex.get('red') ?? propertyIndex.get('diffuse_red');
  const greenIndex = propertyIndex.get('green') ?? propertyIndex.get('diffuse_green');
  const blueIndex = propertyIndex.get('blue') ?? propertyIndex.get('diffuse_blue');
  const dc0Index = propertyIndex.get('f_dc_0');
  const dc1Index = propertyIndex.get('f_dc_1');
  const dc2Index = propertyIndex.get('f_dc_2');
  const opacityIndex = propertyIndex.get('opacity');
  const scaleIndices = [propertyIndex.get('scale_0'), propertyIndex.get('scale_1'), propertyIndex.get('scale_2')];
  const rotationIndices = [propertyIndex.get('rot_0'), propertyIndex.get('rot_1'), propertyIndex.get('rot_2'), propertyIndex.get('rot_3')];

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let written = 0;

  const assign = (values: number[]) => {
    const x = Number(values[xIndex]);
    const y = Number(values[yIndex]);
    const z = Number(values[zIndex]);
    if (![x, y, z].every(Number.isFinite)) return;

    const index = written;
    rawPositions[index * 3] = x;
    rawPositions[index * 3 + 1] = y;
    rawPositions[index * 3 + 2] = z;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);

    if (redIndex !== undefined && greenIndex !== undefined && blueIndex !== undefined) {
      const r = Number(values[redIndex]);
      const g = Number(values[greenIndex]);
      const b = Number(values[blueIndex]);
      const divisor = Math.max(r, g, b) > 1 ? 255 : 1;
      rawColors[index * 3] = clamp(r / divisor, 0, 1);
      rawColors[index * 3 + 1] = clamp(g / divisor, 0, 1);
      rawColors[index * 3 + 2] = clamp(b / divisor, 0, 1);
    } else if (dc0Index !== undefined && dc1Index !== undefined && dc2Index !== undefined) {
      rawColors[index * 3] = clamp(0.5 + SH_C0 * Number(values[dc0Index]), 0, 1);
      rawColors[index * 3 + 1] = clamp(0.5 + SH_C0 * Number(values[dc1Index]), 0, 1);
      rawColors[index * 3 + 2] = clamp(0.5 + SH_C0 * Number(values[dc2Index]), 0, 1);
    } else {
      rawColors.set([0.75, 0.78, 0.82], index * 3);
    }

    const opacity = opacityIndex === undefined ? 0.85 : Number(values[opacityIndex]);
    rawOpacities[index] = clamp(opacity >= 0 && opacity <= 1 ? opacity : sigmoid(opacity), 0.005, 1);

    for (let axis = 0; axis < 3; axis++) {
      const property = scaleIndices[axis];
      const raw = property === undefined ? -4.2 : Number(values[property]);
      rawScales[index * 3 + axis] = Math.exp(clamp(Number.isFinite(raw) ? raw : -4.2, -12, 4));
    }

    const w = rotationIndices[0] === undefined ? 1 : Number(values[rotationIndices[0]]);
    const qx = rotationIndices[1] === undefined ? 0 : Number(values[rotationIndices[1]]);
    const qy = rotationIndices[2] === undefined ? 0 : Number(values[rotationIndices[2]]);
    const qz = rotationIndices[3] === undefined ? 0 : Number(values[rotationIndices[3]]);
    const length = Math.hypot(qx, qy, qz, w) || 1;
    rawRotations[index * 4] = qx / length;
    rawRotations[index * 4 + 1] = qy / length;
    rawRotations[index * 4 + 2] = qz / length;
    rawRotations[index * 4 + 3] = w / length;
    written += 1;
  };

  if (format === 'ascii') {
    const lines = new TextDecoder().decode(new Uint8Array(buffer, dataOffset)).split(/\r?\n/);
    for (let target = 0; target < targetCount; target++) {
      const source = Math.min(vertexCount - 1, Math.floor(target * samplingRate));
      const line = lines[source];
      if (line) assign(line.trim().split(/\s+/).map(Number));
    }
  } else {
    const view = new DataView(buffer);
    const littleEndian = format === 'binary_little_endian';
    if (buffer.byteLength < dataOffset + vertexCount * stride) throw new Error('The Gaussian PLY file is incomplete.');
    const values = new Array<number>(properties.length);
    for (let target = 0; target < targetCount; target++) {
      const source = Math.min(vertexCount - 1, Math.floor(target * samplingRate));
      const base = dataOffset + source * stride;
      for (let propertyIndexValue = 0; propertyIndexValue < properties.length; propertyIndexValue++) {
        const property = properties[propertyIndexValue];
        values[propertyIndexValue] = readScalar(view, base + property.offset, property.type, littleEndian);
      }
      assign(values);
    }
  }

  if (!written) throw new Error('No valid Gaussian splats could be read from the PLY file.');
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const normalization = 4 / Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.0001);
  const positions = new Float32Array(written * 3);
  const colors = rawColors.slice(0, written * 3);
  const opacities = rawOpacities.slice(0, written);
  const scales = new Float32Array(written * 3);
  const rotations = rawRotations.slice(0, written * 4);

  for (let index = 0; index < written; index++) {
    positions[index * 3] = (rawPositions[index * 3] - centerX) * normalization;
    positions[index * 3 + 1] = (rawPositions[index * 3 + 1] - centerY) * normalization;
    positions[index * 3 + 2] = (rawPositions[index * 3 + 2] - centerZ) * normalization;
    for (let axis = 0; axis < 3; axis++) {
      scales[index * 3 + axis] = clamp(rawScales[index * 3 + axis] * normalization, 0.0015, 0.45);
    }
  }

  return {
    positions,
    colors,
    opacities,
    scales,
    rotations,
    sourceCount: vertexCount,
    renderedCount: written,
    floorY: (minY - centerY) * normalization,
  };
}
