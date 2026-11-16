const BING = 'https://www.bing.com';
const imageIdPattern = /^OHR\.[A-Za-z0-9][A-Za-z0-9_.-]{0,140}_(?:ROW|[A-Za-z]{2,3}-[A-Za-z]{2,4})\d{6,16}$/i;
const spotlightImagePattern = /^OBTQ\.BT[0-9A-F]{32,128}$/i;
const spotlightIdPattern = /^[A-Za-z0-9_-]{1,100}$/;
const fileNamePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/;
const marketPattern = /^[a-z]{2}-[a-z]{2}$/i;

class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function baseId(value = '') {
  const id = value.replace(/(?:_(?:UHD|tmb|\d{2,5}x\d{2,5}))?\.(?:jpe?g|webp|png)$/i, '');
  return imageIdPattern.test(id) || spotlightImagePattern.test(id) ? id : null;
}

/** Windows 추천(스포트라이트) 사진은 OBTQ ID를 쓰고, 접미사 없이 요청하면 원본(4K)을 준다. */
export const isSpotlight = id => /^OBTQ\./i.test(id);

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
  return {
    id, title: caption.split(' (©')[0] || 'Bing 배경화면', credit: caption.match(/\(© (.+)\)$/)?.[1] || '', date,
    source: isSpotlight(id) ? 'spotlight' : 'homepage', name: isSpotlight(id) ? `Spotlight_${id.slice(7, 19)}` : id.slice(4),
  };
}

const normalize = value => (value || '').trim().replace(/\s+/g, ' ').toLowerCase();

/** 스포트라이트 페이지에 들어 있는 캐러셀 데이터의 문자열 배열 하나를 읽는다. */
export function spotlightField(html, name) {
  const match = new RegExp(String.raw`"${name}":(\[[^\]]*\])`).exec(html);
  if (!match) return [];
  try {
    const list = JSON.parse(match[1]);
    return Array.isArray(list) ? list.map(value => (typeof value === 'string' ? value : '')) : [];
  } catch { return []; }
}

/** 링크의 q(사진 제목)와 같은 항목을 먼저 찾고, 없으면 carindeximg 순서를 쓴다. */
export function pickSpotlight(html, query, index) {
  const images = spotlightField(html, 'FullScreenUrls');
  const titles = spotlightField(html, 'HeadingTexts');
  const locations = spotlightField(html, 'LocationTexts');
  let i = titles.findIndex(title => query && normalize(title) === normalize(query));
  if (i < 0) i = /^\d{1,2}$/.test(index || '') && Number(index) < images.length ? Number(index) : 0;
  let id = null;
  try { id = baseId(new URL(images[i] || '', BING).searchParams.get('id') || ''); } catch { /* 아래에서 처리 */ }
  if (!id || !isSpotlight(id)) return null;
  return { id, index: i, title: titles[i] || query || 'Bing 스포트라이트', location: locations[i] || '' };
}

async function resolveSpotlight(url) {
  const spotlightId = url.searchParams.get('spotlightId') || '';
  const query = (url.searchParams.get('q') || '').trim();
  if (!spotlightIdPattern.test(spotlightId) || !query || query.length > 300) {
    throw new InputError('스포트라이트 링크에 spotlightId와 q가 있어야 해요. 사진을 연 상태의 주소를 그대로 복사해 주세요.');
  }
  const response = await fromBing('/spotlight', { spotlightId, q: query });
  if (!response.ok) {
    await response.body?.cancel();
    throw new InputError('Bing 스포트라이트 페이지를 불러오지 못했어요.', response.status >= 500 ? 502 : 404);
  }
  const html = await response.text();
  const found = pickSpotlight(html, query, url.searchParams.get('carindeximg'));
  if (!found) throw new InputError('스포트라이트 페이지에서 사진을 찾지 못했어요. 사진을 연 상태의 주소인지 확인해 주세요.', 404);
  return {
    id: found.id, title: found.title, credit: '', location: found.location, date: '',
    source: 'spotlight', name: `${spotlightId}_${found.index + 1}`,
  };
}

export async function resolveWallpaper(raw) {
  const url = raw ? bingLink(raw) : null;
  const id = url && baseId(url.searchParams.get('id') || url.searchParams.get('mediaurl') || '');
  if (id) return details(null, id);
  const path = url?.pathname.toLowerCase();
  if (path === '/spotlight') return resolveSpotlight(url);
  const filter = url?.searchParams.get('filters') || '';
  const day = /(?:HpDate|HPQuiz):"?(\d{8})/i.exec(filter)?.[1];
  const query = normalize(url?.searchParams.get('q'));
  const info = (path === '/search' || path === '/images/search') && (day || /^hpcapt/i.test(url.searchParams.get('form') || ''));
  if (url && path !== '/' && path !== '/hpimagearchive.aspx' && !info) {
    throw new InputError('배경화면 이미지 주소(/th?id=OHR…), Bing 홈페이지의 사진 정보 링크, 스포트라이트(/spotlight?spotlightId=…) 링크를 붙여 넣어 주세요.');
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
  const requested = params.get('name') || '';
  const name = fileNamePattern.test(requested) ? requested : isSpotlight(id) ? `Spotlight_${id.slice(7, 19)}` : id.slice(4);
  const response = await fromBing('/th', { id: isSpotlight(id) ? id : `${id}_UHD.jpg`, ...(size ? { ...size, c: 4, rs: 1 } : {}) });
  if (!response.ok || !/^image\/jpeg(?:;|$)/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel();
    throw new InputError('Bing에서 이 이미지를 가져오지 못했어요. 주소나 해상도를 확인해 주세요.', response.status >= 500 ? 502 : 404);
  }
  const headers = {
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  };
  if (download) headers['Content-Disposition'] = `attachment; filename="${name}_${size ? `${size.w}x${size.h}` : 'UHD'}.jpg"`;
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
