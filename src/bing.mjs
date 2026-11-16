const BING = 'https://www.bing.com';
const imageIdPattern = /^OHR\.[A-Za-z0-9][A-Za-z0-9_.-]{0,140}_(?:ROW|[A-Za-z]{2,3}-[A-Za-z]{2,4})\d{6,16}$/i;
const marketPattern = /^[a-z]{2}-[a-z]{2}$/i;

class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function baseId(value = '') {
  const id = value.replace(/(?:_(?:UHD|tmb|\d{2,5}x\d{2,5}))?\.(?:jpe?g|webp|png)$/i, '');
  return imageIdPattern.test(id) ? id : null;
}

function bingLink(raw) {
  if (!raw || raw.length > 2000) throw new InputError('Bing 배경화면 주소를 입력해 주세요.');
  const value = raw.trim().replace(/&amp;/gi, '&');
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch { throw new InputError('주소 형식을 확인해 주세요.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.port || url.username || url.password ||
    !/^(?:[a-z0-9-]+\.)*bing\.com$/i.test(url.hostname)) {
    throw new InputError('bing.com에서 복사한 배경화면 주소를 입력해 주세요.');
  }
  return url;
}

function marketFor(url) {
  const market = url?.searchParams.get('mkt');
  return market && marketPattern.test(market) ? market : url?.hostname === 'cn.bing.com' ? 'zh-CN' : 'ko-KR';
}

async function fromBing(path, params) {
  const url = new URL(path, BING);
  url.search = new URLSearchParams(params).toString();
  try {
    return await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(12000) });
  } catch { throw new InputError('Bing에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.', 502); }
}

async function archive(market, day) {
  let idx = 0;
  if (day && /^\d{8}$/.test(day)) {
    const date = Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T00:00:00Z`);
    const age = Math.floor((Date.now() - date) / 86400000);
    if (age > 7 && age <= 16) idx = 7;
  }
  const response = await fromBing('/HPImageArchive.aspx', { format: 'js', idx, n: 8, mkt: market });
  if (!response.ok) throw new InputError('Bing의 배경화면 목록을 불러오지 못했어요.', 502);
  const data = await response.json().catch(() => null);
  if (!Array.isArray(data?.images)) throw new InputError('Bing의 배경화면 목록을 읽지 못했어요.', 502);
  return data.images;
}

function details(item, id) {
  if (item?.wp === false) throw new InputError('Bing에서 다운로드를 제공하지 않는 사진이에요.', 404);
  const caption = typeof item?.copyright === 'string' ? item.copyright : '';
  const date = typeof item?.startdate === 'string' && /^\d{8}$/.test(item.startdate) ? item.startdate : '';
  return { id, title: caption.split(' (©')[0] || 'Bing 배경화면', credit: caption.match(/\(© (.+)\)$/)?.[1] || '', date };
}

const normalize = value => (value || '').trim().replace(/\s+/g, ' ').toLowerCase();

export async function resolveWallpaper(raw) {
  const url = raw ? bingLink(raw) : null;
  const id = url && baseId(url.searchParams.get('id') || url.searchParams.get('mediaurl') || '');
  if (id) return details(null, id);
  const path = url?.pathname.toLowerCase();
  const filter = url?.searchParams.get('filters') || '';
  const day = /(?:HpDate|HPQuiz):"?(\d{8})/i.exec(filter)?.[1];
  const query = normalize(url?.searchParams.get('q'));
  const info = (path === '/search' || path === '/images/search') && (day || /^hpcapt/i.test(url.searchParams.get('form') || ''));
  if (url && path !== '/' && path !== '/hpimagearchive.aspx' && !info) {
    throw new InputError('배경화면 이미지 주소(/th?id=OHR…)나 Bing 홈페이지의 사진 정보 링크를 붙여 넣어 주세요.');
  }
  const items = await archive(marketFor(url), day);
  let item = items[0];
  if (info) {
    item = items.find(entry => {
      if (day) return entry.startdate === day;
      try { return query && normalize(new URL(entry.copyrightlink, BING).searchParams.get('q')) === query; }
      catch { return false; }
    });
  }
  const itemId = typeof item?.urlbase === 'string' ? baseId(new URL(item.urlbase, BING).searchParams.get('id') || '') : null;
  if (!itemId) throw new InputError('최근 Bing 배경화면 목록에서 이 사진을 찾지 못했어요. 이미지 주소(/th?id=OHR…)로 다시 시도해 주세요.', 404);
  return details(item, itemId);
}

function dimensions(params) {
  const w = params.get('w');
  const h = params.get('h');
  if (w === null && h === null) return null;
  if (![w, h].every(value => /^\d{2,4}$/.test(value || '') && Number(value) >= 64 && Number(value) <= 3840)) {
    throw new InputError('가로와 세로를 각각 64~3840px로 입력해 주세요.');
  }
  return { w, h };
}

async function image(params) {
  const id = baseId(params.get('id') || '');
  if (!id) throw new InputError('올바른 Bing 배경화면 ID가 아니에요.');
  const size = dimensions(params);
  const download = params.get('download') === '1';
  const response = await fromBing('/th', { id: `${id}_UHD.jpg`, ...(size ? { ...size, c: 4, rs: 1 } : {}) });
  if (!response.ok || !/^image\/jpeg(?:;|$)/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel();
    throw new InputError('Bing에서 이 이미지를 가져오지 못했어요. 주소나 해상도를 확인해 주세요.', response.status >= 500 ? 502 : 404);
  }
  const headers = {
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  };
  if (download) headers['Content-Disposition'] = `attachment; filename="${id.slice(4)}_${size ? `${size.w}x${size.h}` : 'UHD'}.jpg"`;
  return new Response(response.body, { headers });
}

export async function api(request) {
  const { pathname, searchParams } = new URL(request.url);
  try {
    if (request.method !== 'GET') throw new InputError('지원하지 않는 요청이에요.', 405);
    if (pathname === '/api/wallpaper') {
      return Response.json(await resolveWallpaper(searchParams.get('url') || ''), { headers: { 'Cache-Control': 'no-store' } });
    }
    if (pathname === '/api/image') return await image(searchParams);
    throw new InputError('페이지를 찾을 수 없어요.', 404);
  } catch (error) {
    return Response.json({ error: error instanceof InputError ? error.message : '사진을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' },
      { status: error instanceof InputError ? error.status : 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
