const byId = id => document.getElementById(id);
const lookup = byId('lookup');
const url = byId('url');
const today = byId('today');
const lookupButton = byId('lookup-button');
const download = byId('download-form');
const save = byId('save');
const custom = byId('custom');
const status = byId('status');
const photo = byId('photo');
const empty = byId('photo-empty');
const original = byId('original');
const title = byId('photo-title');
const credit = byId('credit');
const badge = byId('badge');
let wallpaper = null;
let ready = false;
let busy = false;
let saving = false;
let renderKey = 0;
let previewTimer;

function message(value = '', error = false) {
  status.hidden = !value;
  status.textContent = value;
  status.classList.toggle('error', error);
}

function sync() {
  save.disabled = !wallpaper || !ready || busy || saving;
  lookupButton.disabled = today.disabled = busy;
  save.lastChild.textContent = saving ? ' JPG 준비 중…' : ' JPG 다운로드';
}

function imagePath(id, size, attachment = false) {
  const params = new URLSearchParams({ id });
  if (size) { params.set('w', size[0]); params.set('h', size[1]); }
  if (attachment) {
    params.set('download', '1');
    if (wallpaper?.name) params.set('name', wallpaper.name);
  }
  return './api/image?' + params;
}

function sizeSelection() {
  const selected = download.elements.size.value;
  if (selected === 'original') return null;
  if (selected === 'custom') return [download.elements.w.valueAsNumber, download.elements.h.valueAsNumber];
  return selected.split('x').map(Number);
}

function renderPreview() {
  if (!wallpaper) return;
  const key = ++renderKey;
  const size = sizeSelection();
  if (size && !size.every(n => Number.isInteger(n) && n >= 64 && n <= 3840)) {
    ready = false;
    message('가로와 세로를 각각 64~3840px로 입력해 주세요.', true);
    sync();
    return;
  }
  ready = false;
  sync();
  message('미리보기를 불러오는 중…');
  const preview = new Image();
  const scale = size ? Math.min(1, 960 / Math.max(...size)) : 1;
  const previewSize = size ? size.map(n => Math.max(64, Math.round(n * scale))) : [960, 540];
  preview.onload = () => {
    if (key !== renderKey) return;
    photo.src = preview.src;
    photo.alt = wallpaper.title;
    photo.classList.add('loaded');
    photo.hidden = false;
    empty.hidden = true;
    ready = true;
    sync();
    message();
  };
  preview.onerror = () => {
    if (key !== renderKey) return;
    photo.hidden = true;
    empty.hidden = false;
    message('Bing에서 사진을 불러오지 못했어요. 링크나 해상도를 확인해 주세요.', true);
    sync();
  };
  preview.src = imagePath(wallpaper.id, previewSize);
}

async function load(value, label) {
  clearTimeout(previewTimer);
  ++renderKey;
  wallpaper = null;
  ready = false;
  busy = true;
  sync();
  message('Bing에서 사진을 찾는 중…');
  try {
    const params = new URLSearchParams({ url: value });
    const response = await fetch('./api/wallpaper?' + params);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    wallpaper = result;
    title.textContent = result.title;
    const spotlight = result.source === 'spotlight';
    credit.textContent = result.credit ? '© ' + result.credit : result.location || '';
    const date = result.date ? ' · ' + [result.date.slice(0, 4), result.date.slice(4, 6), result.date.slice(6)].join('.') : '';
    badge.lastChild.textContent = ' ' + (spotlight ? 'Bing 스포트라이트' : label) + date;
    original.href = 'https://www.bing.com/th?id=' + encodeURIComponent(spotlight ? result.id : result.id + '_UHD.jpg');
    original.hidden = false;
    renderPreview();
  } catch (error) {
    message(error.message || '사진을 불러오지 못했어요.', true);
  } finally {
    busy = false;
    sync();
  }
}

function selectionChanged() {
  const isCustom = download.elements.size.value === 'custom';
  custom.hidden = !isCustom;
  download.elements.w.disabled = download.elements.h.disabled = !isCustom;
  clearTimeout(previewTimer);
  renderPreview();
}

lookup.addEventListener('submit', event => {
  event.preventDefault();
  const value = url.value.trim();
  if (!value) { message('Bing 배경화면 주소를 입력해 주세요.', true); url.focus(); return; }
  load(value, 'Bing 배경화면');
});
today.addEventListener('click', () => { url.value = ''; load('', '오늘의 사진'); });
download.querySelectorAll('input[type=radio]').forEach(radio => radio.addEventListener('change', selectionChanged));
custom.addEventListener('input', () => {
  clearTimeout(previewTimer);
  ++renderKey;
  ready = false;
  sync();
  previewTimer = setTimeout(renderPreview, 350);
});
selectionChanged();

photo.addEventListener('error', () => {
  photo.hidden = true;
  empty.hidden = false;
});
if (photo.complete && !photo.naturalWidth) { photo.hidden = true; empty.hidden = false; }

download.addEventListener('submit', async event => {
  event.preventDefault();
  if (!wallpaper || !ready || saving) return;
  saving = true;
  sync();
  message('JPG 파일을 준비하는 중…');
  const id = wallpaper.id;
  const size = sizeSelection();
  try {
    const response = await fetch(imagePath(id, size, true));
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.error || 'JPG 파일을 받지 못했어요.');
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'bing-wallpaper.jpg';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    if (wallpaper?.id === id) message('JPG 다운로드를 시작했어요.');
  } catch (error) {
    if (wallpaper?.id === id) message(error.message || 'JPG 파일을 받지 못했어요.', true);
  } finally {
    saving = false;
    sync();
  }
});
