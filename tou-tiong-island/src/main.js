import './styles/main.css';
import { App } from './ui/app.js';

function boot() {
  try {
    window.__tti = new App();
  } catch (err) {
    console.error(err);
    document.body.insertAdjacentHTML('beforeend',
      `<div style="position:fixed;inset:0;display:grid;place-items:center;padding:24px;background:#fbf6ea;font:16px/1.8 system-ui;text-align:center">
        <div><p><b>載入失敗</b></p><p style="color:#5d6b6a">這台裝置可能不支援 WebGL，或瀏覽器版本太舊。</p>
        <p style="font-size:13px;color:#8b9897">${String(err.message ?? err)}</p></div>
      </div>`);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
