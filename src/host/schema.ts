/**
 * JSON Schema fragments for the agent tools.
 *
 * The schemas are object-rooted because model gateways require every function
 * parameter document to be an object schema. They describe the accepted agent
 * input precisely; the core re-validates everything at runtime because the
 * schema is a contract, not the security boundary.
 * @module host/schema
 */

const NUMBER = { type: 'number' } as const
const STRING = { type: 'string' } as const
const BOOLEAN = { type: 'boolean' } as const
const NULLABLE_STRING = { type: ['string', 'null'] } as const

/** A scene point. */
export const POINT_SCHEMA = {
  type: 'array',
  items: NUMBER,
  minItems: 2,
  maxItems: 2,
} as const

/** The strict element input accepted by create/add. */
export const ELEMENT_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'text', 'freedraw', 'image'],
      description: 'Element type.',
    },
    id: { type: 'string', description: 'Optional stable id; generated when omitted.' },
    x: { ...NUMBER, description: 'Scene x coordinate.' },
    y: { ...NUMBER, description: 'Scene y coordinate.' },
    width: { ...NUMBER, description: 'Width in scene units.' },
    height: { ...NUMBER, description: 'Height in scene units.' },
    angle: NUMBER,
    strokeColor: STRING,
    backgroundColor: STRING,
    fillStyle: {
      type: 'string',
      enum: ['solid', 'hachure', 'cross-hatch', 'dots', 'zigzag', 'dashed', 'zigzag-line'],
    },
    strokeWidth: NUMBER,
    strokeStyle: { type: 'string', enum: ['solid', 'dashed', 'dotted'] },
    roughness: NUMBER,
    opacity: NUMBER,
    roundness: {
      type: ['object', 'null'],
      properties: { type: NUMBER },
      required: ['type'],
      additionalProperties: false,
    },
    groupIds: { type: 'array', items: STRING },
    locked: BOOLEAN,
    link: NULLABLE_STRING,
    points: {
      type: 'array',
      items: POINT_SCHEMA,
      description: 'Relative points for line/arrow/freedraw.',
    },
    startArrowhead: NULLABLE_STRING,
    endArrowhead: NULLABLE_STRING,
    startElementId: {
      type: ['string', 'null'],
      description: 'Bind the arrow start to this element id in the same scene.',
    },
    endElementId: {
      type: ['string', 'null'],
      description: 'Bind the arrow end to this element id in the same scene.',
    },
    text: { type: 'string', description: 'Text content for text elements.' },
    fontSize: NUMBER,
    fontFamily: NUMBER,
    textAlign: { type: 'string', enum: ['left', 'center', 'right'] },
    verticalAlign: { type: 'string', enum: ['top', 'middle', 'bottom'] },
    pressures: { type: 'array', items: NUMBER },
    simulatePressure: BOOLEAN,
    fileId: { type: 'string', description: 'Attachment id for image elements.' },
  },
  required: ['type', 'x', 'y'],
  additionalProperties: false,
} as const

/** The update patch accepted by apply. */
export const ELEMENT_PATCH_SCHEMA = {
  type: 'object',
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
    points: { type: 'array', items: POINT_SCHEMA },
    startArrowhead: NULLABLE_STRING,
    endArrowhead: NULLABLE_STRING,
    link: NULLABLE_STRING,
    locked: BOOLEAN,
    roundness: {
      type: ['object', 'null'],
      properties: { type: NUMBER },
      required: ['type'],
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const

/** One mutation operation. */
export const OPERATION_SCHEMA = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: ['add', 'update', 'delete'] },
    element: ELEMENT_INPUT_SCHEMA,
    id: { type: 'string', description: 'Target element id for update/delete.' },
    patch: ELEMENT_PATCH_SCHEMA,
  },
  required: ['op'],
  additionalProperties: false,
} as const

/** Attachment map accepted alongside element input. */
export const FILES_SCHEMA = {
  type: 'object',
  additionalProperties: {
    type: 'object',
    properties: {
      dataURL: { type: 'string', description: 'data:image/<type>;base64,... payload.' },
      mimeType: { type: 'string' },
      created: { type: 'number' },
    },
    required: ['dataURL'],
    additionalProperties: false,
  },
} as const

/** App state accepted from a caller. */
export const APP_STATE_SCHEMA = {
  type: 'object',
  properties: {
    viewBackgroundColor: { type: 'string', description: 'CSS color for the canvas background.' },
    gridSize: { type: ['number', 'null'] },
    gridModeEnabled: BOOLEAN,
  },
  additionalProperties: false,
} as const

/** Full tool schema documents. */
export const TOOL_SCHEMAS = {
  list: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  read: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Scene name without the .excalidraw extension.' },
      include: {
        type: 'string',
        enum: ['full', 'summary'],
        description: 'Return the complete scene (default) or element metadata only.',
      },
      element_type: { type: 'string', description: 'Only return elements of this type.' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  create: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'New scene name (lowercase, no extension, no path).' },
      elements: { type: 'array', items: ELEMENT_INPUT_SCHEMA, description: 'Initial elements.' },
      app_state: APP_STATE_SCHEMA,
      files: FILES_SCHEMA,
      request_id: { type: 'string', description: 'Idempotency key for safe retries.' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  apply: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      expected_revision: {
        type: 'number',
        description: 'Revision read from excalidraw_scene_read; the write is rejected when it changed.',
      },
      operations: { type: 'array', items: OPERATION_SCHEMA, minItems: 1, maxItems: 500 },
      app_state: APP_STATE_SCHEMA,
      request_id: { type: 'string', description: 'Idempotency key for safe retries.' },
    },
    required: ['name', 'expected_revision', 'operations'],
    additionalProperties: false,
  },
  validate: {
    type: 'object',
    properties: {
      scene: { type: 'object', description: 'A complete .excalidraw scene document to validate.' },
    },
    required: ['scene'],
    additionalProperties: false,
  },
} as const
