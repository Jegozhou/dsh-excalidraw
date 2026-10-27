/**
 * Plugin chrome styles. Excalidraw owns the canvas styling; this sheet only
 * lays out the page and keeps the controls on Harness theme tokens.
 * @module client/styles
 */

export const CSS = `
.dsh-exc-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base, #ffffff);
  color: var(--dsw-alias-label-primary, #1b1b1b);
  font-family: inherit;
}
.dsh-exc-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, #e6e6e6);
  flex: 0 0 auto;
}
.dsh-exc-head strong { font-size: 14px; font-weight: 600; }
.dsh-exc-sub {
  color: var(--dsw-alias-label-secondary, #6b6b6b);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-exc-spacer { flex: 1 1 auto; }
.dsh-exc-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1, #e6e6e6);
  color: var(--dsw-alias-label-secondary, #6b6b6b);
}
.dsh-exc-badge.dirty {
  color: var(--dsw-alias-state-warn-primary, #b26a00);
  border-color: currentColor;
}
.dsh-exc-button {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l1, #d9d9d9);
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-label-primary, #1b1b1b);
  border-radius: 7px;
  font: inherit;
  font-size: 12px;
  padding: 5px 11px;
  cursor: pointer;
}
.dsh-exc-button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #f4f4f4); }
.dsh-exc-button:disabled { opacity: 0.5; cursor: default; }
.dsh-exc-button.primary {
  background: var(--dsw-alias-brand-primary, #3b6ef6);
  border-color: var(--dsw-alias-brand-primary, #3b6ef6);
  color: #ffffff;
}
.dsh-exc-body { flex: 1 1 auto; display: flex; min-height: 0; }
.dsh-exc-side {
  width: 214px;
  flex: 0 0 214px;
  border-right: 1px solid var(--dsw-alias-border-l1, #e6e6e6);
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--dsw-alias-bg-layer-1, #fafafa);
}
.dsh-exc-side-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--dsw-alias-label-secondary, #6b6b6b);
  padding: 10px 12px 6px;
}
.dsh-exc-list { overflow: auto; flex: 1 1 auto; padding: 0 6px 6px; }
.dsh-exc-item {
  display: block;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  font: inherit;
  border-radius: 7px;
  padding: 6px 8px;
  cursor: pointer;
}
.dsh-exc-item:hover { background: var(--dsw-alias-bg-layer-2, #f0f0f0); }
.dsh-exc-item.active {
  background: var(--dsw-alias-bg-layer-2, #f0f0f0);
  border-color: var(--dsw-alias-border-l1, #e0e0e0);
}
.dsh-exc-item-name { font-size: 13px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-exc-item-meta {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #6b6b6b);
  display: flex;
  gap: 8px;
}
.dsh-exc-new { padding: 8px; border-top: 1px solid var(--dsw-alias-border-l1, #e6e6e6); display: flex; flex-direction: column; gap: 6px; }
.dsh-exc-input {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  font-size: 12px;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l1, #d9d9d9);
  background: var(--dsw-alias-bg-base, #ffffff);
  color: var(--dsw-alias-label-primary, #1b1b1b);
}
.dsh-exc-main { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; min-height: 0; position: relative; }
.dsh-exc-canvas { flex: 1 1 auto; min-height: 0; position: relative; }
.dsh-exc-canvas > div { height: 100%; }
.dsh-exc-canvas .excalidraw { height: 100%; }
.dsh-exc-empty {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-secondary, #6b6b6b);
  font-size: 13px;
  padding: 24px;
  text-align: center;
}
.dsh-exc-status {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 5px 12px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #6b6b6b);
  border-top: 1px solid var(--dsw-alias-border-l1, #e6e6e6);
  min-height: 24px;
}
.dsh-exc-status code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: var(--dsw-alias-label-secondary, #6b6b6b);
}
.dsh-exc-banner {
  position: absolute;
  z-index: 30;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  width: min(560px, calc(100% - 32px));
  background: var(--dsw-alias-bg-overlay, #ffffff);
  border: 1px solid var(--dsw-alias-state-warn-primary, #b26a00);
  border-radius: 10px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
  padding: 12px 14px;
  font-size: 12px;
  color: var(--dsw-alias-label-primary, #1b1b1b);
}
.dsh-exc-banner p { margin: 0 0 8px; line-height: 1.45; }
.dsh-exc-banner-actions { display: flex; gap: 8px; justify-content: flex-end; }
.dsh-exc-toast {
  position: absolute;
  z-index: 40;
  bottom: 34px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  background: var(--dsw-alias-bg-overlay, #ffffff);
  border: 1px solid var(--dsw-alias-border-l1, #e0e0e0);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
  color: var(--dsw-alias-label-primary, #1b1b1b);
}
.dsh-exc-toast.error { border-color: var(--dsw-alias-state-error-primary, #d33); color: var(--dsw-alias-state-error-primary, #d33); }
.dsh-exc-loading { padding: 10px 12px; font-size: 12px; color: var(--dsw-alias-label-secondary, #6b6b6b); }
`
