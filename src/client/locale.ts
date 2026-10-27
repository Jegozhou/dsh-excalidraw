/**
 * Client locale dictionary. `locale/*.json` supplies the Plugin Manager display
 * metadata; this module supplies the strings the page itself renders.
 * @module client/locale
 */

export const LOCALE_NS = 'dsh-excalidraw'

export const EN = {
  panel: 'Excalidraw',
  panelHint: 'Drawings',
  newScene: 'New scene',
  sceneName: 'Scene name',
  open: 'Open',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  reload: 'Reload from disk',
  overwrite: 'Overwrite anyway',
  empty: 'No scenes yet. Create one to start drawing.',
  error: 'Something went wrong',
  revision: 'Revision',
  elements: 'Elements',
  conflict: 'This scene changed on disk while you were editing.',
  conflictDetail: 'Reload to keep the on-disk version, or overwrite to save your canvas as the next revision.',
  cancel: 'Cancel',
  create: 'Create',
  nameInvalid: 'Use lowercase letters, digits, dots, dashes or underscores (no path).',
  editorLoading: 'Loading the canvas…',
  editorFailed: 'The Excalidraw canvas could not start.',
  scenes: 'Scenes',
  dirty: 'edited',
  savedAt: 'saved',
  canvasHint: 'Draw with the toolbar; the scene stays local and versioned.',
}

export const ZH: typeof EN = {
  panel: 'Excalidraw',
  panelHint: '绘图',
  newScene: '新建场景',
  sceneName: '场景名称',
  open: '打开',
  save: '保存',
  saving: '保存中…',
  saved: '已保存',
  unsaved: '有未保存的更改',
  reload: '从磁盘重新加载',
  overwrite: '仍然覆盖',
  empty: '还没有场景。新建一个开始绘图。',
  error: '出错了',
  revision: '修订',
  elements: '元素',
  conflict: '编辑期间该场景在磁盘上已被修改。',
  conflictDetail: '重新加载以保留磁盘版本，或覆盖以把你的画布保存为下一个修订。',
  cancel: '取消',
  create: '创建',
  nameInvalid: '仅使用小写字母、数字、点、短横线或下划线（不能包含路径）。',
  editorLoading: '正在加载画布…',
  editorFailed: 'Excalidraw 画布未能启动。',
  scenes: '场景',
  dirty: '已编辑',
  savedAt: '已保存',
  canvasHint: '使用工具栏绘图；场景保存在本机并带修订号。',
}

export type Translate = (key: keyof typeof EN) => string
