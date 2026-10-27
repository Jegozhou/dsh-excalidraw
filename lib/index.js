// src/host/index.ts
import { homedir } from "node:os";
import { join as join3 } from "node:path";
import { fileURLToPath } from "node:url";

// src/core/errors.ts
var STATUS = {
  invalid_name: 400,
  not_found: 404,
  already_exists: 409,
  invalid_scene: 422,
  invalid_operation: 422,
  revision_conflict: 409,
  scene_busy: 423,
  too_large: 413,
  too_many_elements: 422,
  permission_denied: 403,
  corrupt_scene: 500,
  io_error: 500,
  unsupported_element: 422,
  duplicate_id: 409,
  invalid_reference: 422
};
var SceneError = class extends Error {
  code;
  status;
  details;
  constructor(code, message, details) {
    super(message);
    this.name = "SceneError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...this.details === void 0 ? {} : { details: this.details }
      }
    };
  }
};
function isSceneError(value) {
  return value instanceof SceneError;
}

// src/core/types.ts
var CREATABLE_ELEMENT_TYPES = [
  "rectangle",
  "ellipse",
  "diamond",
  "arrow",
  "line",
  "text",
  "freedraw",
  "image"
];
var READABLE_ELEMENT_TYPES = [
  ...CREATABLE_ELEMENT_TYPES,
  "frame",
  "magicframe",
  "embeddable",
  "iframe"
];

