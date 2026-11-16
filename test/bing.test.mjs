import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { api, baseId, isSpotlight, pickSpotlight, resolveWallpaper, spotlightField } from '../src/bing.mjs';

const A = 'OBTQ.BT0D69935BEA9378834D361A1477F6D77AFAAD6CC991EA8CD838714403194EDAB2';
const B = 'OBTQ.BT484420EA259F0C18A6C84E10D8B1C6A8E8B3B220F84350192162A0628CC37980';

// 실제 스포트라이트 페이지의 캐러셀 데이터 형태 (필요한 필드만)
const page = `<html><script>var x={"CarouselLength":2,"HiderUrls":["https://www.bing.com/spotlight?spotlightId=ParadordeRonda\\u0026q=Ronda"],` +
  `"FullScreenUrls":["/th?id=${A}\\u0026rs=2\\u0026c=1","/th?id=${B}\\u0026rs=2\\u0026c=1"],` +
  `"LocationTexts":["Ronda, Málaga, Spain","Granada, Spain"],` +
  `"HeadingTexts":["Ronda in the Province of Málaga, Spain","The Alhambra in Granada, Spain"]};</script></html>`;

const link = 'https://www.bing.com/spotlight?spotlightId=ParadordeRonda&q=Ronda%20in%20the%20Province%20of%20M%C3%A1laga,%20Spain&carindexpill=0&carindeximg=0&textorimgcar=img&isfullscreen=true&form=SLVFUL';

afterEach(() => mock.restoreAll());

describe('스포트라이트 페이지 해석', () => {
  it('배열 필드를 읽는다', () => {
    assert.deepEqual(spotlightField(page, 'LocationTexts'), ['Ronda, Málaga, Spain', 'Granada, Spain']);
    assert.deepEqual(spotlightField(page, 'Missing'), []);
  });

  it('q와 같은 제목의 사진을 고르고, 없으면 carindeximg를 쓴다', () => {
    assert.equal(pickSpotlight(page, 'the alhambra in  granada, spain', '0').id, B);
    assert.equal(pickSpotlight(page, '없는 제목', '1').id, B);
    assert.equal(pickSpotlight(page, '없는 제목', '9').id, A);
    assert.equal(pickSpotlight('<html></html>', 'x', '0'), null);
  });

  it('OBTQ ID를 이미지 ID로 인정한다', () => {
    assert.equal(baseId(A), A);
    assert.ok(isSpotlight(A));
    assert.equal(baseId('OBTQ.BT<script>'), null);
  });
});

describe('스포트라이트 링크', () => {
  it('페이지에서 사진 ID·제목·위치를 찾는다', async () => {
    const fetch = mock.method(globalThis, 'fetch', async () => new Response(page, { status: 200 }));
    const result = await resolveWallpaper(link);
    assert.deepEqual(result, {
      id: A, title: 'Ronda in the Province of Málaga, Spain', credit: '', location: 'Ronda, Málaga, Spain',
      date: '', source: 'spotlight', name: 'ParadordeRonda_1',
    });
    const requested = new URL(fetch.mock.calls[0].arguments[0]);
    assert.equal(requested.origin + requested.pathname, 'https://www.bing.com/spotlight');
    assert.equal(requested.searchParams.get('q'), 'Ronda in the Province of Málaga, Spain');
    assert.deepEqual([...requested.searchParams.keys()], ['spotlightId', 'q']);
  });

  it('q가 없거나 spotlightId가 이상하면 Bing을 호출하지 않고 거부한다', async () => {
    const fetch = mock.method(globalThis, 'fetch', async () => new Response(page));
    await assert.rejects(resolveWallpaper('https://www.bing.com/spotlight?spotlightId=ParadordeRonda'), { status: 400 });
    await assert.rejects(resolveWallpaper('https://www.bing.com/spotlight?spotlightId=../x&q=a'), { status: 400 });
    assert.equal(fetch.mock.callCount(), 0);
  });

  it('페이지에 사진 데이터가 없으면 404', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('<html></html>'));
    await assert.rejects(resolveWallpaper(link), { status: 404 });
  });
});

describe('이미지 다운로드', () => {
  it('스포트라이트 원본은 접미사 없이 요청하고 지정한 파일 이름을 쓴다', async () => {
    const fetch = mock.method(globalThis, 'fetch', async () =>
      new Response('jpg', { headers: { 'content-type': 'image/jpeg' } }));
    const response = await api(new Request(`http://local/api/image?id=${A}&download=1&name=ParadordeRonda_1`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="ParadordeRonda_1_UHD.jpg"');
    assert.equal(new URL(fetch.mock.calls[0].arguments[0]).searchParams.get('id'), A);
  });

  it('홈페이지 배경화면은 기존처럼 _UHD.jpg를 붙이고, 잘못된 파일 이름은 무시한다', async () => {
    const id = 'OHR.AbrahamCanada_ROW4975668347';
    const fetch = mock.method(globalThis, 'fetch', async () =>
      new Response('jpg', { headers: { 'content-type': 'image/jpeg' } }));
    const response = await api(new Request(`http://local/api/image?id=${id}&w=1920&h=1080&download=1&name=..%2Fevil"`));
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="AbrahamCanada_ROW4975668347_1920x1080.jpg"');
    assert.equal(new URL(fetch.mock.calls[0].arguments[0]).searchParams.get('id'), `${id}_UHD.jpg`);
  });
});
