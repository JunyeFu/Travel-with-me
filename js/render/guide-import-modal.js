import { escapeHTML } from '../utils.js';
import { modalSingleton, setupModalCloseEvents } from './modal-base.js';

const MIN_TEXT_LENGTH = 50;
const MAX_TEXT_LENGTH = 5000;

export const openGuideImportModal = modalSingleton(
  ({ initialText = '', initialCity = '', handlers }) => {
    const controller = new AbortController();
    const root = document.createElement('div');
    root.className = 'modal-overlay';
    root.innerHTML = `
    <div class="modal guide-import-modal" role="dialog" aria-modal="true" aria-label="从攻略导入">
      <div class="modal-header">
        <h2>从攻略导入</h2>
        <button type="button" class="modal-close" aria-label="关闭">&times;</button>
      </div>
      <form class="modal-body guide-import-body">
        <p class="guide-import-help" id="guide-import-instructions">粘贴攻略文字，提取后进入可编辑预览。暂不支持直接上传图片，可先从图片复制文字。</p>
        <div class="guide-import-field">
          <label for="guide-import-city">城市</label>
          <input id="guide-import-city" type="text" class="guide-import-city" placeholder="AI 自动识别，也可以手动填写城市" value="${escapeHTML(
            initialCity
          )}" />
        </div>
        <div class="guide-import-field">
          <label for="guide-import-text">攻略文字</label>
          <textarea id="guide-import-text" aria-describedby="guide-import-instructions guide-import-length" class="guide-import-textarea" placeholder="粘贴小红书 / 公众号 / 马蜂窝等中文旅行攻略文字">${escapeHTML(
            initialText
          )}</textarea>
          <div class="guide-import-meta">
            <span class="guide-import-help" id="guide-import-length">至少 50 字，最多 5000 字</span>
            <span class="guide-import-count">0 / ${MAX_TEXT_LENGTH}</span>
          </div>
        </div>
        <div class="guide-import-error" role="alert" hidden></div>
        <div class="guide-import-progress" data-step="idle" hidden>${renderProgressSteps()}</div>
        <div class="modal-actions">
          <button type="button" class="modal-cancel">取消</button>
          <button type="submit" class="modal-submit guide-import-submit">提取</button>
        </div>
      </form>
    </div>
  `;

    setupModalCloseEvents(root, openGuideImportModal.close);

    const form = root.querySelector('.guide-import-body');
    const textarea = root.querySelector('.guide-import-textarea');
    const cityInput = root.querySelector('.guide-import-city');
    const countEl = root.querySelector('.guide-import-count');
    const submitBtn = root.querySelector('.guide-import-submit');
    const errorEl = root.querySelector('.guide-import-error');
    const progressEl = root.querySelector('.guide-import-progress');

    const setError = message => {
      errorEl.hidden = !message;
      errorEl.textContent = message || '';
    };
    const setProgressStep = (step, detail = '') => {
      progressEl.hidden = step === 'idle';
      progressEl.dataset.step = step;
      progressEl.querySelectorAll('.guide-import-step').forEach(item => {
        const order = Number(item.dataset.order);
        const activeOrder = getProgressOrder(step);
        item.classList.toggle('done', activeOrder > order);
        item.classList.toggle('active', activeOrder === order);
      });
      const detailEl = progressEl.querySelector('.guide-import-progress-detail');
      if (detailEl) detailEl.textContent = detail;
    };
    const setLoading = loading => {
      submitBtn.disabled = loading || !isValid(textarea.value.trim());
      submitBtn.textContent = loading ? '提取中...' : '提取';
      textarea.disabled = loading;
      cityInput.disabled = loading;
    };
    const sync = () => {
      const len = textarea.value.trim().length;
      countEl.textContent = `${len} / ${MAX_TEXT_LENGTH}`;
      submitBtn.disabled = !isValid(textarea.value.trim());
      if (len > MAX_TEXT_LENGTH) {
        errorEl.dataset.kind = 'validate';
        setError('文字过长，请分段处理。');
      } else if (errorEl.dataset.kind === 'validate') setError('');
    };
    textarea.addEventListener('input', sync);
    sync();

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const text = textarea.value.trim();
      if (text.length < MIN_TEXT_LENGTH) {
        errorEl.dataset.kind = 'validate';
        setError('文字太短，请粘贴完整攻略段落。');
        return;
      }
      if (text.length > MAX_TEXT_LENGTH) {
        errorEl.dataset.kind = 'validate';
        setError('文字过长，请分段处理。');
        return;
      }
      if (!/[一-鿿]/.test(text)) {
        errorEl.dataset.kind = 'validate';
        setError('暂仅支持中文攻略。');
        return;
      }
      setError('');
      setLoading(true);
      setProgressStep('extracting', '正在解析攻略文字...');
      try {
        const ok = await handlers.onSubmit?.({
          text,
          cityHint: cityInput.value.trim(),
          onProgress: setProgressStep,
          signal: controller.signal
        });
        if (ok !== false) openGuideImportModal.close();
      } catch (err) {
        errorEl.dataset.kind = 'request';
        setError(err?.message || '导入失败，请重试。');
        setProgressStep('idle');
      } finally {
        if (root.isConnected) setLoading(false);
      }
    });

    document.body.appendChild(root);
    requestAnimationFrame(() => root.querySelector('.guide-import-city')?.focus());
    return () => controller.abort();
  }
);

function renderProgressSteps() {
  return `<div class="guide-import-progress-track">${[
    ['extracting', 'AI 解析'],
    ['matching', '匹配地点'],
    ['previewing', '整理预览'],
    ['done', '完成']
  ]
    .map(
      ([id, label], i) =>
        `<div class="guide-import-step" data-step-id="${id}" data-order="${i + 1}"><span class="guide-import-step-dot"></span><span class="guide-import-step-label">${label}</span></div>`
    )
    .join('')}</div><div class="guide-import-progress-detail">正在解析攻略文字...</div>`;
}

function getProgressOrder(step) {
  const orders = { extracting: 1, matching: 2, previewing: 3, done: 4 };
  return orders[step] || 0;
}

function isValid(text) {
  return text.length >= MIN_TEXT_LENGTH && text.length <= MAX_TEXT_LENGTH;
}