// src/core/elements.ts
var SCENE_SOURCE = "https://github.com/Jegozhou/dsh-excalidraw";
var ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";
function createId(random = Math.random) {
  let out = "";
  for (let index = 0; index < 20; index += 1) {
    out += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)] ?? "0";
  }
  return out;
}
function createNonce(random = Math.random) {
  return Math.floor(random() * 2147483646) + 1;
}
function measureTextWidth(line, fontSize) {
  let units = 0;
  for (const character of line) {
    const code = character.codePointAt(0) ?? 0;
    if (code > 11904) units += 1;
    else if (character === " ") units += 0.32;
    else if (/[iIl1.,:;'!|]/.test(character)) units += 0.32;
    else if (/[mwMW]/.test(character)) units += 0.85;
    else units += 0.56;
  }
  return Math.ceil(units * fontSize);
}
function measureText(text, fontSize) {
  const lines = String(text ?? "").split("\n");
  const width = Math.max(1, ...lines.map((line) => measureTextWidth(line, fontSize)));
  return { width, height: Math.max(1, Math.ceil(lines.length * fontSize * 1.25)) };
}
function isReadableType(type) {
  return typeof type === "string" && READABLE_ELEMENT_TYPES.includes(type);
}
function isCreatableType(type) {
  return typeof type === "string" && CREATABLE_ELEMENT_TYPES.includes(type);
}
function isLinearElement(element) {
  return element.type === "arrow" || element.type === "line";
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function assertSafeKeys(value, path = "$") {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) assertSafeKeys(value[index], `${path}[${index}]`);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new SceneError("invalid_scene", `forbidden object key "${key}"`, { path });
    }
    assertSafeKeys(value[key], `${path}.${key}`);
  }
}
function clampNumber(value, fallback, min, max) {
  if (!isFiniteNumber(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}
function sanitizeLink(value) {
  if (value === null || value === void 0 || value === "") return null;
  if (typeof value !== "string") return null;
  const link = value.trim();
  if (link.length === 0 || link.length > 2048) return null;
  if (/^(?:https?|mailto):/i.test(link)) return link;
  if (link.startsWith("#") || link.startsWith("/")) return link;
  if (/^\[\[[^\]]+\]\]$/.test(link)) return link;
  return null;
}
function common(type, input, random, now) {
  const width = Math.abs(clampNumber(input.width, 100, 0, 1e5));
  const height = Math.abs(clampNumber(input.height, 100, 0, 1e5));
  return {
    id: typeof input.id === "string" && input.id.trim().length > 0 && input.id.length <= 128 ? input.id.trim() : createId(random),
    type,
    x: clampNumber(input.x, 0, -1e6, 1e6),
    y: clampNumber(input.y, 0, -1e6, 1e6),
    width,
    height,
    angle: clampNumber(input.angle, 0, -Math.PI * 2, Math.PI * 2),
    strokeColor: typeof input.strokeColor === "string" ? input.strokeColor : "#1e1e1e",
    backgroundColor: typeof input.backgroundColor === "string" ? input.backgroundColor : "transparent",
    fillStyle: typeof input.fillStyle === "string" ? input.fillStyle : "solid",
    strokeWidth: clampNumber(input.strokeWidth, 2, 0, 100),
    strokeStyle: typeof input.strokeStyle === "string" ? input.strokeStyle : "solid",
    roughness: clampNumber(input.roughness, 1, 0, 10),
    opacity: clampNumber(input.opacity, 100, 0, 100),
    groupIds: Array.isArray(input.groupIds) ? input.groupIds.filter((id) => typeof id === "string").slice(0, 100) : [],
    frameId: typeof input.frameId === "string" ? input.frameId : null,
    roundness: normalizeRoundness(input.roundness),
    seed: createNonce(random),
    version: 1,
    versionNonce: createNonce(random),
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: sanitizeLink(input.link),
    locked: input.locked === true
  };
}
function normalizeRoundness(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "object" && isFiniteNumber(value.type)) {
    return { type: value.type };
  }
  return null;
}
function points(value, fallback) {
  if (!Array.isArray(value) || value.length < 2) return fallback;
  const out = [];
  for (const entry of value.slice(0, 1e4)) {
    if (!Array.isArray(entry) || entry.length < 2 || !isFiniteNumber(entry[0]) || !isFiniteNumber(entry[1])) continue;
    out.push([entry[0], entry[1]]);
  }
  return out.length >= 2 ? out : fallback;
}
function createElement(input, options = {}) {
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now();
  if (!isCreatableType(input.type)) {
    throw new SceneError("unsupported_element", `element type "${String(input.type)}" cannot be created`, { type: input.type });
  }
  const element = common(input.type, input, random, now);
  const width = Math.abs(isFiniteNumber(input.width) ? input.width : element.width);
  const height = Math.abs(isFiniteNumber(input.height) ? input.height : element.height);
  if (isLinearElement(element)) {
    const fallback = [[0, 0], [width, height]];
    element.points = points(input.points, fallback);
    const xs = element.points.map((point) => point[0]);
    const ys = element.points.map((point) => point[1]);
    element.width = Math.max(...xs) - Math.min(...xs);
    element.height = Math.max(...ys) - Math.min(...ys);
    element.lastCommittedPoint = null;
    element.startBinding = null;
    element.endBinding = null;
    element.startArrowhead = input.startArrowhead ?? null;
    element.endArrowhead = element.type === "arrow" ? input.endArrowhead ?? "arrow" : input.endArrowhead ?? null;
    element.elbowed = false;
    element.fixedSegments = null;
    element.roundness = null;
    return element;
  }
  element.width = width;
  element.height = height;
  if (element.type === "text") {
    const text = typeof input.text === "string" ? input.text.slice(0, 2e4) : "";
    const fontSize = clampNumber(input.fontSize, 20, 1, 512);
    const measured = measureText(text, fontSize);
    element.text = text;
    element.originalText = text;
    element.fontSize = fontSize;
    element.fontFamily = [1, 2, 3, 5, 6, 7, 8, 9].includes(Number(input.fontFamily)) ? Number(input.fontFamily) : 5;
    element.textAlign = input.textAlign ?? "left";
    element.verticalAlign = input.verticalAlign ?? "top";
    element.containerId = null;
    element.lineHeight = 1.25;
    element.autoResize = true;
    element.width = measured.width;
    element.height = measured.height;
    element.strokeColor = "transparent";
    element.backgroundColor = "transparent";
    return element;
  }
  if (element.type === "freedraw") {
    element.points = points(input.points, [[0, 0], [width, height]]);
    element.pressures = Array.isArray(input.pressures) && input.pressures.every(isFiniteNumber) ? input.pressures.slice(0, 1e4) : [];
    element.simulatePressure = input.simulatePressure !== false;
    element.roundness = null;
    element.strokeWidth = clampNumber(input.strokeWidth, 2, 0.5, 100);
    return element;
  }
  if (element.type === "image") {
    if (typeof input.fileId !== "string" || input.fileId.length === 0) {
      throw new SceneError("invalid_operation", "an image element requires fileId", { elementId: element.id });
    }
    element.fileId = input.fileId;
    element.status = "saved";
    element.scale = [1, 1];
    element.crop = null;
    element.roundness = null;
    return element;
  }
  element.roundness = element.type === "rectangle" ? input.roundness ?? { type: 3 } : element.type === "diamond" ? normalizeRoundness(input.roundness) : null;
  if (element.width === 0) element.width = 100;
  if (element.height === 0) element.height = 100;
  return element;
}
function normalizeElement(raw, options = {}) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SceneError("invalid_scene", "an element must be a JSON object");
  }
  const source = raw;
  assertSafeKeys(source);
  if (typeof source.type !== "string") throw new SceneError("invalid_scene", "element.type must be a string");
  if (!isReadableType(source.type)) {
    throw new SceneError("unsupported_element", `element type "${source.type}" is outside the supported compatibility range`, { type: source.type });
  }
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now();
  const base = common(source.type, source, random, now);
  const element = { ...source, ...base };
  if (typeof source.id === "string" && source.id.length > 0) element.id = source.id.slice(0, 128);
  if (isFiniteNumber(source.version)) element.version = Math.max(1, Math.trunc(source.version));
  if (isFiniteNumber(source.versionNonce)) element.versionNonce = Math.trunc(source.versionNonce);
  if (isFiniteNumber(source.seed)) element.seed = Math.trunc(source.seed);
  if (isFiniteNumber(source.updated)) element.updated = Math.trunc(source.updated);
  if (typeof source.isDeleted === "boolean") element.isDeleted = source.isDeleted;
  if (Array.isArray(source.boundElements)) {
    element.boundElements = source.boundElements.filter((entry) => entry !== null && typeof entry === "object" && typeof entry.id === "string" && typeof entry.type === "string").slice(0, 500);
  }
  if (Array.isArray(source.groupIds)) element.groupIds = source.groupIds.filter((id) => typeof id === "string").slice(0, 100);
  if (isLinearElement(element)) {
    element.points = points(source.points, [[0, 0], [element.width, element.height]]);
    element.startBinding = normalizeBinding(source.startBinding);
    element.endBinding = normalizeBinding(source.endBinding);
    element.startArrowhead = typeof source.startArrowhead === "string" ? source.startArrowhead : null;
    element.endArrowhead = typeof source.endArrowhead === "string" ? source.endArrowhead : null;
    element.lastCommittedPoint = Array.isArray(source.lastCommittedPoint) && source.lastCommittedPoint.length === 2 ? [Number(source.lastCommittedPoint[0]), Number(source.lastCommittedPoint[1])] : null;
  }
  if (element.type === "text") {
    element.text = typeof source.text === "string" ? source.text : "";
    element.originalText = typeof source.originalText === "string" ? source.originalText : element.text;
    element.fontSize = clampNumber(source.fontSize, 20, 1, 512);
    element.fontFamily = isFiniteNumber(source.fontFamily) ? Number(source.fontFamily) : 5;
    element.textAlign = typeof source.textAlign === "string" ? source.textAlign : "left";
    element.verticalAlign = typeof source.verticalAlign === "string" ? source.verticalAlign : "top";
    element.containerId = typeof source.containerId === "string" ? source.containerId : null;
    element.lineHeight = clampNumber(source.lineHeight, 1.25, 0.5, 4);
    element.autoResize = source.autoResize !== false;
  }
  if (element.type === "image") {
    element.fileId = typeof source.fileId === "string" ? source.fileId : "";
    element.status = typeof source.status === "string" ? source.status : "saved";
    element.scale = Array.isArray(source.scale) && source.scale.length === 2 ? [Number(source.scale[0]), Number(source.scale[1])] : [1, 1];
  }
  if (element.type === "frame" || element.type === "magicframe") {
    element.name = typeof source.name === "string" ? source.name : "";
  }
  element.link = sanitizeLink(source.link);
  return element;
}
function normalizeBinding(value) {
  if (value === null || typeof value !== "object") return null;
  const source = value;
  if (typeof source.elementId !== "string") return null;
  return {
    elementId: source.elementId,
    focus: isFiniteNumber(source.focus) ? source.focus : 0,
    gap: isFiniteNumber(source.gap) ? source.gap : 1
  };
}
function normalizeAppState(raw) {
  const source = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    viewBackgroundColor: typeof source.viewBackgroundColor === "string" ? source.viewBackgroundColor : "#ffffff",
    gridSize: isFiniteNumber(source.gridSize) ? source.gridSize : null,
    gridModeEnabled: source.gridModeEnabled === true
  };
}
function normalizeFile(raw, id) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SceneError("invalid_scene", `file "${id}" must be an object`, { path: `files.${id}` });
  }
  const source = raw;
  if (typeof source.dataURL !== "string" || !source.dataURL.startsWith("data:")) {
    throw new SceneError("invalid_scene", `file "${id}" must carry a data URL`, { path: `files.${id}` });
  }
  if (!/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,/i.test(source.dataURL)) {
    throw new SceneError("invalid_scene", `file "${id}" has an unsupported mime type`, { path: `files.${id}` });
  }
  const file = {
    id,
    mimeType: typeof source.mimeType === "string" ? source.mimeType : source.dataURL.slice(5, source.dataURL.indexOf(";")),
    dataURL: source.dataURL,
    created: isFiniteNumber(source.created) ? source.created : Date.now()
  };
  if (isFiniteNumber(source.lastRetrieved)) file.lastRetrieved = source.lastRetrieved;
  return file;
}
function sceneBounds(elements) {
  const live = elements.filter((element) => !element.isDeleted);
  if (live.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const element of live) {
    const points2 = isLinearElement(element) && element.points ? element.points : null;
    if (points2) {
      for (const [px, py] of points2) {
        minX = Math.min(minX, element.x + px);
        maxX = Math.max(maxX, element.x + px);
        minY = Math.min(minY, element.y + py);
        maxY = Math.max(maxY, element.y + py);
      }
    } else {
      minX = Math.min(minX, element.x);
      minY = Math.min(minY, element.y);
      maxX = Math.max(maxX, element.x + element.width);
      maxY = Math.max(maxY, element.y + element.height);
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
function validateScene(scene, limits = { maxElements: 5e3 }) {
  const diagnostics = [];
  const push = (code, message, extra = {}) => {
    diagnostics.push({ code, message, severity: "error", ...extra });
  };
  const stats = {
    elements: 0,
    deleted: 0,
    files: 0,
    unsupportedTypes: [],
    bounds: null
  };
  if (scene === null || typeof scene !== "object" || Array.isArray(scene)) {
    push("scene_not_object", "the scene must be a JSON object");
    return { valid: false, diagnostics, stats };
  }
  const document = scene;
  if (document.type !== "excalidraw") push("scene_type", 'scene.type must be "excalidraw"');
  if (document.version !== 2) push("scene_version", "scene.version must be 2");
  if (!Array.isArray(document.elements)) {
    push("scene_elements", "scene.elements must be an array");
    return { valid: false, diagnostics, stats };
  }
  if (document.elements.length > limits.maxElements) {
    push("too_many_elements", `scene has ${document.elements.length} elements; the limit is ${limits.maxElements}`);
  }
  const ids = /* @__PURE__ */ new Set();
  for (let index = 0; index < document.elements.length; index += 1) {
    const raw = document.elements[index];
    const path = `elements[${index}]`;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      push("element_object", "element must be an object", { path });
      continue;
    }
    const element = raw;
    stats.elements += 1;
    if (typeof element.id !== "string" || element.id.length === 0) push("element_id", "element.id is required", { path });
    else if (ids.has(element.id)) push("duplicate_id", `duplicate element id "${element.id}"`, { path, elementId: element.id });
    else ids.add(element.id);
    if (typeof element.type !== "string") {
      push("element_type", "element.type is required", { path });
    } else if (!isReadableType(element.type)) {
      stats.unsupportedTypes.push(element.type);
      push("unsupported_element", `element type "${element.type}" is outside the supported range`, { path, elementId: String(element.id ?? "") });
    }
    for (const key of ["x", "y", "width", "height", "angle", "strokeWidth", "roughness", "opacity", "seed", "version", "versionNonce", "updated"]) {
      if (!isFiniteNumber(element[key])) push("element_number", `element.${key} must be a finite number`, { path, elementId: String(element.id ?? "") });
    }
    if (element.isDeleted === true) stats.deleted += 1;
    if (Array.isArray(element.points)) {
      for (let pointIndex = 0; pointIndex < element.points.length; pointIndex += 1) {
        const point = element.points[pointIndex];
        if (!Array.isArray(point) || point.length < 2 || !isFiniteNumber(point[0]) || !isFiniteNumber(point[1])) {
          push("element_point", "linear points must be finite pairs", { path: `${path}.points[${pointIndex}]`, elementId: String(element.id ?? "") });
        }
      }
    }
  }
  if (document.files !== void 0) {
    if (document.files === null || typeof document.files !== "object" || Array.isArray(document.files)) {
      push("scene_files", "scene.files must be an object");
    } else {
      const files = document.files;
      stats.files = Object.keys(files).length;
      for (const [fileId, file] of Object.entries(files)) {
        try {
          normalizeFile(file, fileId);
        } catch (error) {
          push("scene_file", error instanceof Error ? error.message : "invalid file", { path: `files.${fileId}` });
        }
      }
    }
  }
  if (document.appState !== void 0 && (document.appState === null || typeof document.appState !== "object" || Array.isArray(document.appState))) {
    push("scene_appstate", "scene.appState must be an object");
  }
  const elements = document.elements.filter((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry) && !entry.isDeleted);
  try {
    stats.bounds = sceneBounds(elements);
  } catch {
    stats.bounds = null;
  }
  return { valid: diagnostics.length === 0, diagnostics, stats };
}
function bumpElement(element, now = Date.now(), random = Math.random) {
  element.version += 1;
  element.versionNonce = createNonce(random);
  element.updated = now;
}

// src/core/scene.ts
var DEFAULT_LIMITS = {
  maxElements: 5e3,
  maxFiles: 64,
  maxFileBytes: 8 * 1024 * 1024,
  maxTextLength: 2e4,
  maxBytes: 16 * 1024 * 1024
};
function parseScene(text, limits = DEFAULT_LIMITS) {
  let raw = text;
  if (typeof text === "string") {
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw new SceneError("invalid_scene", `the scene is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return normalizeScene(raw, limits);
}
function normalizeScene(raw, limits = DEFAULT_LIMITS) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SceneError("invalid_scene", "the scene must be a JSON object");
  }
  assertSafeKeys(raw);
  const document = raw;
  const result = validateScene(document, { maxElements: limits.maxElements });
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new SceneError("invalid_scene", errors[0].message, { diagnostics: errors });
  }
  const elements = document.elements.map((entry) => normalizeElement(entry));
  const files = normalizeFiles(document.files, limits);
  const appState = normalizeAppState(document.appState);
  const scene = {
    type: "excalidraw",
    version: 2,
    source: typeof document.source === "string" && document.source.length > 0 ? document.source : SCENE_SOURCE,
    elements,
    appState,
    files
  };
  repairReferences(scene.elements);
  verifyFileReferences(scene, limits);
  return scene;
}
function createScene(input, limits = DEFAULT_LIMITS) {
  if (input.elements !== void 0 && !Array.isArray(input.elements)) {
    throw new SceneError("invalid_scene", "elements must be an array");
  }
  const elements = (input.elements ?? []).map((entry) => createElement(entry));
  if (elements.length > limits.maxElements) {
    throw new SceneError("too_many_elements", `scene has ${elements.length} elements; the limit is ${limits.maxElements}`);
  }
  const files = normalizeFiles(input.files ?? {}, limits);
  const scene = {
    type: "excalidraw",
    version: 2,
    source: SCENE_SOURCE,
    elements,
    appState: normalizeAppState(input.appState),
    files
  };
  repairReferences(scene.elements);
  verifyFileReferences(scene, limits);
  return scene;
}
function normalizeFiles(raw, limits) {
  if (raw === void 0 || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new SceneError("invalid_scene", "scene.files must be an object");
  }
  const entries = Object.entries(raw);
  if (entries.length > limits.maxFiles) {
    throw new SceneError("too_large", `scene has ${entries.length} files; the limit is ${limits.maxFiles}`);
  }
  let total = 0;
  const files = {};
  for (const [fileId, value] of entries) {
    const file = normalizeFile(value, fileId);
    total += file.dataURL.length;
    if (total > limits.maxFileBytes) {
      throw new SceneError("too_large", `scene attachments exceed ${limits.maxFileBytes} characters`);
    }
    files[fileId] = file;
  }
  return files;
}
function verifyFileReferences(scene, limits) {
  for (const element of scene.elements) {
    if (element.type === "image" && !element.isDeleted) {
      if (typeof element.fileId !== "string" || element.fileId.length === 0 || scene.files[element.fileId] === void 0) {
        throw new SceneError("invalid_reference", `image element "${element.id}" references a missing file`, { elementId: element.id });
      }
    }
    if (element.type === "text" && typeof element.text === "string" && element.text.length > limits.maxTextLength) {
      throw new SceneError("too_large", `text element "${element.id}" exceeds ${limits.maxTextLength} characters`, { elementId: element.id });
    }
  }
}
function repairReferences(elements) {
  const live = new Map(elements.filter((element) => !element.isDeleted).map((element) => [element.id, element]));
  for (const element of elements) {
    if (element.isDeleted) continue;
    if (isLinearElement(element)) {
      for (const key of ["startBinding", "endBinding"]) {
        const binding = element[key];
        if (binding && !live.has(binding.elementId)) element[key] = null;
      }
    }
    if (Array.isArray(element.boundElements)) {
      element.boundElements = element.boundElements.filter((entry) => live.has(entry.id));
    }
  }
  for (const element of elements) {
    if (element.isDeleted || !isLinearElement(element)) continue;
    for (const binding of [element.startBinding, element.endBinding]) {
      if (!binding) continue;
      const target = live.get(binding.elementId);
      if (!target) continue;
      if (!Array.isArray(target.boundElements)) target.boundElements = [];
      if (!target.boundElements.some((entry) => entry.id === element.id)) {
        target.boundElements.push({ id: element.id, type: element.type });
      }
    }
  }
}
function serializeScene(scene) {
  return `${JSON.stringify(scene, null, 2)}
`;
}
function cloneScene(scene) {
  return JSON.parse(JSON.stringify(scene));
}
function applyOperations(scene, operations, options = {}) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new SceneError("invalid_operation", "operations must be a non-empty array");
  }
  if (operations.length > 500) {
    throw new SceneError("invalid_operation", "at most 500 operations are accepted per call");
  }
  const next = cloneScene(scene);
  const byId = new Map(next.elements.map((element) => [element.id, element]));
  const summary = { added: 0, updated: 0, deleted: 0, ids: [] };
  const now = options.now ?? Date.now();
  const random = options.random ?? Math.random;
  for (const [index, operation] of operations.entries()) {
    if (operation === null || typeof operation !== "object") {
      throw new SceneError("invalid_operation", `operation ${index} must be an object`);
    }
    if (operation.op === "add") {
      const element = createElement(operation.element, { random, now });
      if (byId.has(element.id)) {
        throw new SceneError("duplicate_id", `element id "${element.id}" already exists`, { elementId: element.id });
      }
      if (next.elements.length >= 5e3) {
        throw new SceneError("too_many_elements", "the scene reached the element limit");
      }
      next.elements.push(element);
      byId.set(element.id, element);
      summary.added += 1;
      summary.ids.push(element.id);
      applyBindings(element, operation.element, byId);
    } else if (operation.op === "update") {
      const element = byId.get(operation.id);
      if (!element || element.isDeleted) {
        throw new SceneError("not_found", `element "${operation.id}" does not exist`, { elementId: operation.id });
      }
      applyPatch(element, operation.patch, { now, random });
      summary.updated += 1;
      summary.ids.push(element.id);
    } else if (operation.op === "delete") {
      const element = byId.get(operation.id);
      if (!element || element.isDeleted) {
        throw new SceneError("not_found", `element "${operation.id}" does not exist`, { elementId: operation.id });
      }
      tombstone(next.elements, element.id, { now, random });
      summary.deleted += 1;
      summary.ids.push(element.id);
    } else {
      throw new SceneError("invalid_operation", `operation ${index} has unknown op "${String(operation.op)}"`);
    }
  }
  repairReferences(next.elements);
  verifyFileReferences(next, DEFAULT_LIMITS);
  const validation = validateScene(next);
  if (!validation.valid) {
    const first = validation.diagnostics.find((diagnostic) => diagnostic.severity === "error");
    throw new SceneError("invalid_scene", first?.message ?? "the mutated scene is invalid", { diagnostics: validation.diagnostics });
  }
  return { scene: next, summary };
}
function applyBindings(element, input, byId) {
  if (!isLinearElement(element)) return;
  const bind = (elementId, side) => {
    if (typeof elementId !== "string" || elementId.length === 0) return;
    const target = byId.get(elementId);
    if (!target || target.isDeleted) {
      throw new SceneError("invalid_reference", `cannot bind to missing element "${elementId}"`, { elementId });
    }
    const binding = { elementId, focus: 0, gap: 1 };
    if (side === "start") element.startBinding = binding;
    else element.endBinding = binding;
    if (!Array.isArray(target.boundElements)) target.boundElements = [];
    if (!target.boundElements.some((entry) => entry.id === element.id)) {
      target.boundElements.push({ id: element.id, type: element.type });
    }
  };
  bind(input.startElementId, "start");
  bind(input.endElementId, "end");
}
var PATCH_KEYS = /* @__PURE__ */ new Set([
  "x",
  "y",
  "width",
  "height",
  "angle",
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "opacity",
  "text",
  "fontSize",
  "fontFamily",
  "textAlign",
  "verticalAlign",
  "points",
  "startArrowhead",
  "endArrowhead",
  "link",
  "locked",
  "roundness"
]);
function applyPatch(element, patch, context) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    throw new SceneError("invalid_operation", "an update patch must be an object");
  }
  for (const key of Object.keys(patch)) {
    if (!PATCH_KEYS.has(key)) {
      throw new SceneError("invalid_operation", `patch field "${key}" is not supported`, { field: key });
    }
  }
  if (patch.type !== void 0) {
    throw new SceneError("invalid_operation", "an element type cannot be changed by a patch");
  }
  const target = element;
  for (const [key, value] of Object.entries(patch)) {
    if (value === void 0) continue;
    if (key === "points") {
      if (!isLinearElement(element)) throw new SceneError("invalid_operation", "points can only update linear elements");
      if (!Array.isArray(value) || value.length < 2) throw new SceneError("invalid_operation", "points must have at least two points");
      const normalized = value.map((point) => {
        if (!Array.isArray(point) || point.length < 2 || !isFiniteNumber(point[0]) || !isFiniteNumber(point[1])) {
          throw new SceneError("invalid_operation", "points must be finite pairs");
        }
        return [point[0], point[1]];
      });
      element.points = normalized;
      const xs = normalized.map((point) => point[0]);
      const ys = normalized.map((point) => point[1]);
      element.width = Math.max(...xs) - Math.min(...xs);
      element.height = Math.max(...ys) - Math.min(...ys);
      continue;
    }
    if (key === "text") {
      if (element.type !== "text") throw new SceneError("invalid_operation", "text can only update text elements");
      if (typeof value !== "string") throw new SceneError("invalid_operation", "text must be a string");
      element.text = value.slice(0, 2e4);
      element.originalText = element.text;
      const measured = measureText(element.text, element.fontSize ?? 20);
      element.width = measured.width;
      element.height = measured.height;
      continue;
    }
    if (key === "link") {
      element.link = typeof value === "string" ? value.slice(0, 2048) : null;
      continue;
    }
    if (key === "roundness") {
      element.roundness = value === null ? null : typeof value === "object" && isFiniteNumber(value.type) ? { type: value.type } : null;
      continue;
    }
    if (key === "width" || key === "height") {
      if (!isFiniteNumber(value)) throw new SceneError("invalid_operation", `${key} must be a finite number`);
      target[key] = Math.abs(value);
      continue;
    }
    if (["x", "y", "angle", "strokeWidth", "roughness", "opacity", "fontSize", "fontFamily"].includes(key)) {
      if (!isFiniteNumber(value)) throw new SceneError("invalid_operation", `${key} must be a finite number`);
      target[key] = value;
      continue;
    }
    if (["strokeColor", "backgroundColor", "fillStyle", "strokeStyle", "textAlign", "verticalAlign"].includes(key)) {
      if (typeof value !== "string") throw new SceneError("invalid_operation", `${key} must be a string`);
      target[key] = value;
      continue;
    }
    if (key === "locked") {
      if (typeof value !== "boolean") throw new SceneError("invalid_operation", "locked must be a boolean");
      element.locked = value;
      continue;
    }
    if (key === "startArrowhead" || key === "endArrowhead") {
      if (value !== null && typeof value !== "string") throw new SceneError("invalid_operation", `${key} must be a string or null`);
      target[key] = value;
      continue;
    }
  }
  if (element.type === "text" && (patch.fontSize !== void 0 || patch.text !== void 0)) {
    const measured = measureText(element.text ?? "", element.fontSize ?? 20);
    element.width = measured.width;
    element.height = measured.height;
  }
  bumpElement(element, context.now, context.random);
}
function tombstone(elements, id, context) {
  const element = elements.find((entry) => entry.id === id);
  if (!element) return;
  element.isDeleted = true;
  element.boundElements = null;
  bumpElement(element, context.now, context.random);
  const descendants = elements.filter((entry) => entry.containerId === id && !entry.isDeleted);
  for (const child of descendants) {
    child.isDeleted = true;
    child.containerId = null;
    bumpElement(child, context.now, context.random);
  }
  for (const other of elements) {
    if (other.isDeleted) continue;
    if (isLinearElement(other)) {
      if (other.startBinding?.elementId === id) other.startBinding = null;
      if (other.endBinding?.elementId === id) other.endBinding = null;
    }
    if (Array.isArray(other.boundElements)) {
      other.boundElements = other.boundElements.filter((entry) => entry.id !== id);
    }
    if (other.containerId === id) other.containerId = null;
  }
}
function mergeAppState(scene, incoming) {
  const normalized = normalizeAppState(incoming);
  return {
    ...scene.appState,
    ...normalized
  };
}
function summarizeScene(scene) {
  const types = {};
  let deleted = 0;
  for (const element of scene.elements) {
    if (element.isDeleted) {
      deleted += 1;
      continue;
    }
    types[element.type] = (types[element.type] ?? 0) + 1;
  }
  return {
    elements: scene.elements.length - deleted,
    deleted,
    files: Object.keys(scene.files).length,
    bounds: sceneBounds(scene.elements),
    types
  };
}

// src/core/store.ts
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
var NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/u;
var META_SCHEMA = "dsh-excalidraw/revision@1";
function assertSceneName(name) {
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    throw new SceneError(
      "invalid_name",
      "scene name must match [a-z0-9][a-z0-9._-]{0,63} and must not contain a path separator",
      { name }
    );
  }
  if (name.includes("..")) {
    throw new SceneError("invalid_name", 'scene name must not contain ".."', { name });
  }
}
function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}
var SceneStore = class {
  rootDir;
  metaDir;
  limits;
  now;
  random;
  staleLockMs;
  lockTimeoutMs;
  queues = /* @__PURE__ */ new Map();
  initialized = false;
  constructor(options) {
    this.rootDir = resolve(options.rootDir);
    this.metaDir = resolve(options.metaDir ?? join(this.rootDir, ".dsh-excalidraw"));
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.now = options.now ?? (() => /* @__PURE__ */ new Date());
    this.random = options.random ?? Math.random;
    this.staleLockMs = options.staleLockMs ?? 3e4;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5e3;
  }
  /** Create the directories if needed and refuse a symlinked root. */
  async init() {
    await fs.mkdir(this.rootDir, { recursive: true, mode: 448 });
    const rootStat = await fs.lstat(this.rootDir);
    if (rootStat.isSymbolicLink()) {
      throw new SceneError("permission_denied", "the drawings directory must not be a symlink");
    }
    const real = await fs.realpath(this.rootDir);
    const expected = join(await fs.realpath(dirname(this.rootDir)), basename(this.rootDir));
    if (real !== expected) {
      throw new SceneError("permission_denied", "the drawings directory resolves outside itself", { root: this.rootDir, real, expected });
    }
    await fs.mkdir(this.metaDir, { recursive: true, mode: 448 });
    await fs.mkdir(join(this.metaDir, "locks"), { recursive: true, mode: 448 });
    await fs.mkdir(join(this.metaDir, "backups"), { recursive: true, mode: 448 });
    this.initialized = true;
  }
  /** Ensure the store can be used. */
  ensureReady() {
    if (!this.initialized) throw new SceneError("io_error", "the scene store was not initialized");
  }
  /** Absolute path of one scene's JSON file, with containment checks. */
  scenePath(name) {
    assertSceneName(name);
    const target = resolve(this.rootDir, `${name}.excalidraw`);
    if (dirname(target) !== this.rootDir) {
      throw new SceneError("permission_denied", "resolved scene path escaped the drawings directory", { name });
    }
    return target;
  }
  /** Absolute path of one scene's metadata file. */
  metaPath(name) {
    assertSceneName(name);
    return join(this.metaDir, `${name}.meta.json`);
  }
  /** Whether a scene file exists. */
  async exists(name) {
    try {
      const stat = await fs.lstat(this.scenePath(name));
      if (stat.isSymbolicLink()) throw new SceneError("permission_denied", "scene files must not be symlinks", { name });
      return stat.isFile();
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }
  /** List scenes, tolerating unreadable files but reporting them. */
  async list() {
    this.ensureReady();
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true });
    const summaries = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".excalidraw")) continue;
      const name = entry.name.slice(0, -".excalidraw".length);
      if (!NAME_PATTERN.test(name)) continue;
      try {
        const record = await this.read(name, { repair: false });
        summaries.push({
          name,
          revision: record.revision,
          elementCount: record.elementCount,
          byteLength: record.byteLength,
          updatedAt: record.updatedAt,
          updatedBy: record.updatedBy,
          sha256: record.sha256,
          valid: true
        });
      } catch (error) {
        summaries.push({
          name,
          revision: 0,
          elementCount: 0,
          byteLength: 0,
          updatedAt: "",
          updatedBy: "",
          sha256: "",
          valid: false
        });
      }
    }
    return summaries.sort((left, right) => left.name.localeCompare(right.name));
  }
  /** Read, validate and reconcile one scene. */
  async read(name, options = {}) {
    this.ensureReady();
    const path = this.scenePath(name);
    let text;
    try {
      const stat = await fs.lstat(path);
      if (stat.isSymbolicLink()) {
        throw new SceneError("permission_denied", "scene files must not be symlinks", { name });
      }
      if (!stat.isFile()) throw new SceneError("not_found", `scene "${name}" is not a regular file`, { name });
      text = await fs.readFile(path, "utf8");
    } catch (error) {
      if (error instanceof SceneError) throw error;
      if (error.code === "ENOENT") {
        throw new SceneError("not_found", `scene "${name}" does not exist`, { name });
      }
      throw new SceneError("io_error", `could not read scene "${name}"`, { name, cause: String(error) });
    }
    if (Buffer.byteLength(text, "utf8") > this.limits.maxBytes) {
      throw new SceneError("too_large", `scene "${name}" exceeds the ${this.limits.maxBytes} byte limit`);
    }
    let scene;
    try {
      scene = parseScene(text, this.limits);
    } catch (error) {
      const recovered = await this.tryRecover(name, error);
      if (recovered) return recovered;
      throw error instanceof SceneError ? new SceneError("corrupt_scene", `scene "${name}" is not readable: ${error.message}`, { name }) : error;
    }
    const digest = sha256(text);
    const meta = await this.readMeta(name);
    let revision = meta?.revision ?? 0;
    let repaired = false;
    if (meta && meta.sha256 !== digest) {
      revision = meta.revision + 1;
      repaired = true;
    }
    if (!meta) repaired = true;
    if (repaired && options.repair !== false) {
      await this.writeMeta({
        schema: META_SCHEMA,
        name,
        revision,
        sha256: digest,
        byteLength: Buffer.byteLength(text, "utf8"),
        elementCount: scene.elements.length,
        updatedAt: this.now().toISOString(),
        updatedBy: "recovery",
        previousRevision: meta?.revision ?? null,
        previousSha256: meta?.sha256 ?? null,
        recentRequests: meta?.recentRequests ?? []
      });
    }
    return {
      scene,
      revision,
      sha256: digest,
      byteLength: Buffer.byteLength(text, "utf8"),
      elementCount: scene.elements.length,
      updatedAt: meta?.updatedAt ?? this.now().toISOString(),
      updatedBy: repaired ? "recovery" : meta?.updatedBy ?? "external"
    };
  }
  /** Create a new scene. Fails when the name already exists. */
  async create(name, scene, options = {}) {
    this.ensureReady();
    return this.withLock(name, async () => {
      if (await this.exists(name)) {
        throw new SceneError("already_exists", `scene "${name}" already exists`, { name });
      }
      const text = serializeScene(scene);
      if (Buffer.byteLength(text, "utf8") > this.limits.maxBytes) {
        throw new SceneError("too_large", `scene exceeds the ${this.limits.maxBytes} byte limit`);
      }
      await this.writeAtomic(this.scenePath(name), text);
      const meta = {
        schema: META_SCHEMA,
        name,
        revision: 1,
        sha256: sha256(text),
        byteLength: Buffer.byteLength(text, "utf8"),
        elementCount: scene.elements.length,
        updatedAt: this.now().toISOString(),
        updatedBy: options.actor ?? "agent",
        previousRevision: null,
        previousSha256: null,
        recentRequests: this.rememberRequest([], options.requestId, 1, sha256(text))
      };
      await this.writeMeta(meta);
      return this.verifyAfterWrite(name, meta, false);
    });
  }
  /** Save a full scene under a revision fence. */
  async save(name, scene, options = {}) {
    this.ensureReady();
    return this.withLock(name, async () => {
      const current = await this.readForWrite(name);
      const duplicate = this.findRequest(current.meta, options.requestId);
      if (duplicate) {
        return {
          scene,
          revision: duplicate.revision,
          sha256: duplicate.sha256,
          byteLength: Buffer.byteLength(serializeScene(scene), "utf8"),
          elementCount: scene.elements.length,
          updatedAt: current.meta?.updatedAt ?? this.now().toISOString(),
          updatedBy: current.meta?.updatedBy ?? "agent",
          duplicate: true
        };
      }
      const currentRevision = current.meta?.revision ?? 0;
      if (!options.force && options.expectedRevision !== void 0 && options.expectedRevision !== currentRevision) {
        throw new SceneError("revision_conflict", `scene "${name}" is at revision ${currentRevision}, not ${options.expectedRevision}`, {
          name,
          currentRevision,
          expectedRevision: options.expectedRevision,
          currentSha256: current.meta?.sha256 ?? null,
          updatedAt: current.meta?.updatedAt ?? null
        });
      }
      const text = serializeScene(scene);
      if (Buffer.byteLength(text, "utf8") > this.limits.maxBytes) {
        throw new SceneError("too_large", `scene exceeds the ${this.limits.maxBytes} byte limit`);
      }
      const nextRevision = currentRevision + 1;
      const digest = sha256(text);
      await this.backup(name, currentRevision, current.text);
      await this.writeAtomic(this.scenePath(name), text);
      const meta = {
        schema: META_SCHEMA,
        name,
        revision: nextRevision,
        sha256: digest,
        byteLength: Buffer.byteLength(text, "utf8"),
        elementCount: scene.elements.length,
        updatedAt: this.now().toISOString(),
        updatedBy: options.actor ?? "agent",
        previousRevision: currentRevision || null,
        previousSha256: current.meta?.sha256 ?? (current.text ? sha256(current.text) : null),
        recentRequests: this.rememberRequest(current.meta?.recentRequests ?? [], options.requestId, nextRevision, digest)
      };
      try {
        await this.writeMeta(meta);
        return await this.verifyAfterWrite(name, meta, false);
      } catch (error) {
        if (current.text !== void 0) {
          await this.writeAtomic(this.scenePath(name), current.text).catch(() => void 0);
        }
        throw error;
      }
    });
  }
  /** Apply a mutation under the store's lock, then persist it. */
  async mutate(name, mutate, options = {}) {
    return this.withLock(name, async () => {
      const current = await this.read(name);
      const alreadyApplied = this.findRequest(await this.readMeta(name), options.requestId);
      if (alreadyApplied) {
        return {
          scene: current.scene,
          revision: alreadyApplied.revision,
          sha256: alreadyApplied.sha256,
          byteLength: current.byteLength,
          elementCount: current.elementCount,
          updatedAt: alreadyApplied.at,
          updatedBy: options.actor ?? "agent",
          duplicate: true
        };
      }
      if (!options.force && options.expectedRevision !== void 0 && options.expectedRevision !== current.revision) {
        throw new SceneError("revision_conflict", `scene "${name}" is at revision ${current.revision}, not ${options.expectedRevision}`, {
          name,
          currentRevision: current.revision,
          expectedRevision: options.expectedRevision,
          currentSha256: current.sha256
        });
      }
      const next = await mutate(current.scene, current);
      return this.saveLocked(name, next, options, current);
    });
  }
  /** Save while already holding the lock. */
  async saveLocked(name, scene, options, current) {
    const duplicate = this.findRequest(await this.readMeta(name), options.requestId);
    if (duplicate) {
      return {
        scene,
        revision: duplicate.revision,
        sha256: duplicate.sha256,
        byteLength: Buffer.byteLength(serializeScene(scene), "utf8"),
        elementCount: scene.elements.length,
        updatedAt: this.now().toISOString(),
        updatedBy: options.actor ?? "agent",
        duplicate: true
      };
    }
    const text = serializeScene(scene);
    if (Buffer.byteLength(text, "utf8") > this.limits.maxBytes) {
      throw new SceneError("too_large", `scene exceeds the ${this.limits.maxBytes} byte limit`);
    }
    const digest = sha256(text);
    const meta = await this.readMeta(name);
    const nextRevision = Math.max(current.revision, meta?.revision ?? 0) + 1;
    await this.backup(name, current.revision, await this.readRaw(name));
    await this.writeAtomic(this.scenePath(name), text);
    const nextMeta = {
      schema: META_SCHEMA,
      name,
      revision: nextRevision,
      sha256: digest,
      byteLength: Buffer.byteLength(text, "utf8"),
      elementCount: scene.elements.length,
      updatedAt: this.now().toISOString(),
      updatedBy: options.actor ?? "agent",
      previousRevision: current.revision,
      previousSha256: current.sha256,
      recentRequests: this.rememberRequest(meta?.recentRequests ?? [], options.requestId, nextRevision, digest)
    };
    await this.writeMeta(nextMeta);
    return this.verifyAfterWrite(name, nextMeta, false);
  }
  /** Read metadata, or undefined when absent. */
  async readMeta(name) {
    try {
      const text = await fs.readFile(this.metaPath(name), "utf8");
      const parsed = JSON.parse(text);
      if (parsed?.schema !== META_SCHEMA || typeof parsed.revision !== "number" || typeof parsed.sha256 !== "string") {
        return void 0;
      }
      return parsed;
    } catch (error) {
      if (error.code === "ENOENT") return void 0;
      return void 0;
    }
  }
  /** Internal read used before a write; keeps the raw text for rollback. */
  async readForWrite(name) {
    const meta = await this.readMeta(name);
    let text;
    try {
      text = await fs.readFile(this.scenePath(name), "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return { meta, text };
  }
  /** Raw scene text for backups. */
  async readRaw(name) {
    return (await this.readForWrite(name)).text;
  }
  /** Persist metadata atomically. */
  async writeMeta(meta) {
    await this.writeAtomic(this.metaPath(meta.name), `${JSON.stringify(meta, null, 2)}
`);
  }
  /** Keep the last 32 successful request ids for idempotent retries. */
  rememberRequest(existing, requestId, revision, digest) {
    const entries = Array.isArray(existing) ? existing.slice(-31) : [];
    if (typeof requestId === "string" && requestId.length > 0 && requestId.length <= 128) {
      entries.push({ id: requestId, revision, sha256: digest, at: this.now().toISOString() });
    }
    return entries;
  }
  /** Find an already-applied request id. */
  findRequest(meta, requestId) {
    if (!meta || typeof requestId !== "string" || requestId.length === 0) return void 0;
    return meta.recentRequests?.find((entry) => entry.id === requestId);
  }
  /** Copy the current file into the backup slot. */
  async backup(name, revision, text) {
    if (text === void 0) return;
    const backupPath = join(this.metaDir, "backups", `${name}.${revision}.excalidraw`);
    await fs.writeFile(backupPath, text, { mode: 384 });
  }
  /** Restore the newest backup when the live file is corrupt. */
  async tryRecover(name, cause) {
    const backups = await this.listBackups(name);
    for (const candidate of backups) {
      try {
        const text = await fs.readFile(candidate, "utf8");
        const scene = parseScene(text, this.limits);
        await this.writeAtomic(this.scenePath(name), text);
        const meta = await this.readMeta(name);
        const revision = (meta?.revision ?? 0) + 1;
        const digest = sha256(text);
        const nextMeta = {
          schema: META_SCHEMA,
          name,
          revision,
          sha256: digest,
          byteLength: Buffer.byteLength(text, "utf8"),
          elementCount: scene.elements.length,
          updatedAt: this.now().toISOString(),
          updatedBy: "recovery",
          previousRevision: meta?.revision ?? null,
          previousSha256: meta?.sha256 ?? null,
          recentRequests: meta?.recentRequests ?? []
        };
        await this.writeMeta(nextMeta);
        return {
          scene,
          revision,
          sha256: digest,
          byteLength: Buffer.byteLength(text, "utf8"),
          elementCount: scene.elements.length,
          updatedAt: nextMeta.updatedAt,
          updatedBy: "recovery"
        };
      } catch {
      }
    }
    void cause;
    return null;
  }
  /** Backups, newest first. */
  async listBackups(name) {
    try {
      const entries = await fs.readdir(join(this.metaDir, "backups"));
      return entries.filter((entry) => entry.startsWith(`${name}.`) && entry.endsWith(".excalidraw")).map((entry) => Number(entry.split(".")[1] ?? "0")).filter(Number.isFinite).sort((left, right) => right - left).slice(0, 5).map((revision) => join(this.metaDir, "backups", `${name}.${revision}.excalidraw`));
    } catch {
      return [];
    }
  }
  /** Read the file back and prove it parses and hashes to the reported value. */
  async verifyAfterWrite(name, meta, duplicate) {
    const text = await fs.readFile(this.scenePath(name), "utf8");
    const digest = sha256(text);
    if (digest !== meta.sha256) {
      throw new SceneError("io_error", `write verification failed for "${name}": hash mismatch`, {
        expected: meta.sha256,
        actual: digest
      });
    }
    const scene = parseScene(text, this.limits);
    if (scene.elements.length !== meta.elementCount) {
      throw new SceneError("io_error", `write verification failed for "${name}": element count mismatch`);
    }
    return {
      scene,
      revision: meta.revision,
      sha256: digest,
      byteLength: Buffer.byteLength(text, "utf8"),
      elementCount: scene.elements.length,
      updatedAt: meta.updatedAt,
      updatedBy: meta.updatedBy,
      duplicate
    };
  }
  /** Serialize writes for one name inside this process. */
  withLock(name, operation) {
    assertSceneName(name);
    const previous = this.queues.get(name) ?? Promise.resolve();
    const next = previous.then(() => this.withFileLock(name, operation));
    this.queues.set(name, next.catch(() => void 0));
    return next;
  }
  /** Cross-process lock using an exclusive lock file. */
  async withFileLock(name, operation) {
    const lockPath = join(this.metaDir, "locks", `${name}.lock`);
    const started = Date.now();
    let handle;
    while (handle === void 0) {
      try {
        handle = await fs.open(lockPath, "wx", 384);
        await handle.writeFile(JSON.stringify({ pid: process.pid, at: this.now().toISOString(), nonce: randomUUID() }));
        await handle.sync();
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const stat = await fs.stat(lockPath).catch(() => void 0);
        if (stat && Date.now() - stat.mtimeMs > this.staleLockMs) {
          await fs.unlink(lockPath).catch(() => void 0);
          continue;
        }
        if (Date.now() - started > this.lockTimeoutMs) {
          throw new SceneError("scene_busy", `scene "${name}" is locked by another writer`, { name });
        }
        await sleep(25);
      }
    }
    try {
      return await operation();
    } finally {
      await handle.close().catch(() => void 0);
      await fs.unlink(lockPath).catch(() => void 0);
    }
  }
  /** Write a file atomically (temp + fsync + rename + directory fsync). */
  async writeAtomic(path, text) {
    await fs.mkdir(dirname(path), { recursive: true, mode: 448 });
    const temp = `${path}.tmp-${randomUUID()}`;
    let handle;
    try {
      handle = await fs.open(temp, "wx", 384);
      await handle.writeFile(text, "utf8");
      await handle.sync();
      await handle.close();
      handle = void 0;
      await fs.rename(temp, path);
      await this.fsyncDirectory(dirname(path));
    } finally {
      await handle?.close().catch(() => void 0);
      await fs.unlink(temp).catch(() => void 0);
    }
  }
  /** Best-effort directory fsync, which makes the rename durable on POSIX. */
  async fsyncDirectory(dir) {
    let handle;
    try {
      handle = await fs.open(dir, "r");
      await handle.sync();
    } catch {
    } finally {
      await handle?.close().catch(() => void 0);
    }
  }
  /** Stats for the health endpoint and the lifecycle tests. */
  async stats() {
    const summaries = await this.list();
    return {
      scenes: summaries.length,
      bytes: summaries.reduce((sum, summary) => sum + summary.byteLength, 0),
      rootDir: this.rootDir,
      initialized: this.initialized
    };
  }
};

// src/host/service.ts
var ExcalidrawService = class {
  store;
  version;
  now;
  initPromise;
  editor = {
    mounted: false,
    lastEvent: "none",
    lastSeenAt: null,
    mountedAt: null,
    sceneName: null,
    elementCount: null,
    width: null,
    height: null,
    build: null,
    error: null,
    events: 0
  };
  constructor(options) {
    this.version = options.version;
    this.now = options.now ?? (() => /* @__PURE__ */ new Date());
    this.store = new SceneStore({
      rootDir: options.rootDir,
      limits: options.limits,
      now: this.now
    });
  }
  /** Initialize storage; safe to call repeatedly and from concurrent callers. */
  ready() {
    this.initPromise ??= this.store.init();
    return this.initPromise;
  }
  /** List scenes. */
  async list() {
    await this.ready();
    return this.store.list();
  }
  /** Read one scene with its revision facts. */
  async read(name) {
    await this.ready();
    return this.store.read(name);
  }
  /** Create a scene from either a full document or the typed element subset. */
  async create(payload) {
    await this.ready();
    const name = payload.name;
    let scene;
    if (payload.scene !== void 0) {
      scene = normalizeScene(payload.scene, this.store.limits);
    } else {
      if (payload.elements !== void 0 && !Array.isArray(payload.elements)) {
        throw new SceneError("invalid_scene", "elements must be an array");
      }
      scene = createScene({
        elements: payload.elements ?? [],
        appState: payload.appState,
        files: payload.files ?? {}
      }, this.store.limits);
    }
    const record = await this.store.create(name, scene, {
      actor: payload.actor ?? "agent",
      requestId: payload.requestId
    });
    return { record, summary: summarizeScene(record.scene), name };
  }
  /** Save a complete document under a revision fence. */
  async save(name, payload) {
    await this.ready();
    const scene = normalizeScene(payload.scene, this.store.limits);
    const record = await this.store.save(name, scene, {
      actor: payload.actor ?? "ui",
      requestId: payload.requestId,
      expectedRevision: payload.expectedRevision,
      force: payload.force === true
    });
    return { record, summary: summarizeScene(record.scene) };
  }
  /** Apply typed operations under a revision fence. */
  async apply(name, payload) {
    await this.ready();
    const result = await this.store.mutate(name, (scene) => {
      const applied = applyOperations(scene, payload.operations);
      if (payload.appState !== void 0) applied.scene.appState = mergeAppState(applied.scene, payload.appState);
      return applied.scene;
    }, {
      actor: payload.actor ?? "agent",
      requestId: payload.requestId,
      expectedRevision: payload.expectedRevision
    });
    const summary = summarizeScene(result.scene);
    const operations = countOperations(payload.operations);
    return { record: result, summary, operations };
  }
  /** Record one browser heartbeat and return the accumulated status. */
  reportEditor(event) {
    this.editor.events += 1;
    this.editor.lastEvent = typeof event.event === "string" ? event.event : "unknown";
    this.editor.lastSeenAt = this.now().toISOString();
    if (this.editor.lastEvent === "mounted") {
      this.editor.mounted = true;
      this.editor.mountedAt = this.editor.lastSeenAt;
    }
    if (this.editor.lastEvent === "unmounted") this.editor.mounted = false;
    if (this.editor.lastEvent === "error") {
      this.editor.mounted = false;
      this.editor.error = typeof event.message === "string" ? event.message.slice(0, 500) : "unspecified editor error";
    }
    if (typeof event.sceneName === "string") this.editor.sceneName = event.sceneName;
    if (typeof event.elementCount === "number") this.editor.elementCount = event.elementCount;
    if (typeof event.width === "number") this.editor.width = event.width;
    if (typeof event.height === "number") this.editor.height = event.height;
    if (typeof event.build === "string") this.editor.build = event.build.slice(0, 120);
    return this.editorStatus();
  }
  /** A frozen copy of the editor status. */
  editorStatus() {
    return { ...this.editor };
  }
  /** Health facts that do not depend on the browser. */
  async health() {
    await this.ready();
    const stats = await this.store.stats();
    return {
      ok: true,
      plugin: "dsh-excalidraw",
      version: this.version,
      scenes: stats.scenes,
      bytes: stats.bytes,
      drawingsDir: stats.rootDir,
      editor: this.editorStatus(),
      limits: this.store.limits,
      now: this.now().toISOString()
    };
  }
};
function countOperations(operations) {
  let added = 0;
  let updated = 0;
  let deleted = 0;
  const ids = [];
  for (const operation of operations) {
    if (operation.op === "add") {
      added += 1;
      if (operation.element.id) ids.push(operation.element.id);
    } else if (operation.op === "update") {
      updated += 1;
      ids.push(operation.id);
    } else if (operation.op === "delete") {
      deleted += 1;
      ids.push(operation.id);
    }
  }
  return { added, updated, deleted, ids };
}

// src/host/api.ts
import { readFile } from "node:fs/promises";
import { extname, join as join2, normalize, resolve as resolve2, sep } from "node:path";
var API_PREFIX = "/dsh-excalidraw/api";
var ASSET_PREFIX = "/dsh-excalidraw/assets";
var MAX_BODY_BYTES = 24 * 1024 * 1024;
var ApiServer = class {
  service;
  admit;
  log;
  routes = [];
  constructor(deps) {
    this.service = deps.service;
    this.admit = deps.admit;
    this.log = deps.log ?? (() => void 0);
    this.register();
  }
  route(method, template, handler) {
    const keys = [];
    const pattern = new RegExp(`^${template.replace(/:([A-Za-z0-9_]+)/gu, (_match, key) => {
      keys.push(key);
      return "([^/]+)";
    })}$`, "u");
    this.routes.push({ method, pattern, keys, handler });
  }
  register() {
    const service = this.service;
    this.route("GET", "/health", async () => service.health());
    this.route("GET", "/scenes", async () => ({ scenes: await service.list() }));
    this.route("GET", "/scenes/:name", async (_body, params) => {
      const record = await service.read(params.name);
      return {
        ok: true,
        name: params.name,
        revision: record.revision,
        sha256: record.sha256,
        byteLength: record.byteLength,
        elementCount: record.elementCount,
        updatedAt: record.updatedAt,
        updatedBy: record.updatedBy,
        scene: record.scene
      };
    });
    this.route("POST", "/scenes", async (body) => {
      const created = await service.create({
        name: String(body.name ?? ""),
        elements: body.elements,
        scene: body.scene,
        appState: body.app_state,
        files: body.files,
        requestId: typeof body.request_id === "string" ? body.request_id : void 0,
        actor: "ui"
      });
      return {
        ok: true,
        name: created.name,
        revision: created.record.revision,
        sha256: created.record.sha256,
        elementCount: created.record.elementCount,
        savedAt: created.record.updatedAt,
        summary: created.summary
      };
    });
    this.route("PUT", "/scenes/:name", async (body, params) => {
      const saved = await service.save(params.name, {
        scene: body.scene,
        expectedRevision: typeof body.expected_revision === "number" ? body.expected_revision : void 0,
        requestId: typeof body.request_id === "string" ? body.request_id : void 0,
        force: body.force === true,
        actor: "ui"
      });
      return {
        ok: true,
        name: params.name,
        revision: saved.record.revision,
        sha256: saved.record.sha256,
        byteLength: saved.record.byteLength,
        elementCount: saved.record.elementCount,
        savedAt: saved.record.updatedAt,
        duplicate: saved.record.duplicate === true,
        summary: saved.summary
      };
    });
    this.route("POST", "/editor-status", async (body) => ({
      ok: true,
      editor: this.service.reportEditor(body)
    }));
  }
  /** Handle one request and own the full response lifecycle. */
  async handle(req, res) {
    try {
      const rejection = this.admit(req);
      if (rejection !== void 0) {
        sendJson(res, rejection, { error: { code: "unauthorized", message: "this page is not authenticated for the Harness API" } });
        return;
      }
      const url = new URL(req.url ?? "/", "http://dsh-excalidraw.invalid");
      const path = url.pathname.slice(API_PREFIX.length) || "/";
      const method = String(req.method ?? "GET").toUpperCase();
      const match = this.routes.find((route) => route.method === method && route.pattern.test(path));
      if (!match) {
        sendJson(res, 404, { error: { code: "not_found", message: `no route for ${method} ${path}` } });
        return;
      }
      const values = match.pattern.exec(path)?.slice(1) ?? [];
      const params = Object.fromEntries(match.keys.map((key, index) => [key, decodeURIComponent(values[index] ?? "")]));
      const query = Object.fromEntries(url.searchParams.entries());
      const body = method === "GET" ? query : { ...query, ...await readJson(req) };
      const result = await match.handler(body, params, req);
      sendJson(res, 200, result ?? { ok: true });
    } catch (error) {
      const status = isSceneError(error) ? error.status : error instanceof SceneError ? error.status : 500;
      const code = isSceneError(error) ? error.code : "internal";
      const message = error instanceof Error ? error.message : String(error);
      if (status >= 500) this.log(`api: ${req.method} ${req.url} failed \u2014 ${message}`, error);
      sendJson(res, status, {
        error: {
          code,
          message,
          ...error instanceof SceneError && error.details !== void 0 ? { details: error.details } : {}
        }
      });
    }
  }
};
async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new SceneError("too_large", `request body exceeds ${MAX_BODY_BYTES} bytes`);
    chunks.push(buffer);
  }
  if (size === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SceneError("invalid_scene", "the request body is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SceneError("invalid_scene", "the request body must be a JSON object");
  }
  return parsed;
}
function sendJson(res, status, body) {
  if (res.headersSent) return;
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(payload);
}
var CONTENT_TYPES = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};
function createAssetHandler(assetsDir, admit) {
  const root = resolve2(assetsDir);
  return async (req, res) => {
    try {
      const rejection = admit(req);
      if (rejection !== void 0) {
        sendJson(res, rejection, { error: { code: "unauthorized", message: "not authenticated" } });
        return;
      }
      if (String(req.method ?? "GET").toUpperCase() !== "GET") {
        sendJson(res, 405, { error: { code: "method_not_allowed", message: "assets are read-only" } });
        return;
      }
      const url = new URL(req.url ?? "/", "http://dsh-excalidraw.invalid");
      let relative = decodeURIComponent(url.pathname.slice(ASSET_PREFIX.length));
      if (relative.startsWith("/")) relative = relative.slice(1);
      if (relative.length === 0 || relative.includes("\0") || relative.split("/").includes("..")) {
        sendJson(res, 404, { error: { code: "not_found", message: "asset not found" } });
        return;
      }
      const target = resolve2(join2(root, normalize(relative)));
      if (target !== root && !target.startsWith(`${root}${sep}`)) {
        sendJson(res, 403, { error: { code: "permission_denied", message: "asset path escaped its root" } });
        return;
      }
      const extension = extname(target).toLowerCase();
      const contentType = CONTENT_TYPES[extension];
      if (contentType === void 0) {
        sendJson(res, 404, { error: { code: "not_found", message: "unsupported asset type" } });
        return;
      }
      const bytes = await readFile(target);
      res.statusCode = 200;
      res.setHeader("content-type", contentType);
      res.setHeader("cache-control", "public, max-age=3600");
      res.setHeader("x-content-type-options", "nosniff");
      res.end(bytes);
    } catch (error) {
      if (error.code === "ENOENT") {
        sendJson(res, 404, { error: { code: "not_found", message: "asset not found" } });
        return;
      }
      sendJson(res, 500, { error: { code: "io_error", message: error instanceof Error ? error.message : String(error) } });
    }
  };
}

// src/host/schema.ts
var NUMBER = { type: "number" };
var STRING = { type: "string" };
var BOOLEAN = { type: "boolean" };
var NULLABLE_STRING = { type: ["string", "null"] };
var POINT_SCHEMA = {
  type: "array",
  items: NUMBER,
  minItems: 2,
  maxItems: 2
};
var ELEMENT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["rectangle", "ellipse", "diamond", "arrow", "line", "text", "freedraw", "image"],
      description: "Element type."
    },
    id: { type: "string", description: "Optional stable id; generated when omitted." },
    x: { ...NUMBER, description: "Scene x coordinate." },
    y: { ...NUMBER, description: "Scene y coordinate." },
    width: { ...NUMBER, description: "Width in scene units." },
    height: { ...NUMBER, description: "Height in scene units." },
    angle: NUMBER,
    strokeColor: STRING,
    backgroundColor: STRING,
    fillStyle: {
      type: "string",
      enum: ["solid", "hachure", "cross-hatch", "dots", "zigzag", "dashed", "zigzag-line"]
    },
    strokeWidth: NUMBER,
    strokeStyle: { type: "string", enum: ["solid", "dashed", "dotted"] },
    roughness: NUMBER,
    opacity: NUMBER,
    roundness: {
      type: ["object", "null"],
      properties: { type: NUMBER },
      required: ["type"],
      additionalProperties: false
    },
    groupIds: { type: "array", items: STRING },
    locked: BOOLEAN,
    link: NULLABLE_STRING,
    points: {
      type: "array",
      items: POINT_SCHEMA,
      description: "Relative points for line/arrow/freedraw."
    },
    startArrowhead: NULLABLE_STRING,
    endArrowhead: NULLABLE_STRING,
    startElementId: {
      type: ["string", "null"],
      description: "Bind the arrow start to this element id in the same scene."
    },
    endElementId: {
      type: ["string", "null"],
      description: "Bind the arrow end to this element id in the same scene."
    },
    text: { type: "string", description: "Text content for text elements." },
    fontSize: NUMBER,
    fontFamily: NUMBER,
    textAlign: { type: "string", enum: ["left", "center", "right"] },
    verticalAlign: { type: "string", enum: ["top", "middle", "bottom"] },
    pressures: { type: "array", items: NUMBER },
    simulatePressure: BOOLEAN,
    fileId: { type: "string", description: "Attachment id for image elements." }
  },
  required: ["type", "x", "y"],
  additionalProperties: false
};
var ELEMENT_PATCH_SCHEMA = {
  type: "object",
  properties: {
    x: NUMBER,
    y: NUMBER,
    width: NUMBER,
    height: NUMBER,
    angle: NUMBER,
    strokeColor: STRING,
    backgroundColor: STRING,
    fillStyle: STRING,
    strokeWidth: NUMBER,
    strokeStyle: STRING,
    roughness: NUMBER,
    opacity: NUMBER,
    text: STRING,
    fontSize: NUMBER,
    fontFamily: NUMBER,
    textAlign: STRING,
    verticalAlign: STRING,
    points: { type: "array", items: POINT_SCHEMA },
    startArrowhead: NULLABLE_STRING,
    endArrowhead: NULLABLE_STRING,
    link: NULLABLE_STRING,
    locked: BOOLEAN,
    roundness: {
      type: ["object", "null"],
      properties: { type: NUMBER },
      required: ["type"],
      additionalProperties: false
    }
  },
  additionalProperties: false
};
var OPERATION_SCHEMA = {
  type: "object",
  properties: {
    op: { type: "string", enum: ["add", "update", "delete"] },
    element: ELEMENT_INPUT_SCHEMA,
    id: { type: "string", description: "Target element id for update/delete." },
    patch: ELEMENT_PATCH_SCHEMA
  },
  required: ["op"],
  additionalProperties: false
};
var FILES_SCHEMA = {
  type: "object",
  additionalProperties: {
    type: "object",
    properties: {
      dataURL: { type: "string", description: "data:image/<type>;base64,... payload." },
      mimeType: { type: "string" },
      created: { type: "number" }
    },
    required: ["dataURL"],
    additionalProperties: false
  }
};
var APP_STATE_SCHEMA = {
  type: "object",
  properties: {
    viewBackgroundColor: { type: "string", description: "CSS color for the canvas background." },
    gridSize: { type: ["number", "null"] },
    gridModeEnabled: BOOLEAN
  },
  additionalProperties: false
};
var TOOL_SCHEMAS = {
  list: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  read: {
    type: "object",
    properties: {
      name: { type: "string", description: "Scene name without the .excalidraw extension." },
      include: {
        type: "string",
        enum: ["full", "summary"],
        description: "Return the complete scene (default) or element metadata only."
      },
      element_type: { type: "string", description: "Only return elements of this type." }
    },
    required: ["name"],
    additionalProperties: false
  },
  create: {
    type: "object",
    properties: {
      name: { type: "string", description: "New scene name (lowercase, no extension, no path)." },
      elements: { type: "array", items: ELEMENT_INPUT_SCHEMA, description: "Initial elements." },
      app_state: APP_STATE_SCHEMA,
      files: FILES_SCHEMA,
      request_id: { type: "string", description: "Idempotency key for safe retries." }
    },
    required: ["name"],
    additionalProperties: false
  },
  apply: {
    type: "object",
    properties: {
      name: { type: "string" },
      expected_revision: {
        type: "number",
        description: "Revision read from excalidraw_scene_read; the write is rejected when it changed."
      },
      operations: { type: "array", items: OPERATION_SCHEMA, minItems: 1, maxItems: 500 },
      app_state: APP_STATE_SCHEMA,
      request_id: { type: "string", description: "Idempotency key for safe retries." }
    },
    required: ["name", "expected_revision", "operations"],
    additionalProperties: false
  },
  validate: {
    type: "object",
    properties: {
      scene: { type: "object", description: "A complete .excalidraw scene document to validate." }
    },
    required: ["scene"],
    additionalProperties: false
  }
};

// src/host/tools.ts
function registerTools(ctx, service) {
  if (typeof ctx.tools?.register !== "function") return [];
  const disposers = [];
  const tool = (name, description, parameters, title, run) => {
    disposers.push(ctx.tools.register({
      name,
      description,
      parameters,
      output: {
        schema: {},
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }]
      },
      presentCall: (args) => ({ card: "generic", title, kind: "other", rawInput: args }),
      async execute(args) {
        try {
          return await run(args ?? {});
        } catch (error) {
          if (isSceneError(error)) {
            return {
              ok: false,
              error: {
                code: error.code,
                message: error.message,
                ...error.details === void 0 ? {} : { details: error.details }
              }
            };
          }
          return {
            ok: false,
            error: {
              code: "internal",
              message: error instanceof Error ? error.message : String(error)
            }
          };
        }
      }
    }));
  };
  tool(
    "excalidraw_scene_list",
    "List the Excalidraw scenes this plugin stores, with revision, element count, byte size and last writer. Use it to discover scene names before reading. Read-only.",
    TOOL_SCHEMAS.list,
    "List Excalidraw scenes",
    async () => ({ ok: true, scenes: await service.list() })
  );
  tool(
    "excalidraw_scene_read",
    'Read one .excalidraw scene with its exact revision and sha256. Call this before excalidraw_scene_apply: the expected_revision it returns is the write fence. Use include:"summary" for large scenes.',
    TOOL_SCHEMAS.read,
    "Read Excalidraw scene",
    async (args) => {
      const name = requireString(args, "name");
      const record = await service.read(name);
      const include = args.include === "summary" ? "summary" : "full";
      const filter = typeof args.element_type === "string" && args.element_type.length > 0 ? args.element_type : void 0;
      if (include === "summary") {
        return {
          ok: true,
          name,
          revision: record.revision,
          sha256: record.sha256,
          updatedAt: record.updatedAt,
          updatedBy: record.updatedBy,
          elementCount: record.elementCount,
          elements: record.scene.elements.filter((element) => filter === void 0 || element.type === filter).map((element) => ({
            id: element.id,
            type: element.type,
            x: element.x,
            y: element.y,
            width: element.width,
            height: element.height,
            ...element.type === "text" ? { text: element.text } : {},
            ...element.isDeleted ? { isDeleted: true } : {}
          })),
          files: Object.keys(record.scene.files)
        };
      }
      return {
        ok: true,
        name,
        revision: record.revision,
        sha256: record.sha256,
        updatedAt: record.updatedAt,
        updatedBy: record.updatedBy,
        byteLength: record.byteLength,
        scene: record.scene
      };
    }
  );
  tool(
    "excalidraw_scene_create",
    "Create a new Excalidraw scene from typed elements (rectangle, ellipse, diamond, arrow, line, text, freedraw, image). Coordinates are scene units with y pointing down. Text width is computed on the Host. Attachments (images) use a files map keyed by fileId. Fails if the scene already exists. Returns the revision and sha256 that prove the file was verified after writing.",
    TOOL_SCHEMAS.create,
    "Create Excalidraw scene",
    async (args) => {
      const name = requireString(args, "name");
      const created = await service.create({
        name,
        elements: args.elements,
        appState: args.app_state,
        files: args.files,
        requestId: optionalString(args, "request_id"),
        actor: "agent"
      });
      return {
        ok: true,
        name: created.name,
        revision: created.record.revision,
        sha256: created.record.sha256,
        byteLength: created.record.byteLength,
        elementCount: created.record.elementCount,
        savedAt: created.record.updatedAt,
        verified: true,
        summary: created.summary
      };
    }
  );
  tool(
    "excalidraw_scene_apply",
    "Atomically add, update or delete elements in an existing scene. Requires expected_revision from a recent read; a concurrent change is rejected with revision_conflict and the current revision, so re-read and retry. Operations are all-or-nothing. Arrow inputs may bind to existing element ids with startElementId/endElementId. Returns the new revision and sha256 after read-back verification.",
    TOOL_SCHEMAS.apply,
    "Modify Excalidraw scene",
    async (args) => {
      const name = requireString(args, "name");
      const expectedRevision = requireNumber(args, "expected_revision");
      if (!Array.isArray(args.operations) || args.operations.length === 0) {
        return { ok: false, error: { code: "invalid_operation", message: "operations must be a non-empty array" } };
      }
      const applied = await service.apply(name, {
        expectedRevision,
        operations: args.operations,
        appState: args.app_state,
        requestId: optionalString(args, "request_id"),
        actor: "agent"
      });
      return {
        ok: true,
        name,
        revision: applied.record.revision,
        previousRevision: expectedRevision,
        sha256: applied.record.sha256,
        byteLength: applied.record.byteLength,
        elementCount: applied.record.elementCount,
        savedAt: applied.record.updatedAt,
        verified: true,
        duplicate: applied.record.duplicate === true,
        operations: applied.operations,
        summary: applied.summary
      };
    }
  );
  tool(
    "excalidraw_scene_validate",
    "Validate a complete .excalidraw document without saving it. Reports structural errors, unsupported element types, duplicate ids, invalid attachment data and scene bounds. Use it before importing an externally produced scene.",
    TOOL_SCHEMAS.validate,
    "Validate Excalidraw scene",
    async (args) => {
      if (args.scene === null || typeof args.scene !== "object" || Array.isArray(args.scene)) {
        return { ok: false, error: { code: "invalid_scene", message: "scene must be a JSON object" } };
      }
      const result = validateScene(args.scene);
      return { ok: result.valid, ...result };
    }
  );
  return disposers;
}
function requireString(args, key) {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new SceneError("invalid_operation", `"${key}" must be a non-empty string`, { field: key });
  }
  return value;
}
function requireNumber(args, key) {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SceneError("invalid_operation", `"${key}" must be a finite number`, { field: key });
  }
  return value;
}
function optionalString(args, key) {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : void 0;
}

// src/host/index.ts
var PLUGIN_ID = "dsh-excalidraw";
var VERSION = "0.1.0";
var inject = ["tools"];
function resolveDrawingsDir(configured, dshHome = process.env.DSH_HOME ?? join3(homedir(), ".dsh")) {
  if (typeof configured === "string" && configured.trim().length > 0) {
    const value = configured.trim();
    return value.startsWith("~") ? join3(homedir(), value.slice(1)) : value;
  }
  return join3(dshHome, "excalidraw", "drawings");
}
function resolveAssetsDir(metaUrl = import.meta.url) {
  return fileURLToPath(new URL("../assets/", metaUrl));
}
function normalizeConfig(config = {}) {
  const maxSceneBytes = clamp(config.maxSceneBytes, 1048576, 67108864, 16777216);
  const limits = {
    maxBytes: maxSceneBytes,
    maxElements: clamp(config.maxElements, 1, 2e4, 5e3),
    maxFiles: clamp(config.maxFiles, 0, 256, 64),
    maxFileBytes: Math.min(8388608, Math.floor(maxSceneBytes / 2)),
    maxTextLength: clamp(config.maxTextLength, 100, 1e5, 2e4)
  };
  return {
    drawingsDir: typeof config.drawingsDir === "string" ? config.drawingsDir : "",
    maxSceneBytes,
    maxElements: limits.maxElements,
    maxFiles: limits.maxFiles,
    maxTextLength: limits.maxTextLength,
    limits
  };
}
function apply(ctx, config = {}) {
  const settings = normalizeConfig(config);
  const log = (message, error) => {
    const suffix = error === void 0 ? "" : ` ${error instanceof Error ? error.message : String(error)}`;
    if (error !== void 0) ctx.logger?.warn?.(`${PLUGIN_ID}: ${message}${suffix}`);
    else ctx.logger?.info?.(`${PLUGIN_ID}: ${message}`);
  };
  const drawingsDir = resolveDrawingsDir(settings.drawingsDir);
  const service = new ExcalidrawService({
    rootDir: drawingsDir,
    limits: settings.limits,
    version: VERSION
  });
  service.ready().then(
    () => log(`ready \u2014 drawings in ${drawingsDir}`),
    (error) => log("could not initialize the drawings directory", error)
  );
  const disposeService = ctx.provide?.("excalidrawScenes", service);
  if (disposeService) {
    ctx.effect?.(() => disposeService, `${PLUGIN_ID}: service`);
  }
  const admit = (req) => {
    const connection = ctx.get?.("connection");
    return connection?.requestRejection?.(req);
  };
  const api = new ApiServer({ service, admit, log });
  ctx.inject?.(["webServer"], (webContext) => {
    if (typeof webContext.webServer?.register !== "function") return;
    const webServer = webContext.webServer;
    webContext.effect?.(() => webServer.register({
      kind: "prefix",
      path: API_PREFIX,
      handler: (req, res) => api.handle(req, res)
    }), `${PLUGIN_ID}: ${API_PREFIX}`);
    const assets = createAssetHandler(resolveAssetsDir(), admit);
    webContext.effect?.(() => webServer.register({
      kind: "prefix",
      path: ASSET_PREFIX,
      handler: (req, res) => assets(req, res)
    }), `${PLUGIN_ID}: ${ASSET_PREFIX}`);
  });
  const toolDisposers = ctx.tools === void 0 ? [] : registerTools(ctx, service);
  ctx.effect?.(() => () => {
    for (const dispose of toolDisposers) dispose();
  }, `${PLUGIN_ID}: tools`);
  log(`activated \u2014 ${toolDisposers.length} tools, drawings in ${drawingsDir}`);
}
function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.trunc(number), min), max);
}
export {
  PLUGIN_ID,
  VERSION,
  apply,
  inject,
  normalizeConfig,
  resolveAssetsDir,
  resolveDrawingsDir
};
//# sourceMappingURL=index.js.map
